import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import type { TelegramUser } from "../types/fastify.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

// Максимальный возраст initData в секундах (защита от replay-атак).
const MAX_AUTH_AGE_SECONDS = Number(process.env.INIT_DATA_TTL ?? 86_400); // 24 часа

type ValidationResult =
  | { valid: true; user: TelegramUser }
  | { valid: false; reason: string };

/**
 * Constant-time сравнение двух hex-строк.
 * Возвращает false, если длины отличаются (без раннего выхода по содержимому).
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateInitData(initData: string): ValidationResult {
  const urlParams = new URLSearchParams(initData);

  const hash = urlParams.get("hash");
  if (!hash) return { valid: false, reason: "missing hash" };
  urlParams.delete("hash");

  // Проверка свежести: auth_date обязателен и не должен быть просрочен.
  const authDateRaw = urlParams.get("auth_date");
  if (!authDateRaw) return { valid: false, reason: "missing auth_date" };
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { valid: false, reason: "bad auth_date" };
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  // Допускаем перекос часов до 5 минут: свежая подпись может выглядеть
  // «из будущего», если часы сервера чуть отстают (реальный случай на VPS).
  const CLOCK_SKEW_TOLERANCE_SECONDS = 300;
  if (ageSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS || ageSeconds > MAX_AUTH_AGE_SECONDS) {
    return { valid: false, reason: "initData expired" };
  }

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN as string)
    .digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(computedHash, hash)) {
    return { valid: false, reason: "bad signature" };
  }

  const rawUser = urlParams.get("user");
  if (!rawUser) return { valid: false, reason: "missing user" };
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    if (typeof user?.id !== "number") return { valid: false, reason: "bad user" };
    return { valid: true, user };
  } catch {
    return { valid: false, reason: "bad user json" };
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("tma ")) {
    return reply.status(401).send({ error: "Missing or invalid auth header" });
  }

  const initData = authHeader.slice(4);
  const result = validateInitData(initData);
  if (!result.valid) {
    request.log.warn({ reason: result.reason }, "initData validation failed");
    return reply.status(401).send({ error: "Invalid initData" });
  }

  request.telegramUser = result.user;

  // Загружаем пользователя из БД один раз на запрос — роуты используют request.dbUser
  // вместо повторных выборок. На первом входе (GET /api/me) пользователя ещё нет — это ок.
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, result.user.id))
    .limit(1);
  request.dbUser = rows[0] ?? null;

  // Глобальная блокировка забаненных: разрешаем только GET /api/me,
  // чтобы клиент мог показать пользователю статус аккаунта.
  const isMeRoute = request.method === "GET" && request.routeOptions?.url === "/api/me";
  if (request.dbUser?.banned && !isMeRoute) {
    return reply.status(403).send({ error: "Аккаунт заблокирован администратором" });
  }
}
