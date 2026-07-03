import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { authMiddleware } from "../middleware/auth.js";

/**
 * Регистрирует app.auth как preHandler-хук для защищённых роутов.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorate("auth", authMiddleware);
});
