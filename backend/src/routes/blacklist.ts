import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { blacklist, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

interface BlacklistBody {
  blockedUserId: string;
}

export async function blacklistRoutes(app: FastifyInstance) {
  // GET /api/blacklist
  app.get("/api/blacklist", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select({
        id: blacklist.id,
        createdAt: blacklist.createdAt,
        blocked: { id: users.id, name: users.name },
      })
      .from(blacklist)
      .innerJoin(users, eq(blacklist.blockedUserId, users.id))
      .where(eq(blacklist.userId, me.id));
  });

  // POST /api/blacklist
  app.post<{ Body: BlacklistBody }>(
    "/api/blacklist",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["blockedUserId"],
          properties: { blockedUserId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      if (me.id === req.body.blockedUserId) {
        return reply.status(400).send({ error: "Нельзя заблокировать себя" });
      }
      try {
        await db
          .insert(blacklist)
          .values({ userId: me.id, blockedUserId: req.body.blockedUserId });
      } catch {
        return reply.status(409).send({ error: "Уже в чёрном списке" });
      }
      return reply.status(201).send({ success: true });
    }
  );

  // DELETE /api/blacklist
  app.delete<{ Body: BlacklistBody }>(
    "/api/blacklist",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["blockedUserId"],
          properties: { blockedUserId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      await db
        .delete(blacklist)
        .where(
          and(
            eq(blacklist.userId, me.id),
            eq(blacklist.blockedUserId, req.body.blockedUserId)
          )
        );
      return { success: true };
    }
  );
}
