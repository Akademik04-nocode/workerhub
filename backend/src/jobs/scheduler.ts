import { and, eq, lt, lte, isNull, sql, count, inArray } from "drizzle-orm";
import { db, redis } from "../db/index.js";
import { orders, responses, users } from "../db/schema.js";
import { notifyInBackground } from "../utils/notify.js";
import { eligibleWorkersForOrder } from "../utils/eligibility.js";

const TICK_MS = 60_000;
const CONFIRM_WINDOW_MINUTES = 60; // «подтвердите выход» — за час до начала

/** Локальная дата YYYY-MM-DD (таймзона процесса, задаётся через TZ). */
function todayString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Момент начала смены из текстовых date ("YYYY-MM-DD") и startTime ("HH:MM"). */
function shiftStart(date: string, startTime: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  if (![y, m, d, hh].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, hh, mm ?? 0);
}

async function invalidateOrdersCache() {
  try {
    await redis.del("open_orders_cache");
  } catch {
    /* кэш не критичен */
  }
}

/**
 * Вторая волна «сначала избранным»: через broadcastAt рассылаем заказ всем
 * подходящим исполнителям, КРОМЕ избранных (они получили уведомление сразу).
 */
async function broadcastDelayedOrders() {
  const due = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "open"),
        eq(orders.broadcastDone, false),
        lte(orders.broadcastAt, new Date())
      )
    )
    .limit(50);

  for (const order of due) {
    // Помечаем ДО рассылки: повторный тик не должен продублировать уведомления.
    await db.update(orders).set({ broadcastDone: true }).where(eq(orders.id, order.id));
    const eligible = await eligibleWorkersForOrder(
      order.employerId,
      Number(order.minRatingRequired),
      order.category,
      { excludeFavorites: true }
    );
    notifyInBackground(
      eligible.map((w) => ({
        telegramId: w.telegramId,
        text: `🆕 ${order.title ?? "Новый заказ"}: ${order.date} ${order.startTime}, ${order.address ?? "адрес уточняется"}, оплата ${order.basePay}₽`,
      }))
    );
  }
}

/**
 * Просроченные открытые заказы (дата смены прошла):
 * без принятых исполнителей — отменяем; с принятыми — переводим в работу,
 * чтобы работодатель мог завершить заказ и оставить отзывы.
 */
async function closeExpiredOrders() {
  const expired = await db
    .select({
      id: orders.id,
      employerId: orders.employerId,
      date: orders.date,
      acceptedCount: sql<number>`(
        SELECT COUNT(*) FROM ${responses}
        WHERE ${responses.orderId} = ${orders.id} AND ${responses.status} = 'accepted'
      )::int`,
    })
    .from(orders)
    .where(and(eq(orders.status, "open"), lt(orders.date, todayString())))
    .limit(200);

  if (expired.length === 0) return;

  const toCancel = expired.filter((o) => Number(o.acceptedCount) === 0).map((o) => o.id);
  const toProgress = expired.filter((o) => Number(o.acceptedCount) > 0).map((o) => o.id);

  if (toCancel.length > 0) {
    await db.update(orders).set({ status: "cancelled" }).where(inArray(orders.id, toCancel));
  }
  if (toProgress.length > 0) {
    await db.update(orders).set({ status: "in_progress" }).where(inArray(orders.id, toProgress));
  }
  await invalidateOrdersCache();

  // Сообщаем работодателям об автоотменённых заказах.
  const cancelled = expired.filter((o) => toCancel.includes(o.id));
  const employerIds = [...new Set(cancelled.map((o) => o.employerId))];
  if (employerIds.length > 0) {
    const emps = await db
      .select({ id: users.id, telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
      .from(users)
      .where(inArray(users.id, employerIds));
    const byId = new Map(emps.map((e) => [e.id, e]));
    notifyInBackground(
      cancelled.flatMap((o) => {
        const e = byId.get(o.employerId);
        return e?.notifyEnabled
          ? [{ telegramId: e.telegramId, text: `⌛ Заказ на ${o.date} автоматически отменён: дата прошла, исполнители не были выбраны.` }]
          : [];
      })
    );
  }
}

/**
 * На следующий день после смены напоминаем работодателю завершить заказ
 * и оставить отзывы (без завершения отзывы недоступны).
 */
async function remindToComplete() {
  const due = await db
    .select({
      id: orders.id,
      date: orders.date,
      employerId: orders.employerId,
      telegramId: users.telegramId,
      notifyEnabled: users.notifyEnabled,
    })
    .from(orders)
    .innerJoin(users, eq(orders.employerId, users.id))
    .where(
      and(
        eq(orders.status, "in_progress"),
        lt(orders.date, todayString()),
        isNull(orders.completeReminderSentAt)
      )
    )
    .limit(100);

  if (due.length === 0) return;

  await db
    .update(orders)
    .set({ completeReminderSentAt: new Date() })
    .where(inArray(orders.id, due.map((o) => o.id)));

  notifyInBackground(
    due
      .filter((o) => o.notifyEnabled)
      .map((o) => ({
        telegramId: o.telegramId,
        text: `📝 Смена ${o.date} прошла. Завершите заказ №${o.id.slice(0, 8)} в приложении и оцените исполнителей.`,
      }))
  );
}

/**
 * За час до начала смены просим принятых исполнителей подтвердить выход.
 * Работодатель видит статус подтверждения в списке откликов.
 */
async function remindToConfirm() {
  const now = new Date();
  const rows = await db
    .select({
      responseId: responses.id,
      confirmedAt: responses.confirmedAt,
      date: orders.date,
      startTime: orders.startTime,
      address: orders.address,
      telegramId: users.telegramId,
      notifyEnabled: users.notifyEnabled,
    })
    .from(responses)
    .innerJoin(orders, eq(responses.orderId, orders.id))
    .innerJoin(users, eq(responses.workerId, users.id))
    .where(
      and(
        eq(responses.status, "accepted"),
        isNull(responses.reminderSentAt),
        isNull(responses.confirmedAt),
        inArray(orders.status, ["open", "in_progress"]),
        eq(orders.date, todayString())
      )
    )
    .limit(200);

  const due = rows.filter((r) => {
    const start = shiftStart(r.date, r.startTime);
    if (!start) return false;
    const diffMin = (start.getTime() - now.getTime()) / 60_000;
    return diffMin <= CONFIRM_WINDOW_MINUTES && diffMin > -30; // окно: за час до и чуть после
  });

  if (due.length === 0) return;

  await db
    .update(responses)
    .set({ reminderSentAt: new Date() })
    .where(inArray(responses.id, due.map((r) => r.responseId)));

  notifyInBackground(
    due
      .filter((r) => r.notifyEnabled)
      .map((r) => ({
        telegramId: r.telegramId,
        text: `⏰ Смена сегодня в ${r.startTime} (${r.address ?? "адрес в заказе"}). Подтвердите выход в приложении.`,
      }))
  );
}

async function tick() {
  // Задачи независимы: ошибка одной не должна ронять остальные.
  const results = await Promise.allSettled([
    broadcastDelayedOrders(),
    closeExpiredOrders(),
    remindToComplete(),
    remindToConfirm(),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("Ошибка фоновой задачи:", r.reason);
  }
}

/** Запуск планировщика: первый прогон сразу, дальше раз в минуту. */
export function startScheduler() {
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.(); // не держим процесс живым только ради таймера
  return timer;
}

// Экспорт для тестов/ручного прогона.
export const _jobs = { broadcastDelayedOrders, closeExpiredOrders, remindToComplete, remindToConfirm };
