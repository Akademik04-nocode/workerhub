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

/** Список origin из env; пустая строка/пробелы = разрешить все (dev). */
function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return true;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
}

async function main() {
  await runMigrations();

  await app.register(cors, { origin: corsOrigins() });

  // Глобальный rate limit. Ключ — авторизационный заголовок (стабильнее IP
  // за реверс-прокси); для неавторизованных запросов — IP.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
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
