import { FastifyInstance } from "fastify";
import { db, redis } from "../db/index.js";
import { orders, responses, users, reviews, blacklist } from "../db/schema.js";
import { eq, and, or, asc, desc, sql, count, inArray, getTableColumns } from "drizzle-orm";
import { parsePaymentString } from "../utils/parser.js";
import { recalcRating, overallRating } from "../utils/rating.js";
import { notifyInBackground } from "../utils/notify.js";
import { eligibleWorkersForOrder } from "../utils/eligibility.js";
import { ORDER_CATEGORIES, CATEGORY_LABELS, type OrderCategory } from "../utils/categories.js";

const CACHE_KEY = "open_orders_cache";
const CACHE_TTL_SECONDS = 30;
// Фора избранным: остальные исполнители получают уведомление через 10 минут.
const FAVORITES_HEAD_START_MS = 10 * 60_000;

async function invalidateOrdersCache() {
  try {
    await redis.del(CACHE_KEY);
  } catch (e) {
    console.error("Не удалось инвалидировать кэш заказов:", e);
  }
}

/**
 * Условие «пара работодатель ↔ исполнитель не блокирует друг друга».
 * Применимо в WHERE-запросах по таблице orders.
 */
function notBlockedCondition(workerId: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${blacklist}
    WHERE (${blacklist.userId} = ${orders.employerId} AND ${blacklist.blockedUserId} = ${workerId})
       OR (${blacklist.userId} = ${workerId} AND ${blacklist.blockedUserId} = ${orders.employerId})
  )`;
}

/** true, если работодатель и исполнитель заблокировали друг друга (в любую сторону). */
async function isBlockedPair(employerId: string, workerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: blacklist.id })
    .from(blacklist)
    .where(
      or(
        and(eq(blacklist.userId, employerId), eq(blacklist.blockedUserId, workerId)),
        and(eq(blacklist.userId, workerId), eq(blacklist.blockedUserId, employerId))
      )
    )
    .limit(1);
  return !!rows[0];
}

interface CreateOrderBody {
  paymentString: string;
  category: OrderCategory;
  notifyFavoritesFirst?: boolean;
  date: string;
  startTime: string;
  address?: string;
  description?: string;
  minRating?: number;
  workersNeeded?: number;
  latitude?: number;
  longitude?: number;
}

const createOrderSchema = {
  body: {
    type: "object",
    required: ["paymentString", "category", "date", "startTime"],
    properties: {
      paymentString: { type: "string", minLength: 3 },
      category: { type: "string", enum: [...ORDER_CATEGORIES] },
      notifyFavoritesFirst: { type: "boolean" },
      date: { type: "string" },
      startTime: { type: "string" },
      address: { type: "string" },
      description: { type: "string" },
      minRating: { type: "number", minimum: 0, maximum: 5 },
      workersNeeded: { type: "integer", minimum: 1, maximum: 50 },
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 },
    },
  },
};

const listOrdersSchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      category: { type: "string", enum: [...ORDER_CATEGORIES] },
    },
  },
};

// Жёсткий лимит на «шумные» операции (создание/донабор рассылают уведомления всем).
const noisyRateLimit = {
  rateLimit: { max: 5, timeWindow: "1 minute" },
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function orderRoutes(app: FastifyInstance) {
  // POST /api/orders — создать заказ (работодатель)
  app.post<{ Body: CreateOrderBody }>(
    "/api/orders",
    { preHandler: [app.auth], schema: createOrderSchema, config: noisyRateLimit },
    async (req, reply) => {
      const employer = req.dbUser;
      const {
        paymentString,
        category,
        notifyFavoritesFirst,
        date,
        startTime,
        address,
        description,
        minRating,
        workersNeeded,
        latitude,
        longitude,
      } = req.body;

      if (employer?.role !== "employer") {
        return reply.status(403).send({ error: "Только работодатели могут создавать заказы" });
      }

      const parsed = parsePaymentString(paymentString);
      if (!parsed) return reply.status(400).send({ error: "Неверный формат оплаты" });

      const minRatingNum = isFiniteNumber(minRating) ? minRating : 0;
      const favFirst = notifyFavoritesFirst === true;

      const newOrder = await db
        .insert(orders)
        .values({
          employerId: employer.id,
          category,
          // «Сначала избранным»: вторая волна уведомлений уйдёт фоновым джобом.
          notifyFavoritesFirst: favFirst,
          broadcastDone: !favFirst,
          broadcastAt: favFirst ? new Date(Date.now() + FAVORITES_HEAD_START_MS) : null,
          basePay: parsed.basePay,
          overtimeRate: parsed.overtimeRate,
          minHours: parsed.minHours,
          workersNeeded: isFiniteNumber(workersNeeded) ? Math.max(1, Math.round(workersNeeded)) : 1,
          date,
          startTime,
          address,
          description,
          minRatingRequired: String(minRatingNum),
          // 0 — валидная координата: проверяем Number.isFinite, а не truthiness.
          latitude: isFiniteNumber(latitude) ? latitude : null,
          longitude: isFiniteNumber(longitude) ? longitude : null,
        })
        .returning();

      await invalidateOrdersCache();

      // Первая волна: только избранные (если включено) или сразу все.
      const eligible = await eligibleWorkersForOrder(
        employer.id,
        minRatingNum,
        category,
        favFirst ? { favoritesOnly: true } : {}
      );
      const star = favFirst ? "⭐ " : "";
      notifyInBackground(
        eligible.map((w) => ({
          telegramId: w.telegramId,
          text: `${star}🆕 ${CATEGORY_LABELS[category]}: ${date} ${startTime}, ${address ?? "адрес уточняется"}, оплата ${parsed.basePay}₽`,
        }))
      );

      return reply.status(201).send(newOrder[0]);
    }
  );

  // GET /api/orders — открытые заказы (исполнитель), фильтр по рейтингу и чёрному списку.
  // Ответ: { items, total, page, limit } — клиент знает, есть ли следующая страница.
  app.get<{ Querystring: { page?: number; limit?: number; category?: OrderCategory } }>(
    "/api/orders",
    { preHandler: [app.auth], schema: listOrdersSchema },
    async (req, reply) => {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 50);
      const category = req.query.category;
      const offset = (page - 1) * limit;

      const dbUser = req.dbUser;
      if (!dbUser) return reply.status(404).send();

      // Срез ленты зависит от рейтинга, чёрного списка и фильтра категории.
      // Инвалидация одним DEL CACHE_KEY очищает срезы всех пользователей сразу.
      const cacheField = `u${dbUser.id}_p${page}_l${limit}_c${category ?? "all"}`;
      try {
        const cached = await redis.hget(CACHE_KEY, cacheField);
        if (cached) return JSON.parse(cached);
      } catch {
        /* кэш недоступен — идём в БД */
      }

      // Новичок без отзывов (ratingCount = 0) видит все заказы: порог рейтинга —
      // фильтр по репутации, а у новичка её ещё нет.
      const ratingCondition =
        dbUser.ratingCount === 0
          ? undefined
          : sql`${orders.minRatingRequired} <= ${dbUser.rating}::numeric`;

      const whereConditions = and(
        eq(orders.status, "open"),
        category ? eq(orders.category, category) : undefined,
        ratingCondition,
        notBlockedCondition(dbUser.id)
      );

      const [items, totalRows] = await Promise.all([
        db
          .select({
            id: orders.id,
            category: orders.category,
            basePay: orders.basePay,
            overtimeRate: orders.overtimeRate,
            minHours: orders.minHours,
            workersNeeded: orders.workersNeeded,
            date: orders.date,
            startTime: orders.startTime,
            address: orders.address,
            description: orders.description,
            status: orders.status,
            latitude: orders.latitude,
            longitude: orders.longitude,
            createdAt: orders.createdAt,
            employer: { id: users.id, name: users.name, rating: users.rating },
          })
          .from(orders)
          .leftJoin(users, eq(orders.employerId, users.id))
          .where(whereConditions)
          .orderBy(desc(orders.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ c: count() }).from(orders).where(whereConditions),
      ]);

      const payload = { items, total: Number(totalRows[0]?.c ?? 0), page, limit };

      try {
        await redis.hset(CACHE_KEY, cacheField, JSON.stringify(payload));
        const ttl = await redis.ttl(CACHE_KEY);
        if (ttl < 0) await redis.expire(CACHE_KEY, CACHE_TTL_SECONDS);
      } catch {
        /* кэш недоступен — не критично */
      }

      return payload;
    }
  );

  // GET /api/orders/employer — заказы работодателя (с числом принятых исполнителей)
  app.get("/api/orders/employer", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select({
        ...getTableColumns(orders),
        acceptedCount: sql<number>`(
          SELECT COUNT(*) FROM ${responses}
          WHERE ${responses.orderId} = ${orders.id} AND ${responses.status} = 'accepted'
        )::int`,
      })
      .from(orders)
      .where(eq(orders.employerId, me.id))
      .orderBy(desc(orders.createdAt));
  });

  // GET /api/orders/my — принятые заказы исполнителя
  app.get("/api/orders/my", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select({ order: orders })
      .from(responses)
      .innerJoin(orders, eq(responses.orderId, orders.id))
      .where(and(eq(responses.workerId, me.id), eq(responses.status, "accepted")))
      .orderBy(desc(orders.createdAt));
  });

  // GET /api/orders/history/worker
  app.get("/api/orders/history/worker", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select({ order: orders })
      .from(responses)
      .innerJoin(orders, eq(responses.orderId, orders.id))
      .where(
        and(
          eq(responses.workerId, me.id),
          eq(responses.status, "accepted"),
          eq(orders.status, "completed")
        )
      )
      .orderBy(desc(orders.createdAt));
  });

  // GET /api/orders/history/employer
  app.get("/api/orders/history/employer", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.employerId, me.id), eq(orders.status, "completed")))
      .orderBy(desc(orders.createdAt));
  });

  // GET /api/orders/:id — детали.
  // telegram_id работодателя НЕ отдаём: это лишний персональный идентификатор,
  // для кнопки «Написать» достаточно username.
  app.get<{ Params: { id: string } }>(
    "/api/orders/:id",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { id } = req.params;
      const rows = await db
        .select({
          id: orders.id,
          employerId: orders.employerId,
          status: orders.status,
          basePay: orders.basePay,
          overtimeRate: orders.overtimeRate,
          minHours: orders.minHours,
          workersNeeded: orders.workersNeeded,
          date: orders.date,
          startTime: orders.startTime,
          address: orders.address,
          description: orders.description,
          minRatingRequired: orders.minRatingRequired,
          latitude: orders.latitude,
          longitude: orders.longitude,
          createdAt: orders.createdAt,
          category: orders.category,
          employerName: users.name,
          employerRating: users.rating,
          employerUsername: users.username,
        })
        .from(orders)
        .innerJoin(users, eq(orders.employerId, users.id))
        .where(eq(orders.id, id))
        .limit(1);
      if (!rows[0]) return reply.status(404).send();

      // Свой отклик исполнителя (для кнопок «Откликнуться»/«Подтвердить выход»).
      const me = req.dbUser;
      let myResponse: { id: string; status: string; confirmedAt: Date | null } | null = null;
      if (me && me.id !== rows[0].employerId) {
        const mine = await db
          .select({ id: responses.id, status: responses.status, confirmedAt: responses.confirmedAt })
          .from(responses)
          .where(and(eq(responses.orderId, id), eq(responses.workerId, me.id)))
          .limit(1);
        myResponse = mine[0] ?? null;
      }
      return { ...rows[0], myResponse };
    }
  );

  // POST /api/responses/:responseId/confirm — исполнитель подтверждает выход на смену.
  app.post<{ Params: { responseId: string } }>(
    "/api/responses/:responseId/confirm",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const respRows = await db
        .select()
        .from(responses)
        .where(eq(responses.id, req.params.responseId))
        .limit(1);
      const resp = respRows[0];
      if (!resp || resp.workerId !== me.id) return reply.status(404).send();
      if (resp.status !== "accepted") {
        return reply.status(400).send({ error: "Подтвердить выход можно только по принятому отклику" });
      }

      const orderRows = await db.select().from(orders).where(eq(orders.id, resp.orderId)).limit(1);
      const order = orderRows[0];
      if (!order || order.status === "completed" || order.status === "cancelled") {
        return reply.status(400).send({ error: "Заказ уже закрыт" });
      }

      if (!resp.confirmedAt) {
        await db
          .update(responses)
          .set({ confirmedAt: new Date() })
          .where(eq(responses.id, resp.id));

        const empRows = await db
          .select({ telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
          .from(users)
          .where(eq(users.id, order.employerId))
          .limit(1);
        if (empRows[0]?.notifyEnabled) {
          notifyInBackground([
            {
              telegramId: empRows[0].telegramId,
              text: `👍 ${me.name ?? "Исполнитель"} подтвердил выход на смену ${order.date} ${order.startTime}.`,
            },
          ]);
        }
      }
      return { success: true };
    }
  );

  // GET /api/orders/:id/reviews/mine — кого я уже оценил в этом заказе
  // (чтобы UI не показывал кнопку «Оценить» повторно).
  app.get<{ Params: { id: string } }>(
    "/api/orders/:id/reviews/mine",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      const rows = await db
        .select({ targetId: reviews.targetId })
        .from(reviews)
        .where(and(eq(reviews.orderId, req.params.id), eq(reviews.reviewerId, me.id)));
      return { targetIds: rows.map((r) => r.targetId) };
    }
  );

  // POST /api/orders/:id/respond — откликнуться (исполнитель)
  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/respond",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { id } = req.params;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      if (me.role !== "worker") {
        return reply.status(403).send({ error: "Только исполнители могут откликаться" });
      }

      const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const order = orderRows[0];
      if (!order) return reply.status(404).send();
      if (order.status !== "open") {
        return reply.status(400).send({ error: "Заказ недоступен для отклика" });
      }

      // Порог рейтинга проверяем и на сервере — знание id заказа не обходит фильтр ленты.
      // Новичок без отзывов (ratingCount = 0) порог проходит.
      if (me.ratingCount > 0 && Number(me.rating) < Number(order.minRatingRequired)) {
        return reply
          .status(403)
          .send({ error: "Ваш рейтинг ниже требуемого для этого заказа" });
      }

      // Взаимный чёрный список блокирует отклик.
      if (await isBlockedPair(order.employerId, me.id)) {
        return reply.status(403).send({ error: "Отклик на этот заказ недоступен" });
      }

      try {
        await db.insert(responses).values({ orderId: id, workerId: me.id });
      } catch {
        return reply.status(409).send({ error: "Вы уже откликнулись на этот заказ" });
      }

      const employerRows = await db
        .select({ telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
        .from(users)
        .where(eq(users.id, order.employerId))
        .limit(1);
      const employer = employerRows[0];
      if (employer?.notifyEnabled) {
        notifyInBackground([
          { telegramId: employer.telegramId, text: `📬 Новый отклик на ваш заказ №${id.slice(0, 8)}` },
        ]);
      }

      return reply.status(201).send({ success: true });
    }
  );

  // GET /api/orders/:id/responses — список откликов (работодатель).
  // sort=first — кто раньше откликнулся; sort=rating — по убыванию рейтинга.
  app.get<{ Params: { id: string }; Querystring: { sort?: "first" | "rating" } }>(
    "/api/orders/:id/responses",
    {
      preHandler: [app.auth],
      schema: {
        querystring: {
          type: "object",
          properties: { sort: { type: "string", enum: ["first", "rating"] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const sort = req.query.sort ?? "first";
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!orderRows[0] || orderRows[0].employerId !== me.id) {
        return reply.status(403).send();
      }

      const orderBy =
        sort === "rating"
          ? [desc(users.rating), asc(responses.createdAt)]
          : [asc(responses.createdAt)];

      return db
        .select({
          id: responses.id,
          status: responses.status,
          createdAt: responses.createdAt,
          confirmedAt: responses.confirmedAt,
          worker: {
            id: users.id,
            name: users.name,
            rating: users.rating,
            ratingCount: users.ratingCount,
            noShowCount: users.noShowCount,
          },
        })
        .from(responses)
        .innerJoin(users, eq(responses.workerId, users.id))
        .where(eq(responses.orderId, id))
        .orderBy(...orderBy);
    }
  );

  // PATCH /api/responses/:responseId/accept — принять отклик (мультислот, атомарно)
  app.patch<{ Params: { responseId: string } }>(
    "/api/responses/:responseId/accept",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { responseId } = req.params;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const respRows = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1);
      const resp = respRows[0];
      if (!resp) return reply.status(404).send();

      const orderRows = await db.select().from(orders).where(eq(orders.id, resp.orderId)).limit(1);
      const order = orderRows[0];
      if (!order || order.employerId !== me.id) return reply.status(403).send();

      let filled = false;
      try {
        await db.transaction(async (tx) => {
          // Блокируем строку заказа, чтобы сериализовать одновременные приёмы.
          const locked = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, order.id))
            .for("update")
            .limit(1);
          const ord = locked[0];
          if (!ord || ord.status === "completed" || ord.status === "cancelled") {
            throw new Error("Заказ недоступен");
          }

          const current = await tx
            .select()
            .from(responses)
            .where(eq(responses.id, responseId))
            .limit(1);
          if (!current[0] || current[0].status !== "pending") {
            throw new Error("Отклик уже обработан");
          }

          const acceptedRows = await tx
            .select({ c: count() })
            .from(responses)
            .where(and(eq(responses.orderId, order.id), eq(responses.status, "accepted")));
          const acceptedCount = Number(acceptedRows[0]?.c ?? 0);
          if (acceptedCount >= ord.workersNeeded) {
            throw new Error("Все места на заказ уже заняты");
          }

          await tx.update(responses).set({ status: "accepted" }).where(eq(responses.id, responseId));

          if (acceptedCount + 1 >= ord.workersNeeded) {
            await tx.update(orders).set({ status: "in_progress" }).where(eq(orders.id, order.id));
            await tx
              .update(responses)
              .set({ status: "rejected" })
              .where(and(eq(responses.orderId, order.id), eq(responses.status, "pending")));
            filled = true;
          }
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Не удалось принять отклик";
        return reply.status(400).send({ error: message });
      }

      const workerRows = await db
        .select({ telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
        .from(users)
        .where(eq(users.id, resp.workerId))
        .limit(1);
      const worker = workerRows[0];
      if (worker?.notifyEnabled) {
        notifyInBackground([{ telegramId: worker.telegramId, text: "✅ Вас выбрали для заказа" }]);
      }

      if (filled) await invalidateOrdersCache();
      return { success: true, filled };
    }
  );

  // POST /api/orders/:id/complete — завершить заказ (работодатель)
  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/complete",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { id } = req.params;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const order = orderRows[0];
      if (!order || order.employerId !== me.id) {
        return reply.status(403).send({ error: "Только работодатель может завершить заказ" });
      }
      if (order.status !== "in_progress") {
        return reply.status(400).send({ error: "Заказ нельзя завершить в текущем статусе" });
      }

      await db.update(orders).set({ status: "completed" }).where(eq(orders.id, id));
      await invalidateOrdersCache();
      return { success: true };
    }
  );

  // POST /api/orders/:id/cancel — отменить заказ (работодатель)
  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/cancel",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { id } = req.params;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const order = orderRows[0];
      if (!order || order.employerId !== me.id) {
        return reply.status(403).send({ error: "Только работодатель может отменить заказ" });
      }
      if (order.status === "completed" || order.status === "cancelled") {
        return reply.status(400).send({ error: "Заказ уже завершён или отменён" });
      }

      await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id));

      const accepted = await db
        .select({ workerId: responses.workerId })
        .from(responses)
        .where(and(eq(responses.orderId, id), eq(responses.status, "accepted")));
      if (accepted.length > 0) {
        const ids = accepted.map((a) => a.workerId);
        const workers = await db
          .select({ telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
          .from(users)
          .where(inArray(users.id, ids));
        notifyInBackground(
          workers
            .filter((w) => w.notifyEnabled)
            .map((w) => ({
              telegramId: w.telegramId,
              text: `🚫 Заказ №${id.slice(0, 8)} был отменён работодателем.`,
            }))
        );
      }

      await invalidateOrdersCache();
      return { success: true };
    }
  );

  // POST /api/orders/:id/reopen — донабор: заказчик добавляет места,
  // заказ снова становится открытым и появляется в ленте у исполнителей.
  // Атомарно (FOR UPDATE), чтобы не гоняться с параллельными accept.
  app.post<{ Params: { id: string }; Body: { addSlots?: number } }>(
    "/api/orders/:id/reopen",
    {
      preHandler: [app.auth],
      config: noisyRateLimit,
      schema: {
        body: {
          type: "object",
          properties: { addSlots: { type: "integer", minimum: 1, maximum: 50 } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const addSlots = isFiniteNumber(req.body?.addSlots) ? req.body.addSlots : 1;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      let newNeeded = 0;
      let orderInfo: {
        date: string;
        startTime: string;
        basePay: number;
        minRatingRequired: string;
        category: OrderCategory;
      } | null = null;
      try {
        await db.transaction(async (tx) => {
          const locked = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, id))
            .for("update")
            .limit(1);
          const order = locked[0];
          if (!order || order.employerId !== me.id) {
            throw new Error("Только работодатель может открыть донабор");
          }
          if (order.status === "completed" || order.status === "cancelled") {
            throw new Error("Заказ завершён или отменён");
          }

          newNeeded = order.workersNeeded + addSlots;
          orderInfo = {
            date: order.date,
            startTime: order.startTime,
            basePay: order.basePay,
            minRatingRequired: order.minRatingRequired,
            category: order.category,
          };
          await tx
            .update(orders)
            .set({ status: "open", workersNeeded: newNeeded })
            .where(eq(orders.id, id));
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Не удалось открыть донабор";
        return reply.status(400).send({ error: message });
      }

      await invalidateOrdersCache();

      if (orderInfo) {
        const info = orderInfo as {
          date: string;
          startTime: string;
          basePay: number;
          minRatingRequired: string;
          category: OrderCategory;
        };
        const eligible = await eligibleWorkersForOrder(me.id, Number(info.minRatingRequired), info.category);
        notifyInBackground(
          eligible.map((w) => ({
            telegramId: w.telegramId,
            text: `🔁 Донабор (${CATEGORY_LABELS[info.category]}): ${info.date} ${info.startTime}, оплата ${info.basePay}₽`,
          }))
        );
      }

      return { success: true, workersNeeded: newNeeded };
    }
  );

  // POST /api/responses/:responseId/remove — заказчик снимает исполнителя.
  // Разрешено только для активного заказа (open/in_progress): снятие с завершённого
  // задним числом ломало бы историю и статистику исполнителя.
  // Отзыв ОПЦИОНАЛЕН; отметка noShow («не вышел») увеличивает счётчик неявок.
  // Освободившееся место возвращает заказ в ленту.
  app.post<{
    Params: { responseId: string };
    Body: {
      noShow?: boolean;
      review?: { punctuality: number; quality: number; adequacy: number; comment?: string };
    };
  }>(
    "/api/responses/:responseId/remove",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          properties: {
            noShow: { type: "boolean" },
            review: {
              type: "object",
              required: ["punctuality", "quality", "adequacy"],
              properties: {
                punctuality: { type: "integer", minimum: 1, maximum: 5 },
                quality: { type: "integer", minimum: 1, maximum: 5 },
                adequacy: { type: "integer", minimum: 1, maximum: 5 },
                comment: { type: "string", maxLength: 1000 },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { responseId } = req.params;
      const noShow = req.body?.noShow === true;
      const review = req.body?.review;
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const respRows = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1);
      const resp = respRows[0];
      if (!resp) return reply.status(404).send();

      try {
        await db.transaction(async (tx) => {
          // Блокируем заказ и перепроверяем всё внутри транзакции.
          const locked = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, resp.orderId))
            .for("update")
            .limit(1);
          const order = locked[0];
          if (!order || order.employerId !== me.id) {
            throw new Error("Только работодатель может снять исполнителя");
          }
          if (order.status !== "open" && order.status !== "in_progress") {
            throw new Error("Нельзя снять исполнителя с завершённого или отменённого заказа");
          }

          const current = await tx
            .select()
            .from(responses)
            .where(eq(responses.id, responseId))
            .limit(1);
          if (!current[0] || current[0].status !== "accepted") {
            throw new Error("Снять можно только выбранного исполнителя");
          }

          await tx.update(responses).set({ status: "rejected" }).where(eq(responses.id, responseId));

          // «Не вышел»: фиксируем неявку в профиле исполнителя.
          if (noShow) {
            await tx
              .update(users)
              .set({ noShowCount: sql`${users.noShowCount} + 1` })
              .where(eq(users.id, resp.workerId));
          }

          // Отзыв — по желанию работодателя.
          if (review) {
            const existing = await tx
              .select({ id: reviews.id })
              .from(reviews)
              .where(
                and(
                  eq(reviews.orderId, order.id),
                  eq(reviews.reviewerId, me.id),
                  eq(reviews.targetId, resp.workerId)
                )
              )
              .limit(1);
            if (!existing[0]) {
              await tx.insert(reviews).values({
                orderId: order.id,
                reviewerId: me.id,
                targetId: resp.workerId,
                rating: overallRating(review.punctuality, review.quality, review.adequacy),
                punctuality: review.punctuality,
                quality: review.quality,
                adequacy: review.adequacy,
                comment: review.comment,
              });
              await recalcRating(tx, resp.workerId);
            }
          }

          await tx.update(orders).set({ status: "open" }).where(eq(orders.id, order.id));
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Не удалось снять исполнителя";
        return reply.status(400).send({ error: message });
      }

      const workerRows = await db
        .select({ telegramId: users.telegramId, notifyEnabled: users.notifyEnabled })
        .from(users)
        .where(eq(users.id, resp.workerId))
        .limit(1);
      const worker = workerRows[0];
      if (worker?.notifyEnabled) {
        notifyInBackground([
          {
            telegramId: worker.telegramId,
            text: noShow
              ? "⚠️ Заказчик отметил неявку и снял вас с заказа."
              : "ℹ️ Заказчик снял вас с заказа.",
          },
        ]);
      }

      await invalidateOrdersCache();
      return { success: true };
    }
  );
}
