import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { orders, responses, users } from "../db/schema.js";
import { eq, and, count } from "drizzle-orm";

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/employer/dashboard — статистика работодателя
  app.get("/api/employer/dashboard", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();

    const byStatus = await db
      .select({ status: orders.status, total: count() })
      .from(orders)
      .where(eq(orders.employerId, me.id))
      .groupBy(orders.status);

    const stats = { open: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const row of byStatus) {
      stats[row.status] = Number(row.total);
    }
    return { rating: me.rating, ratingCount: me.ratingCount, orders: stats };
  });

  // GET /api/worker/stats — статистика исполнителя
  app.get("/api/worker/stats", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();

    const responsesTotal = await db
      .select({ total: count() })
      .from(responses)
      .where(eq(responses.workerId, me.id));

    const completedTotal = await db
      .select({ total: count() })
      .from(responses)
      .innerJoin(orders, eq(responses.orderId, orders.id))
      .where(
        and(
          eq(responses.workerId, me.id),
          eq(responses.status, "accepted"),
          eq(orders.status, "completed")
        )
      );

    return {
      rating: me.rating,
      ratingCount: me.ratingCount,
      responses: Number(responsesTotal[0]?.total ?? 0),
      completed: Number(completedTotal[0]?.total ?? 0),
    };
  });
}
