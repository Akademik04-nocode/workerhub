import "fastify";
import type { User } from "../db/schema.js";

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    telegramUser: TelegramUser;
    /** Пользователь из БД (null до первого GET /api/me). Заполняется в authMiddleware. */
    dbUser: User | null;
  }
  interface FastifyInstance {
    auth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
