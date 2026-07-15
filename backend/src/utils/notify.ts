import { redis } from "../db/index.js";

const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;

// ── Очередь уведомлений ─────────────────────────────────────────────────────
// Задачи живут в Redis (не в памяти процесса), поэтому переживают перезапуск
// backend. Схема доставки — at-least-once:
//
//   QUEUE_KEY --RPOPLPUSH--> PROCESSING_KEY --успех--> LREM (удаляем)
//                                           --ошибка--> обратно в QUEUE_KEY
//
// Ключевой момент: задача удаляется ТОЛЬКО после подтверждённой отправки.
// Раньше был LPOP (задача исчезала до отправки), и всё, что не успело уйти
// при падении процесса, терялось молча.
const QUEUE_KEY = "notify_queue";
const PROCESSING_KEY = "notify_processing";
// Батч и пауза под лимит Telegram (~30 сообщений/сек): шлём 25, затем ждём 1 сек.
const BATCH = 25;
const BATCH_PAUSE_MS = 1000;
const IDLE_POLL_MS = 1000;
// Сколько раз пробуем отправить, прежде чем признать задачу мёртвой.
const MAX_ATTEMPTS = 5;
// Мёртвые задачи не выбрасываем: складываем сюда для разбора (dead-letter).
const DEAD_KEY = "notify_dead";
const DEAD_MAX = 1000;

interface NotifyTask {
  telegramId: number;
  text: string;
  /** Сколько раз уже пытались отправить (проставляет воркер). */
  attempts?: number;
}

/** Исход отправки — воркер решает, удалять задачу или вернуть в очередь. */
type SendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; retryAfterMs?: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Отправка одного уведомления с разбором ответа Telegram.
 *
 * Различаем три исхода, потому что реакция на них разная:
 *  - 2xx              → успех, задачу можно удалять;
 *  - 429 / 5xx / сеть → временная проблема, задачу нужно повторить;
 *  - 400 / 403        → постоянная (юзер заблокировал бота, чат не найден):
 *                       повторять бессмысленно, иначе задача крутится вечно.
 */
export async function sendTelegramNotification(
  telegramId: number,
  text: string
): Promise<SendResult> {
  const token = process.env.BOT_TOKEN as string;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text }),
      // Зависший запрос не должен тормозить весь батч.
      signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
    });

    if (res.ok) return { ok: true };

    // 429: Telegram сам говорит, через сколько секунд можно повторить.
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { parameters?: { retry_after?: number } }
        | null;
      const retryAfter = body?.parameters?.retry_after;
      console.error(`Telegram 429 для ${telegramId}, retry_after=${retryAfter ?? "?"}`);
      return {
        ok: false,
        retryable: true,
        retryAfterMs: typeof retryAfter === "number" ? retryAfter * 1000 : undefined,
      };
    }

    // 5xx — проблема на стороне Telegram, имеет смысл повторить.
    if (res.status >= 500) {
      console.error(`Telegram ${res.status} для ${telegramId} — повторим`);
      return { ok: false, retryable: true };
    }

    // 400/403 и прочее: пользователь заблокировал бота или не открывал его.
    // Нормальная ситуация, а не авария — просто больше не пытаемся.
    console.error(`Telegram ${res.status} для ${telegramId} — доставка невозможна`);
    return { ok: false, retryable: false };
  } catch (error) {
    // Таймаут/сеть — временная проблема.
    console.error(`Сбой сети при отправке ${telegramId}:`, error);
    return { ok: false, retryable: true };
  }
}

/**
 * Ставит уведомления в очередь. НЕ блокирует HTTP-ответ.
 * Ошибку Redis пробрасывает наверх: планировщик должен знать, что рассылка
 * не поставлена, и не помечать её выполненной.
 */
export async function notifyInBackground(tasks: NotifyTask[]): Promise<void> {
  if (tasks.length === 0) return;
  await redis.rpush(QUEUE_KEY, ...tasks.map((t) => JSON.stringify(t)));
}

