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

/**
 * trustProxy обязателен: backend стоит за прокси, и без него req.ip равен
 * адресу Caddy — ОДИНАКОВОМУ для всех пользователей. Лимит по такому "IP"
 * душил бы всех разом.
 *
 * Значение = число доверенных прокси между клиентом и backend.
 * Прод: клиент → Cloudflare → Caddy → backend, то есть 2.
 * X-Forwarded-For приходит как "реальныйКлиент, IP_Cloudflare", сокет — Caddy;
 * при hops=2 Fastify отдаёт именно реального клиента.
 *
 * Важно: значение должно совпадать с реальной цепочкой. Если убрать Cloudflare
 * (серое облако) и не поправить TRUST_PROXY_HOPS на 1, клиент сможет подделать
 * свой IP через заголовок X-Forwarded-For и обойти лимит.
 */
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 2);

const app = Fastify({ logger: true, trustProxy: TRUST_PROXY_HOPS });

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

async function main() {
  await runMigrations();

  await app.register(cors, { origin: corsOrigins() });

  // Глобальный rate limit — ТОЛЬКО по IP.
  //
  // Важно: этот лимитер работает на этапе onRequest, до проверки подписи
  // Telegram. Любые данные из заголовка тут ещё не подтверждены, поэтому
  // строить по ним ключ нельзя: клиент прислал бы user={"id":1}, {"id":2}, …
  // и получал бы новый счётчик на каждый запрос, полностью обходя лимит.
  // IP — единственное, что на этом этапе подделать нельзя.
  //
  // Ограничения на конкретного пользователя навешиваются отдельно, ПОСЛЕ
  // авторизации — см. perUserRateLimit (backend/src/plugins/rate-limit-user.ts).
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
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
