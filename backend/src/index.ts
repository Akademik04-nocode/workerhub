import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import authPlugin from "./plugins/auth.js";
import { userRoutes } from "./routes/users.js";
import { orderRoutes } from "./routes/orders.js";
import { reviewRoutes } from "./routes/reviews.js";
import { favoriteRoutes } from "./routes/favorites.js";
import { blacklistRoutes } from "./routes/blacklist.js";
import { adminRoutes } from "./routes/admin.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startNotifyWorker } from "./utils/notify.js";

const app = Fastify({ logger: true });

/**
 * Прогон миграций при старте — отдельным соединением (max: 1),
 * чтобы не тащить drizzle-kit в прод-образ.
 */
async function runMigrations() {
  const url = process.env.DATABASE_URL as string;
  const migrationClient = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
    app.log.info("Миграции применены");
  } finally {
    await migrationClient.end();
  }
}

/**
 * Список origin из env; пустая строка/пробелы = разрешить все (dev).
 * В production пустой CORS_ORIGIN — почти наверняка забытая переменная, а не
 * осознанное «пускать всех»: падаем на старте, а не молча открываем API миру.
 */
function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CORS_ORIGIN обязателен в production (укажите https://ваш-домен в .env)"
      );
    }
    return true;
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
}

/**
 * Ключ для rate limit.
 *
 * Раньше ключом был весь заголовок Authorization. Проблема: Telegram выдаёт
 * новый initData при каждом открытии мини-аппа, поэтому у одного и того же
 * человека ключ постоянно менялся и лимит фактически обнулялся при перезаходе;
 * а злоумышленник мог просто слать мусорный заголовок, получая новый лимит на
 * каждый запрос. Плюс в ключ попадала подпись целиком (лишние данные в памяти).
 *
 * Теперь: для авторизованных — стабильный Telegram ID (не меняется от сессии
 * к сессии и подделать его нельзя: он берётся из проверенной подписи).
 * Для остальных — IP.
 *
 * NB: authMiddleware выполняется позже rate limit, поэтому req.telegramUser тут
 * ещё не заполнен — достаём id из initData сами, но БЕЗ доверия: подпись
 * проверяется дальше в auth. Для лимитера этого достаточно (подделка чужого id
 * лишь ускорит исчерпание чужого лимита, а не даст обход своего), но на всякий
 * случай мешаем IP, чтобы нельзя было расходовать лимит другого пользователя.
 */
function rateLimitKey(req: { headers: Record<string, unknown>; ip: string }): string {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const raw = auth.startsWith("tma ") ? auth.slice(4) : auth;
    try {
      const userJson = new URLSearchParams(raw).get("user");
      if (userJson) {
        const id = (JSON.parse(userJson) as { id?: unknown }).id;
        if (typeof id === "number") return `tg:${id}:${req.ip}`;
      }
    } catch {
      /* мусорный заголовок — падаем на IP ниже */
    }
  }
  return `ip:${req.ip}`;
}

async function main() {
  await runMigrations();

  await app.register(cors, { origin: corsOrigins() });

  // Глобальный rate limit: ключ — стабильный Telegram ID (см. rateLimitKey),
  // для неавторизованных запросов — IP.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => rateLimitKey(req as never),
  });

  await app.register(authPlugin);

  await app.register(userRoutes);
  await app.register(orderRoutes);
  await app.register(reviewRoutes);
  await app.register(favoriteRoutes);
  await app.register(blacklistRoutes);
  await app.register(adminRoutes);
  await app.register(dashboardRoutes);

  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Фоновые задачи: отложенная рассылка «сначала избранным», автозакрытие
  // просроченных заказов, напоминания о завершении и подтверждении выхода.
  startScheduler();

  // Воркер рассылки уведомлений: читает очередь из Redis (переживает рестарт).
  startNotifyWorker();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
