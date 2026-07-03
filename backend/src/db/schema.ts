import {
  pgTable,
  uuid,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  doublePrecision,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["employer", "worker", "admin"]);
export const orderStatusEnum = pgEnum("order_status", [
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);
export const responseStatusEnum = pgEnum("response_status", [
  "pending",
  "accepted",
  "rejected",
]);

// Виды работ: погрузка, разгрузка, помощь в монтаже.
export const orderCategoryEnum = pgEnum("order_category", [
  "loading",
  "unloading",
  "installation",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    role: roleEnum("role").notNull().default("worker"),
    name: text("name"),
    username: text("username"),
    phone: text("phone"),
    // Числовой рейтинг — без CAST в запросах.
    rating: numeric("rating", { precision: 3, scale: 2 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    notifyEnabled: boolean("notify_enabled").notNull().default(true),
    // Категории, о которых уведомлять (null = все). Пустой массив = никакие.
    notifyCategories: text("notify_categories").array(),
    // Счётчик неявок: работодатель отметил «не вышел» при снятии с заказа.
    noShowCount: integer("no_show_count").notNull().default(0),
    banned: boolean("banned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    telegramIdx: uniqueIndex("users_telegram_id_idx").on(t.telegramId),
  })
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employerId: uuid("employer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("open"),
    category: orderCategoryEnum("category").notNull().default("loading"),
    basePay: integer("base_pay").notNull(),
    overtimeRate: integer("overtime_rate").notNull(),
    minHours: integer("min_hours").notNull(),
    // Сколько исполнителей нужно на смену (мультислот).
    workersNeeded: integer("workers_needed").notNull().default(1),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    address: text("address"),
    description: text("description"),
    minRatingRequired: numeric("min_rating_required", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    // «Сначала избранным»: избранные исполнители уведомляются сразу,
    // остальные — фоновым джобом в broadcastAt (через 10 минут).
    notifyFavoritesFirst: boolean("notify_favorites_first").notNull().default(false),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    broadcastDone: boolean("broadcast_done").notNull().default(true),
    // Напоминание «завершите заказ и оставьте отзывы» отправлено.
    completeReminderSentAt: timestamp("complete_reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("orders_status_idx").on(t.status),
    employerIdx: index("orders_employer_idx").on(t.employerId),
  })
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: responseStatusEnum("status").notNull().default("pending"),
    // Исполнитель подтвердил выход на смену.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Напоминание «подтвердите выход» отправлено (за час до начала).
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Один отклик исполнителя на заказ.
    uniqResp: uniqueIndex("responses_order_worker_idx").on(t.orderId, t.workerId),
  })
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Итоговая оценка = округлённое среднее трёх составляющих.
    rating: integer("rating").notNull(),
    punctuality: integer("punctuality"),
    quality: integer("quality"),
    adequacy: integer("adequacy"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Один отзыв на пару автор→адресат в рамках заказа.
    // (При мультислоте заказчик может оценить каждого исполнителя отдельно.)
    uniqReview: uniqueIndex("reviews_order_reviewer_target_idx").on(
      t.orderId,
      t.reviewerId,
      t.targetId
    ),
  })
);

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqFav: uniqueIndex("favorites_user_target_idx").on(t.userId, t.targetUserId),
  })
);

export const blacklist = pgTable(
  "blacklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqBlock: uniqueIndex("blacklist_user_blocked_idx").on(t.userId, t.blockedUserId),
  })
);

export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Response = typeof responses.$inferSelect;
