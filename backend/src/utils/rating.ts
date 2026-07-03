import { eq, count, sql } from "drizzle-orm";
import { reviews, users } from "../db/schema.js";
import { db } from "../db/index.js";

// И db, и tx (из db.transaction) имеют совместимые select/update — берём только их,
// чтобы не упираться в проблемы вызова union-типов.
type Executor = Pick<typeof db, "select" | "update">;

/**
 * Пересчитывает агрегированный рейтинг пользователя «с нуля» по всем его отзывам.
 * Без накопления ошибок округления (в отличие от инкрементальной формулы).
 * Работает как с db, так и внутри транзакции (tx).
 */
export async function recalcRating(exec: Executor, userId: string) {
  const agg = await exec
    .select({
      avg: sql<string>`COALESCE(ROUND(AVG(${reviews.rating}), 2), 0)`,
      c: count(),
    })
    .from(reviews)
    .where(eq(reviews.targetId, userId));

  await exec
    .update(users)
    .set({ rating: String(agg[0]?.avg ?? "0"), ratingCount: Number(agg[0]?.c ?? 0) })
    .where(eq(users.id, userId));
}

/** Итоговая оценка отзыва = округлённое среднее трёх составляющих (1–5). */
export function overallRating(punctuality: number, quality: number, adequacy: number): number {
  return Math.max(1, Math.min(5, Math.round((punctuality + quality + adequacy) / 3)));
}
