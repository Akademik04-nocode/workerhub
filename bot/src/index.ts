import { Bot, InlineKeyboard } from "grammy";
import { Redis } from "ioredis";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const WEBAPP_URL = process.env.WEBAPP_URL ?? "https://example.com";

// ID администраторов (через запятую) — только им доступна команда /obnovit.
const ADMIN_IDS = new Set(
  (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
);

// Redis — общий канал с сервером. /obnovit ставит флаг deploy_requested, а
// фоновый скрипт на сервере (deploy-watcher.sh) видит его и запускает обновление.
// Так бот НЕ получает доступ к Docker или файлам сервера напрямую.
const redis = new Redis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: 3,
});
redis.on("error", (err: Error) => console.error("Redis error:", err.message));

const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard().webApp("Открыть WorkerHub", WEBAPP_URL);
  await ctx.reply(
    "👋 Добро пожаловать в WorkerHub!\n\nБыстрый подбор работников и поиск подработок прямо в Telegram.",
    { reply_markup: keyboard }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "WorkerHub — мини-приложение для найма на сменную работу.\n" +
      "Нажмите /start и откройте приложение, чтобы создавать заказы или откликаться на них."
  );
});

// /obnovit — обновить приложение до свежей версии из GitHub (только для админа).
// Ставит флаг в Redis; сервер подхватит его в течение минуты и пересоберёт
// приложение, после чего пришлёт сюда сообщение о завершении.
bot.command("obnovit", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid || !ADMIN_IDS.has(uid)) {
    await ctx.reply("Команда доступна только администратору.");
    return;
  }
  try {
    await redis.set("deploy_requested", "1");
    await ctx.reply(
      "🔄 Запросил обновление. В течение минуты сервер начнёт пересборку (займёт 2–3 минуты).\n" +
        "Пришлю сообщение, когда всё будет готово."
    );
  } catch (e) {
    console.error("Не удалось поставить флаг обновления:", e);
    await ctx.reply(
      "⚠️ Не получилось запустить обновление — сервер сейчас недоступен. Попробуйте позже."
    );
  }
});

bot.catch((err) => {
  console.error("Ошибка бота:", err);
});

bot.start({
  onStart: (info) => console.log(`Бот @${info.username} запущен`),
});
