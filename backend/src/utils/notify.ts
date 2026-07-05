import { redis } from "../db/index.js";

const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;

// Очередь уведомлений живёт в Redis, а не в памяти процесса: при перезапуске
// backend невыполненный хвост рассылки НЕ теряется. Redis — отдельный контейнер,
// поэтому пересборка backend (docker compose up -d --build backend) очередь не
// затрагивает — воркер продолжит с того же места.
const QUEUE_KEY = "notify_queue";
// Батч и пауза под лимит Telegram (~30 сообщений/сек): шлём 25, затем ждём 1 сек.
const BATCH = 25;
const BATCH_PAUSE_MS = 1000;
const IDLE_POLL_MS = 1000;

interface NotifyTask {
  telegramId: number;
  text: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendTelegramNotification(telegramId: number, text: string) {
  const token = process.env.BOT_TOKEN as string;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text }),
      // Зависший запрос не должен тормозить весь батч.
      signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`Telegram API ${res.status} для ${telegramId}`);
  } catch (error) {
    console.error(`Ошибка отправки уведомления пользователю ${telegramId}:`, error);
  }
}

/** Отправить пачку задач напрямую (фолбэк, когда Redis недоступен). */
async function sendDirect(tasks: NotifyTask[]) {
  for (let i = 0; i < tasks.length; i += BATCH) {
    const slice = tasks.slice(i, i + BATCH);
    await Promise.allSettled(slice.map((t) => sendTelegramNotification(t.telegramId, t.text)));
    if (i + BATCH < tasks.length) await sleep(BATCH_PAUSE_MS);
  }
}

/**
 * Ставит уведомления в очередь Redis — НЕ блокирует HTTP-ответ и переживает
 * перезапуск процесса. Если Redis недоступен, отправляет напрямую (без
 * устойчивости, но это лучше, чем потерять уведомление).
 */
export async function notifyInBackground(tasks: NotifyTask[]) {
  if (tasks.length === 0) return;
  try {
    await redis.rpush(QUEUE_KEY, ...tasks.map((t) => JSON.stringify(t)));
  } catch (e) {
    console.error("notify: очередь недоступна, отправляю напрямую:", e);
    void sendDirect(tasks);
  }
}

function parseTask(raw: string): NotifyTask | null {
  try {
    const t = JSON.parse(raw) as NotifyTask;
    if (typeof t?.telegramId === "number" && typeof t?.text === "string") return t;
  } catch {
    /* битая запись — пропускаем */
  }
  return null;
}

/**
 * Фоновый воркер: забирает задачи из очереди Redis батчами и рассылает,
 * соблюдая лимит Telegram. Запускается один раз при старте backend.
 * NB: окно потери минимально — только если процесс упадёт между LPOP и
 * отправкой батча (≤25 сообщений). Плановый перезапуск безопасен: невзятые
 * задачи остаются в Redis и разошлются после старта.
 */
export function startNotifyWorker() {
  void (async () => {
    for (;;) {
      try {
        const raw = (await redis.lpop(QUEUE_KEY, BATCH)) as string[] | null;
        if (!raw || raw.length === 0) {
          await sleep(IDLE_POLL_MS);
          continue;
        }
        const tasks = raw
          .map(parseTask)
          .filter((t): t is NotifyTask => t !== null);
        await Promise.allSettled(
          tasks.map((t) => sendTelegramNotification(t.telegramId, t.text))
        );
        await sleep(BATCH_PAUSE_MS);
      } catch (e) {
        console.error("notify worker: ошибка цикла:", e);
        await sleep(2000);
      }
    }
  })();
}