/**
 * Версия для HTTP-роутов: не роняет запрос, если Redis прилёг.
 * Уведомление — не главный результат операции (заказ уже создан), поэтому
 * ошибку логируем и живём дальше.
 */
export function notifyInBackgroundSafe(tasks: NotifyTask[]): void {
  void notifyInBackground(tasks).catch((e) => {
    console.error("notify: не удалось поставить задачи в очередь:", e);
  });
}

function parseTask(raw: string): NotifyTask | null {
  try {
    const t = JSON.parse(raw) as NotifyTask;
    if (typeof t?.telegramId === "number" && typeof t?.text === "string") return t;
  } catch {
    /* битая запись */
  }
  return null;
}

/** Убрать конкретный экземпляр задачи из processing-списка. */
async function ackTask(raw: string) {
  await redis.lrem(PROCESSING_KEY, 1, raw);
}

/** Вернуть задачу в очередь (с увеличенным счётчиком попыток) либо в dead-letter. */
async function requeueTask(raw: string, task: NotifyTask) {
  const attempts = (task.attempts ?? 0) + 1;
  const next: NotifyTask = { ...task, attempts };
  if (attempts >= MAX_ATTEMPTS) {
    // Больше не пытаемся, но и не теряем: кладём в dead-letter для разбора.
    await redis.rpush(DEAD_KEY, JSON.stringify(next));
    await redis.ltrim(DEAD_KEY, -DEAD_MAX, -1);
    console.error(`notify: задача для ${next.telegramId} отброшена после ${attempts} попыток`);
  } else {
    await redis.rpush(QUEUE_KEY, JSON.stringify(next));
  }
  await ackTask(raw);
}

/**
 * Задачи, зависшие в processing после падения процесса, возвращаем в очередь.
 * Вызывается один раз при старте воркера.
 */
async function recoverStaleTasks() {
  try {
    const stale = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (stale.length === 0) return;
    console.error(`notify: возвращаю в очередь ${stale.length} задач после перезапуска`);
    for (const raw of stale) {
      const task = parseTask(raw);
      if (task) await redis.rpush(QUEUE_KEY, JSON.stringify(task));
      await redis.lrem(PROCESSING_KEY, 1, raw);
    }
  } catch (e) {
    console.error("notify: не удалось восстановить зависшие задачи:", e);
  }
}

/**
 * Фоновый воркер: атомарно переносит задачи в processing (RPOPLPUSH),
 * рассылает и подтверждает только успешные. Всё, что не отправилось по
 * временной причине, возвращается в очередь и будет повторено.
 */
export function startNotifyWorker() {
  void (async () => {
    await recoverStaleTasks();

    for (;;) {
      try {
        // Забираем батч атомарно: задача покидает очередь, но остаётся
        // в processing до подтверждения — при падении её подберёт recover.
        const claimed: string[] = [];
        for (let i = 0; i < BATCH; i++) {
          const raw = await redis.rpoplpush(QUEUE_KEY, PROCESSING_KEY);
          if (!raw) break;
          claimed.push(raw);
        }
        if (claimed.length === 0) {
          await sleep(IDLE_POLL_MS);
          continue;
        }

        let maxRetryAfterMs = 0;
        await Promise.all(
          claimed.map(async (raw) => {
            const task = parseTask(raw);
            if (!task) {
              await ackTask(raw); // битую запись просто убираем
              return;
            }
            const result = await sendTelegramNotification(task.telegramId, task.text);
            if (result.ok || !result.retryable) {
              await ackTask(raw);
              return;
            }
            if (result.retryAfterMs && result.retryAfterMs > maxRetryAfterMs) {
              maxRetryAfterMs = result.retryAfterMs;
            }
            await requeueTask(raw, task);
          })
        );

        // Если Telegram попросил подождать (429) — уважаем его паузу.
        await sleep(Math.max(BATCH_PAUSE_MS, maxRetryAfterMs));
      } catch (e) {
        console.error("notify worker: ошибка цикла:", e);
        await sleep(2000);
      }
    }
  })();
}
