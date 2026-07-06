import { eq, sql, inArray } from "drizzle-orm";
import { reviews, users } from "../db/schema.js";
import { db } from "../db/index.js";

// И db, и tx (из db.transaction) имеют совместимые select/update — берём только их,
// чтобы не упираться в проблемы вызова union-типов.
type Executor = Pick<typeof db, "select" | "update">;

// --- Параметры анти-накрутки (можно подстраивать) ---
// Сила сглаживания: сколько «априорных» отзывов по среднему добавляется. Чем
// больше, тем медленнее рейтинг отходит от среднего при малом числе отзывов —
// несколько фейковых пятёрок почти не двигают оценку.
const SMOOTHING_C = 3;
// Если на площадке ещё нет ни одного отзыва — априорное среднее.
const PRIOR_FALLBACK = 4.0;
// Минимальный вес «слабого» автора (совсем новый аккаунт / оценивал одного).
const TRUST_MIN = 0.3;
// После стольких дней аккаунт получает полный «возрастной» вес.
const AGE_FULL_DAYS = 7;
// Автор, оценивший столько РАЗНЫХ людей, получает полный «вес разнообразия».
const DIVERSITY_FULL = 3;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Пересчитывает агрегированный рейтинг пользователя «с нуля» с защитой от накрутки.
 *
 * Три механизма (Слой 1):
 *  1. Схлопывание по уникальным авторам — все отзывы одного автора об этом человеке
 *     дают ОДНУ точку (средний балл). «Фейк-работодатель наставил 50 пятёрок» → вес ~1.
 *  2. Вес доверия автора = возраст_аккаунта × разнообразие_оценённых, а забаненный
 *     автор весит 0. Кластер свежесозданных аккаунтов почти не влияет.
 *  3. Байесовское сглаживание к среднему по площадке: при малом числе оценок рейтинг
 *     тянется к среднему, поэтому пара фейковых пятёрок не даёт мгновенных 5.0.
 *
 * ratingCount по-прежнему = общее число отзывов (для отображения «N оценок»).
 * Работает и с db, и внутри транзакции (tx).
 */
export async function recalcRating(exec: Executor, userId: string) {
  // 1) Все отзывы адресата + возраст/бан автора (reviewerId — FK с cascade,
  //    поэтому у каждого отзыва автор гарантированно существует).
  const rows = await exec
    .select({
      reviewerId: reviews.reviewerId,
      score: reviews.rating,
      reviewerBanned: users.banned,
      reviewerCreatedAt: users.createdAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.reviewerId, users.id))
    .where(eq(reviews.targetId, userId));

  const totalReviews = rows.length;
  if (totalReviews === 0) {
    await exec.update(users).set({ rating: "0", ratingCount: 0 }).where(eq(users.id, userId));
    return;
  }

  // 2) Разнообразие каждого автора: со сколькими РАЗНЫМИ людьми он вообще
  //    взаимодействовал отзывами (по всей площадке). Один запрос на всех авторов.
  const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))];
  const divRows = await exec
    .select({
      reviewerId: reviews.reviewerId,
      distinctTargets: sql<number>`COUNT(DISTINCT ${reviews.targetId})`,
    })
    .from(reviews)
    .where(inArray(reviews.reviewerId, reviewerIds))
    .groupBy(reviews.reviewerId);
  const divMap = new Map(divRows.map((d) => [d.reviewerId, Number(d.distinctTargets)]));

  // 3) Глобальное среднее — априорная точка m для сглаживания.
  const meanRows = await exec.select({ m: sql<string>`AVG(${reviews.rating})` }).from(reviews);
  const m = Number(meanRows[0]?.m) || PRIOR_FALLBACK;

  // 4) Схлопываем отзывы по автору и считаем вес доверия каждого.
  const byReviewer = new Map<string, { scores: number[]; banned: boolean; ageDays: number }>();
  const now = Date.now();
  for (const r of rows) {
    let e = byReviewer.get(r.reviewerId);
    if (!e) {
      const ageDays = (now - new Date(r.reviewerCreatedAt).getTime()) / 86_400_000;
      e = { scores: [], banned: r.reviewerBanned, ageDays };
      byReviewer.set(r.reviewerId, e);
    }
    e.scores.push(r.score);
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [rid, e] of byReviewer) {
    if (e.banned) continue; // забаненный автор — вес 0
    const avgScore = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
    const ageW = clamp(
      TRUST_MIN + (1 - TRUST_MIN) * (Math.min(e.ageDays, AGE_FULL_DAYS) / AGE_FULL_DAYS),
      TRUST_MIN,
      1
    );
    const distinct = divMap.get(rid) ?? 1;
    const divW = clamp(
      TRUST_MIN + (1 - TRUST_MIN) * (Math.min(distinct, DIVERSITY_FULL) / DIVERSITY_FULL),
      TRUST_MIN,
      1
    );
    const w = ageW * divW;
    weightedSum += w * avgScore;
    weightTotal += w;
  }

  // 5) Байесовское сглаживание. Если все авторы забанены (weightTotal=0),
  //    получаем ровно среднее m — то есть «нет доверенных свидетельств».
  const rating = (weightedSum + SMOOTHING_C * m) / (weightTotal + SMOOTHING_C);
  const ratingRounded = clamp(rating, 0, 5);

  await exec
    .update(users)
    .set({ rating: ratingRounded.toFixed(2), ratingCount: totalReviews })
    .where(eq(users.id, userId));
}

/** Итоговая оценка отзыва = округлённое среднее трёх составляющих (1–5). */
export function overallRating(punctuality: number, quality: number, adequacy: number): number {
  return Math.max(1, Math.min(5, Math.round((punctuality + quality + adequacy) / 3)));
}
