import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { users, orders, reviews, responses } from "../db/schema.js";
import { eq, desc, asc, count, or, ilike, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyRequest, FastifyReply } from "fastify";
import { recalcRating } from "../utils/rating.js";

interface SetRoleBody {
  role: "employer" | "worker" | "admin";
}

// Гард админа: выполняется ПОСЛЕ app.auth, поэтому req.dbUser уже загружен.
async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
  if (req.dbUser?.role !== "admin") {
    return reply.status(403).send({ error: "Доступ только для администратора" });
  }
}

export async function adminRoutes(app: FastifyInstance) {
  // GET /api/admin/users — пользователи. С ?q= ищем по имени, username или
  // Telegram ID (частичное совпадение). Без запроса — последние 200.
  app.get<{ Querystring: { q?: string } }>(
    "/api/admin/users",
    {
      preHandler: [app.auth, adminGuard],
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string" } },
        },
      },
    },
    async (req) => {
      const q = req.query.q?.trim();
      if (q) {
        const like = `%${q}%`;
        return db
          .select()
          .from(users)
          .where(
            or(
              ilike(users.username, like),
              ilike(users.name, like),
              // telegramId — bigint; приводим к тексту для поиска по подстроке.
              sql`${users.telegramId}::text LIKE ${like}`
            )
          )
          .orderBy(desc(users.createdAt))
          .limit(100);
      }
      return db.select().from(users).orderBy(desc(users.createdAt)).limit(200);
    }
  );

  // PATCH /api/admin/users/:id/role — назначить роль (в т.ч. сделать админом)
  app.patch<{ Params: { id: string }; Body: SetRoleBody }>(
    "/api/admin/users/:id/role",
    {
      preHandler: [app.auth, adminGuard],
      schema: {
        body: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["employer", "worker", "admin"] } },
        },
      },
    },
    async (req, reply) => {
      const updated = await db
        .update(users)
        .set({ role: req.body.role })
        .where(eq(users.id, req.params.id))
        .returning();
      if (!updated[0]) return reply.status(404).send();
      return updated[0];
    }
  );

  // PATCH /api/admin/users/:id/ban — бан/разбан
  app.patch<{ Params: { id: string }; Body: { banned: boolean } }>(
    "/api/admin/users/:id/ban",
    {
      preHandler: [app.auth, adminGuard],
      schema: {
        body: {
          type: "object",
          required: ["banned"],
          properties: { banned: { type: "boolean" } },
        },
      },
    },
    async (req, reply) => {
      const updated = await db
        .update(users)
        .set({ banned: req.body.banned })
        .where(eq(users.id, req.params.id))
        .returning();
      if (!updated[0]) return reply.status(404).send();
      return updated[0];
    }
  );

  // GET /api/admin/reviews — последние отзывы (для модерации).
  // Отдаём id автора и адресата (для перехода в профиль), их username
  // и заказ, в рамках которого оставлен отзыв.
  app.get("/api/admin/reviews", { preHandler: [app.auth, adminGuard] }, async () => {
    const reviewer = alias(users, "reviewer");
    const target = alias(users, "target");
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
        reviewerName: reviewer.name,
        reviewerUsername: reviewer.username,
        targetId: reviews.targetId,
        targetName: target.name,
        targetUsername: target.username,
        orderId: reviews.orderId,
        orderTitle: orders.title,
        orderDate: orders.date,
      })
      .from(reviews)
      .leftJoin(reviewer, eq(reviews.reviewerId, reviewer.id))
      .leftJoin(target, eq(reviews.targetId, target.id))
      .leftJoin(orders, eq(reviews.orderId, orders.id))
      .orderBy(desc(reviews.createdAt))
      .limit(200);
  });

  // DELETE /api/admin/reviews/:id — удалить отзыв и пересчитать рейтинг адресата
  app.delete<{ Params: { id: string } }>(
    "/api/admin/reviews/:id",
    { preHandler: [app.auth, adminGuard] },
    async (req, reply) => {
      const rows = await db
        .select({ targetId: reviews.targetId })
        .from(reviews)
        .where(eq(reviews.id, req.params.id))
        .limit(1);
      if (!rows[0]) return reply.status(404).send();
      await db.delete(reviews).where(eq(reviews.id, req.params.id));
      await recalcRating(db, rows[0].targetId);
      return { success: true };
    }
  );

  // GET /api/admin/orders — все заказы (краткий список для вкладки).
  app.get("/api/admin/orders", { preHandler: [app.auth, adminGuard] }, async () => {
    return db
      .select({
        id: orders.id,
        title: orders.title,
        basePay: orders.basePay,
        status: orders.status,
        date: orders.date,
        startTime: orders.startTime,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(200);
  });

  // GET /api/admin/orders/:id — подробности заказа: работодатель, все отклики
  // (кто откликнулся и кого выбрали) и отзывы, оставленные в рамках заказа.
  app.get<{ Params: { id: string } }>(
    "/api/admin/orders/:id",
    { preHandler: [app.auth, adminGuard] },
    async (req, reply) => {
      const { id } = req.params;

      const orderRows = await db
        .select({
          id: orders.id,
          title: orders.title,
          category: orders.category,
          status: orders.status,
          basePay: orders.basePay,
          overtimeRate: orders.overtimeRate,
          minHours: orders.minHours,
          workersNeeded: orders.workersNeeded,
          date: orders.date,
          startTime: orders.startTime,
          address: orders.address,
          description: orders.description,
          createdAt: orders.createdAt,
          employerId: users.id,
          employerName: users.name,
          employerUsername: users.username,
          employerRating: users.rating,
          employerPhotoUrl: users.photoUrl,
        })
        .from(orders)
        .leftJoin(users, eq(orders.employerId, users.id))
        .where(eq(orders.id, id))
        .limit(1);
      if (!orderRows[0]) return reply.status(404).send();

      const respList = await db
        .select({
          id: responses.id,
          status: responses.status,
          confirmedAt: responses.confirmedAt,
          createdAt: responses.createdAt,
          workerId: users.id,
          workerName: users.name,
          workerUsername: users.username,
          workerRating: users.rating,
          workerNoShow: users.noShowCount,
        })
        .from(responses)
        .leftJoin(users, eq(responses.workerId, users.id))
        .where(eq(responses.orderId, id))
        .orderBy(asc(responses.createdAt));

      const reviewer = alias(users, "reviewer");
      const target = alias(users, "target");
      const reviewList = await db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          punctuality: reviews.punctuality,
          quality: reviews.quality,
          adequacy: reviews.adequacy,
          comment: reviews.comment,
          reviewerId: reviews.reviewerId,
          reviewerName: reviewer.name,
          reviewerUsername: reviewer.username,
          targetId: reviews.targetId,
          targetName: target.name,
          targetUsername: target.username,
        })
        .from(reviews)
        .leftJoin(reviewer, eq(reviews.reviewerId, reviewer.id))
        .leftJoin(target, eq(reviews.targetId, target.id))
        .where(eq(reviews.orderId, id));

      return { order: orderRows[0], responses: respList, reviews: reviewList };
    }
  );

  // POST /api/admin/orders/:id/cancel — принудительная отмена любого заказа
  app.post<{ Params: { id: string } }>(
    "/api/admin/orders/:id/cancel",
    { preHandler: [app.auth, adminGuard] },
    async (req, reply) => {
      const updated = await db
        .update(orders)
        .set({ status: "cancelled" })
        .where(eq(orders.id, req.params.id))
        .returning();
      if (!updated[0]) return reply.status(404).send();
      return { success: true };
    }
  );

  // GET /api/admin/stats — сводка
  app.get("/api/admin/stats", { preHandler: [app.auth, adminGuard] }, async () => {
    const [u] = await db.select({ c: count() }).from(users);
    const [o] = await db.select({ c: count() }).from(orders);
    const [openOrders] = await db
      .select({ c: count() })
      .from(orders)
      .where(eq(orders.status, "open"));
    const [r] = await db.select({ c: count() }).from(reviews);
    const [resp] = await db.select({ c: count() }).from(responses);
    const [banned] = await db
      .select({ c: count() })
      .from(users)
      .where(eq(users.banned, true));
    return {
      users: Number(u?.c ?? 0),
      banned: Number(banned?.c ?? 0),
      orders: Number(o?.c ?? 0),
      openOrders: Number(openOrders?.c ?? 0),
      reviews: Number(r?.c ?? 0),
      responses: Number(resp?.c ?? 0),
    };
  });
}
