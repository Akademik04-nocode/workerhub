import type { FastifyReply, FastifyRequest } from "fastify";
import { redis } from "../db/index.js";

/**
 * Ограничение частоты по ПРОВЕРЕННОМУ пользователю.
 *
 * Зачем отдельно от глобального лимита: плагин @fastify/rate-limit работает на
 * этапе onRequest — раньше, чем authMiddleware проверит подпись Telegram.
 * Поэтому там доступен только IP: любой id, вытащенный из initData на том
 * этапе, ещё не подтверждён и подделывается тривиально (клиент шлёт
 * user={"id":1}, user={"id":2}, ... и получает новый счётчик на каждый запрос).
 *
 * Этот лимитер вешается preHandler-ом ПОСЛЕ app.auth, поэтому req.dbUser уже
 * заполнен из проверенной подписи и подделать его нельзя.
 *
 * Счётчик — в Redis (INCR + EXPIRE), поэтому переживает перезапуск backend
 * и общий для всех реплик.
 */
/**
 * INCR и установка TTL одной атомарной операцией.
 *
 * Раздельные INCR + EXPIRE опасны: если процесс упадёт (или Redis оборвёт
 * соединение) ровно между ними, ключ останется БЕЗ времени жизни — счётчик
 * никогда не сбросится, и пользователь окажется заблокирован навсегда.
 * Lua-скрипт в Redis выполняется целиком и неделимо, поэтому такого окна нет.
 *
 * Дополнительно лечим ключи без TTL (ttl < 0), если такие остались от старой
 * версии кода: иначе они провисят вечно.
 */
const INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
else
  if redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
end
return count
`;

export function perUserRateLimit(bucket: string, max: number, windowSeconds: number) {
  return async function limiter(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.dbUser?.id;
    // Нет пользователя — значит auth не пропустил бы дальше; пропускаем решение ему.
    if (!userId) return;

    const key = `rl:${bucket}:${userId}`;
    try {
      const count = (await redis.eval(
        INCR_WITH_TTL,
        1,
        key,
        String(windowSeconds)
      )) as number;
      if (count > max) {
        const ttl = await redis.ttl(key);
        return reply.status(429).send({
          error: `Слишком часто. Попробуйте через ${ttl > 0 ? ttl : windowSeconds} сек.`,
        });
      }
    } catch (e) {
      // Redis недоступен — не блокируем работу приложения: глобальный лимит по IP
      // продолжает действовать, а создание заказа важнее строгости счётчика.
      req.log.error({ err: e }, "perUserRateLimit: Redis недоступен, пропускаю запрос");
    }
  };
}
