const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;

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

/**
 * Рассылка уведомлений в фоне — НЕ блокирует HTTP-ответ.
 * Батчи, чтобы не упереться в лимит Telegram (~30 сообщений/сек).
 * NB: очередь в памяти процесса — при рестарте невыполненный хвост теряется.
 * Для больших объёмов стоит перейти на очередь в Redis (list + воркер).
 */
export function notifyInBackground(tasks: Array<{ telegramId: number; text: string }>) {
  if (tasks.length === 0) return;
  const BATCH = 25;
  void (async () => {
    for (let i = 0; i < tasks.length; i += BATCH) {
      const slice = tasks.slice(i, i + BATCH);
      await Promise.allSettled(slice.map((t) => sendTelegramNotification(t.telegramId, t.text)));
      if (i + BATCH < tasks.length) await sleep(1000);
    }
  })();
}
