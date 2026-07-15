import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { favorites, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { isUniqueViolation } from "../utils/db-errors.js";

interface FavoriteBody {
  targetUserId: string;
}

export async function favoriteRoutes(app: FastifyInstance) {
  // GET /api/favorites — список избранного
  app.get("/api/favorites", { preHandler: [app.auth] }, async (req, reply) => {
    const me = req.dbUser;
    if (!me) return reply.status(404).send();
    return db
      .select({
        id: favorites.id,
        createdAt: favorites.createdAt,
        target: { id: users.id, name: users.name, rating: users.rating },
      })
      .from(favorites)
      .innerJoin(users, eq(favorites.targetUserId, users.id))
      .where(eq(favorites.userId, me.id));
  });

  // POST /api/favorites — добавить в избранное
  app.post<{ Body: FavoriteBody }>(
    "/api/favorites",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["targetUserId"],
          properties: { targetUserId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      if (me.id === req.body.targetUserId) {
        return reply.status(400).send({ error: "Нельзя добавить себя" });
      }
      try {
        await db
          .insert(favorites)
          .values({ userId: me.id, targetUserId: req.body.targetUserId });
      } catch (e) {
        if (isUniqueViolation(e, "favorites_user_target_idx")) {
          return reply.status(409).send({ error: "Уже в избранном" });
        }
        req.log.error({ err: e }, "Не удалось добавить в избранное");
        return reply.status(500).send({ error: "Не удалось добавить в избранное" });
      }
      return reply.status(201).send({ success: true });
    }
  );

  // DELETE /api/favorites — убрать из избранного
  app.delete<{ Body: FavoriteBody }>(
    "/api/favorites",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["targetUserId"],
          properties: { targetUserId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      await db
        .delete(favorites)
        .where(
          and(
            eq(favorites.userId, me.id),
            eq(favorites.targetUserId, req.body.targetUserId)
          )
        );
      return { success: true };
    }
  );
}
