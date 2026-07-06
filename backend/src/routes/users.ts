import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { users, reviews, orders, responses } from "../db/schema.js";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { ORDER_CATEGORIES } from "../utils/categories.js";

// Telegram ID бутстрап-админов задаются ТОЛЬКО через ADMIN_TELEGRAM_IDS.
// Никаких вшитых значений по умолчанию: пустая переменная = ни одного бутстрап-админа.
const ADMIN_IDS = new Set<number>(
  (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
);

interface UpdateMeBody {
  name?: string;
  phone?: string;
  notifyEnabled?: boolean;
  // null = уведомлять о всех категориях; массив = только о выбранных.
  notifyCategories?: string[] | null;
}

interface SetRoleBody {
  role: "employer" | "worker";
}

export async function userRoutes(app: FastifyInstance) {
  // GET /api/me — текущий пользователь (создаётся при первом входе)
  app.get("/api/me", { preHandler: [app.auth] }, async (req) => {
    const tg = req.telegramUser;
    const isAdmin = ADMIN_IDS.has(tg.id);
    const existing = req.dbUser;
    const tgUsername = tg.username ?? null;
    const tgPhoto = tg.photo_url ?? null;

    if (existing) {
      const patch: { role?: "admin"; username?: string | null; photoUrl?: string | null } = {};
      // Бутстрап-админ всегда получает роль admin при входе.
      if (isAdmin && existing.role !== "admin") patch.role = "admin";
      // Держим username и аватар в актуальном состоянии.
      if (existing.username !== tgUsername) patch.username = tgUsername;
      if (existing.photoUrl !== tgPhoto && tgPhoto !== null) patch.photoUrl = tgPhoto;

      if (Object.keys(patch).length > 0) {
        const updated = await db
          .update(users)
          .set(patch)
          .where(eq(users.id, existing.id))
          .returning();
        return updated[0];
      }
      return existing;
    }

    const created = await db
      .insert(users)
      .values({
        telegramId: tg.id,
        role: isAdmin ? "admin" : "worker",
        username: tgUsername,
        photoUrl: tgPhoto,
        name: [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null,
      })
      .returning();
    return created[0];
  });

  // PATCH /api/me/role
  app.patch<{ Body: SetRoleBody }>(
    "/api/me/role",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["employer", "worker"] } },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      // Админ не может случайно понизить себя через онбординг-переключатель.
      if (me.role === "admin") {
        return reply.status(400).send({ error: "Роль администратора меняется только через админ-панель" });
      }
      const updated = await db
        .update(users)
        .set({ role: req.body.role })
        .where(eq(users.id, me.id))
        .returning();
      return updated[0];
    }
  );

  // PATCH /api/me — обновить профиль
  app.patch<{ Body: UpdateMeBody }>(
    "/api/me",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 120 },
            phone: { type: "string", maxLength: 32 },
            notifyEnabled: { type: "boolean" },
            notifyCategories: {
              anyOf: [
                { type: "null" },
                {
                  type: "array",
                  maxItems: 3,
                  items: { type: "string", enum: [...ORDER_CATEGORIES] },
                },
              ],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();

      const { name, phone, notifyEnabled } = req.body;
      const patch: Partial<UpdateMeBody> = {};
      if (name !== undefined) patch.name = name;
      if (phone !== undefined) patch.phone = phone;
      if (notifyEnabled !== undefined) patch.notifyEnabled = notifyEnabled;
      if ("notifyCategories" in req.body) patch.notifyCategories = req.body.notifyCategories;

      // Пустой set() роняет Drizzle («No values to set») — отвечаем 400 явно.
      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: "Нет полей для обновления" });
      }

      const updated = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, me.id))
        .returning();
      if (!updated[0]) return reply.status(404).send();
      return updated[0];
    }
  );

  // GET /api/users/:id — публичный профиль
  app.get<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: [app.auth] },
    async (req, reply) => {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          rating: users.rating,
          ratingCount: users.ratingCount,
          noShowCount: users.noShowCount,
          photoUrl: users.photoUrl,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, req.params.id))
        .limit(1);
      if (!rows[0]) return reply.status(404).send();

      // Сигналы доверия (Слой 2): сколько РАЗНЫХ людей оценивали и сколько
      // завершённых смен за плечами — их трудно накрутить дёшево, в отличие от
      // самой звезды. Показываем рядом с рейтингом.
      const [distinct] = await db
        .select({ c: sql<number>`COUNT(DISTINCT ${reviews.reviewerId})` })
        .from(reviews)
        .where(eq(reviews.targetId, req.params.id));

      // Завершённые заказы, где человек участвовал: как работодатель…
      const [asEmployer] = await db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.employerId, req.params.id), eq(orders.status, "completed")));
      // …или как принятый исполнитель.
      const [asWorker] = await db
        .select({ c: sql<number>`COUNT(DISTINCT ${responses.orderId})` })
        .from(responses)
        .innerJoin(orders, eq(responses.orderId, orders.id))
        .where(
          and(
            eq(responses.workerId, req.params.id),
            eq(responses.status, "accepted"),
            eq(orders.status, "completed")
          )
        );

      return {
        ...rows[0],
        distinctReviewers: Number(distinct?.c ?? 0),
        completedShifts: Number(asEmployer?.c ?? 0) + Number(asWorker?.c ?? 0),
      };
    }
  );

  // GET /api/users/:userId/reviews — отзывы о пользователе
  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId/reviews",
    { preHandler: [app.auth] },
    async (req) => {
      return db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          punctuality: reviews.punctuality,
          quality: reviews.quality,
          adequacy: reviews.adequacy,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
          reviewerId: reviews.reviewerId,
          reviewerName: users.name,
        })
        .from(reviews)
        .leftJoin(users, eq(reviews.reviewerId, users.id))
        .where(eq(reviews.targetId, req.params.userId))
        .orderBy(desc(reviews.createdAt))
        .limit(100);
    }
  );
}
