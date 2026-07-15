// Пусто = относительные запросы (/api/...) на тот же домен: их проксирует Caddy.
// Абсолютный localhost-дефолт тут опасен — в браузере пользователя это его
// собственное устройство, а не сервер WorkerHub.
const BASE_URL = import.meta.env.VITE_API_URL || "";

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  initData?: string
): Promise<T> {
  const headers: Record<string, string> = {
    // Content-Type только при наличии тела: Fastify отвечает 400
    // на пустое тело с заголовком application/json.
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (initData) {
    headers["Authorization"] = `tma ${initData}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    // 401 = сессия Telegram устарела (приложение долго висело открытым).
    // Говорим человеку, что делать, вместо технического «Invalid initData».
    if (res.status === 401) {
      throw new Error("Сессия устарела. Закройте мини-приложение и откройте его заново.");
    }
    throw new Error(errorData?.error || "Произошла ошибка при запросе к серверу");
  }
  // 204 / пустой ответ
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
