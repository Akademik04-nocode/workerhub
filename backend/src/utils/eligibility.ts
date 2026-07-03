import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, blacklist, favorites } from "../db/schema.js";
import type { OrderCategory } from "./categories.js";

interface EligibilityOptions {
  /** Только избранные работодателя (первая волна «сначала избранным»). */
  favoritesOnly?: boolean;
  /** Все, кроме избранных (вторая волна — им уже отправили). */
  excludeFavorites?: boolean;
}

/**
 * Исполнители для уведомления о заказе: включены уведомления, не забанены,
 * подписаны на категорию заказа (null = все категории),
 * проходят порог рейтинга (новички без отзывов проходят всегда)
 * и не находятся во взаимном чёрном списке с работодателем.
 */
export async function eligibleWorkersForOrder(
  employerId: string,
  minRating: number,
  category: OrderCategory,
  opts: EligibilityOptions = {}
) {
  const favCondition = opts.favoritesOnly
    ? sql`EXISTS (
        SELECT 1 FROM ${favorites}
        WHERE ${favorites.userId} = ${employerId} AND ${favorites.targetUserId} = ${users.id}
      )`
    : opts.excludeFavorites
      ? sql`NOT EXISTS (
          SELECT 1 FROM ${favorites}
          WHERE ${favorites.userId} = ${employerId} AND ${favorites.targetUserId} = ${users.id}
        )`
      : undefined;

  return db
    .select({ telegramId: users.telegramId })
    .from(users)
    .where(
      and(
        eq(users.role, "worker"),
        eq(users.notifyEnabled, true),
        eq(users.banned, false),
        // null = подписан на все категории; пустой массив = ни на какие.
        sql`(${users.notifyCategories} IS NULL OR ${category} = ANY(${users.notifyCategories}))`,
        // ratingCount = 0 — «нет данных», а не «плохой рейтинг»: порог не применяем.
        sql`(${users.ratingCount} = 0 OR ${users.rating} >= ${minRating})`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${blacklist}
          WHERE (${blacklist.userId} = ${employerId} AND ${blacklist.blockedUserId} = ${users.id})
             OR (${blacklist.userId} = ${users.id} AND ${blacklist.blockedUserId} = ${employerId})
        )`,
        favCondition
      )
    );
}
