import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Лимитер ходит в Redis, поэтому подменяем модуль с клиентом на лёгкий мок,
 * который эмулирует поведение Lua-скрипта (INCR + EXPIRE атомарно).
 * Так тест не требует запущенного Redis и проверяет именно логику лимитера.
 */
const store = new Map<string, { count: number; ttl: number }>();
let failRedis = false;

const redisMock = {
  eval: vi.fn(async (_script: string, _numKeys: number, key: string, win: string) => {
    if (failRedis) throw new Error("Redis недоступен");
    const e = store.get(key) ?? { count: 0, ttl: -1 };
    e.count += 1;
    // Скрипт ставит TTL на первом инкременте либо чинит ключ без TTL.
    if (e.count === 1 || e.ttl < 0) e.ttl = Number(win);
    store.set(key, e);
    return e.count;
  }),
  ttl: vi.fn(async (key: string) => store.get(key)?.ttl ?? -2),
};

vi.mock("../src/db/index.js", () => ({ redis: redisMock, db: {} }));

const { perUserRateLimit } = await import("../src/plugins/rate-limit-user.js");

function makeReq(userId?: string) {
  return { dbUser: userId ? { id: userId } : undefined, log: { error: vi.fn() } } as never;
}
function makeReply() {
  const reply = {
    statusCode: 0,
    payload: undefined as unknown,
    status(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(p: unknown) {
      reply.payload = p;
      return reply;
    },
  };
  return reply;
}

beforeEach(() => {
  store.clear();
  failRedis = false;
  // Иначе счётчик вызовов накапливается между тестами.
  redisMock.eval.mockClear();
  redisMock.ttl.mockClear();
});

describe("perUserRateLimit", () => {
  it("пропускает запросы в пределах лимита и блокирует сверх него", async () => {
    const limiter = perUserRateLimit("noisy", 3, 60);
    for (let i = 0; i < 3; i++) {
      const reply = makeReply();
      await limiter(makeReq("u1"), reply as never);
      expect(reply.statusCode).toBe(0); // не заблокирован
    }
    const reply = makeReply();
    await limiter(makeReq("u1"), reply as never);
    expect(reply.statusCode).toBe(429);
  });

  it("считает пользователей раздельно — чужой лимит не мешает", async () => {
    const limiter = perUserRateLimit("noisy", 1, 60);
    const r1 = makeReply();
    await limiter(makeReq("alice"), r1 as never);
    expect(r1.statusCode).toBe(0);

    const r2 = makeReply();
    await limiter(makeReq("alice"), r2 as never);
    expect(r2.statusCode).toBe(429); // alice исчерпала

    const r3 = makeReply();
    await limiter(makeReq("bob"), r3 as never);
    expect(r3.statusCode).toBe(0); // bob не задет
  });

  it("разные bucket'ы не пересекаются", async () => {
    const a = perUserRateLimit("bucketA", 1, 60);
    const b = perUserRateLimit("bucketB", 1, 60);
    const r1 = makeReply();
    await a(makeReq("u1"), r1 as never);
    const r2 = makeReply();
    await b(makeReq("u1"), r2 as never); // другой bucket — свой счётчик
    expect(r2.statusCode).toBe(0);
  });

  it("ключ без TTL самолечится (иначе блокировка навсегда)", async () => {
    // Эмулируем «осиротевший» ключ: счётчик есть, TTL нет.
    store.set("rl:noisy:u1", { count: 5, ttl: -1 });
    const limiter = perUserRateLimit("noisy", 3, 60);
    const reply = makeReply();
    await limiter(makeReq("u1"), reply as never);
    expect(reply.statusCode).toBe(429); // лимит превышен — блокируем
    expect(store.get("rl:noisy:u1")!.ttl).toBe(60); // но TTL восстановлен
  });

  it("при недоступном Redis пропускает запрос, а не роняет его", async () => {
    failRedis = true;
    const limiter = perUserRateLimit("noisy", 1, 60);
    const reply = makeReply();
    await limiter(makeReq("u1"), reply as never);
    expect(reply.statusCode).toBe(0); // fail-open: глобальный лимит по IP остаётся
  });

  it("без авторизованного пользователя решение оставляет auth", async () => {
    const limiter = perUserRateLimit("noisy", 1, 60);
    const reply = makeReply();
    await limiter(makeReq(undefined), reply as never);
    expect(reply.statusCode).toBe(0);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});
