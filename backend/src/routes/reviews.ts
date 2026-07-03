import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { reviews, orders, responses } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { recalcRating, overallRating } from "../utils/rating.js";

interface CreateReviewBody {
  orderId: string;
  targetId: string;
  punctuality: number;
  quality: number;
  adequacy: number;
  comment?: string;
}

export async function reviewRoutes(app: FastifyInstance) {
  // POST /api/reviews — оставить отзыв.
  // Разрешено только участнику завершённого заказа; повтор блокируется уникальным индексом.
  app.post<{ Body: CreateReviewBody }>(
    "/api/reviews",
    {
      preHandler: [app.auth],
      schema: {
        body: {
          type: "object",
          required: ["orderId", "targetId", "punctuality", "quality", "adequacy"],
          properties: {
            orderId: { type: "string" },
            targetId: { type: "string" },
            punctuality: { type: "integer", minimum: 1, maximum: 5 },
            quality: { type: "integer", minimum: 1, maximum: 5 },
            adequacy: { type: "integer", minimum: 1, maximum: 5 },
            comment: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { orderId, targetId, punctuality, quality, adequacy, comment } = req.body;

      const me = req.dbUser;
      if (!me) return reply.status(404).send();
      if (me.id === targetId) {
        return reply.status(400).send({ error: "Нельзя оставить отзыв самому себе" });
      }

      const orderRows = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      const order = orderRows[0];
      if (!order) return reply.status(404).send({ error: "Заказ не найден" });
      if (order.status !== "completed") {
        return reply
          .status(400)
          .send({ error: "Отзыв можно оставить только по завершённому заказу" });
      }

      // Участники заказа: работодатель и ВСЕ принятые исполнители (мультислот).
      const acceptedRows = await db
        .select({ workerId: responses.workerId })
        .from(responses)
        .where(and(eq(responses.orderId, orderId), eq(responses.status, "accepted")));
      const participants = new Set<string>([
        order.employerId,
        ...acceptedRows.map((r) => r.workerId),
      ]);

      if (!participants.has(me.id)) {
        return reply.status(403).send({ error: "Вы не участвовали в этом заказе" });
      }
      if (!participants.has(targetId)) {
        return reply.status(400).send({ error: "Получатель не участвовал в этом заказе" });
      }
      // Исполнитель оценивает работодателя, работодатель — исполнителей.
      // Отзывы исполнителей друг о друге не имеют смысла.
      if (me.id !== order.employerId && targetId !== order.employerId) {
        return reply.status(400).send({ error: "Исполнители могут оценивать только работодателя" });
      }

      try {
        await db.transaction(async (tx) => {
          await tx.insert(reviews).values({
            orderId,
            reviewerId: me.id,
            targetId,
            // Итог — округлённое среднее трёх составляющих.
            rating: overallRating(punctuality, quality, adequacy),
            punctuality,
            quality,
            adequacy,
            comment,
          });
          // Пересчитываем агрегированный рейтинг получателя «с нуля».
          await recalcRating(tx, targetId);
        });
      } catch {
        return reply
          .status(409)
          .send({ error: "Вы уже оставили отзыв по этому заказу" });
      }

      return reply.status(201).send({ success: true });
    }
  );
}
