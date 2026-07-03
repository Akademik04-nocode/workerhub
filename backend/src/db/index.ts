import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Redis } from "ioredis";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema });

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err: Error) => {
  // Не валим процесс из-за Redis: кэш не критичен для работы API.
  console.error("Redis error:", err.message);
});
