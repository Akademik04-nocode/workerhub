import { Bot, InlineKeyboard } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const WEBAPP_URL = process.env.WEBAPP_URL ?? "https://example.com";

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

bot.catch((err) => {
  console.error("Ошибка бота:", err);
});

bot.start({
  onStart: (info) => console.log(`Бот @${info.username} запущен`),
});
