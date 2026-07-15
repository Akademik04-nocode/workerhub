/**
 * Распознавание ошибок PostgreSQL.
 *
 * Зачем: раньше роуты оборачивали insert в `try { ... } catch { return 409 }`,
 * из-за чего ЛЮБАЯ ошибка (упавшая БД, сбой пересчёта рейтинга, баг в коде)
 * превращалась в «вы уже оставили отзыв». Это врало пользователю и прятало
 * реальные аварии от логов. Теперь 409 отдаём только на настоящий конфликт
 * уникального индекса, остальное пробрасываем в 500 с логом.
 */

/** Код ошибки «нарушение уникального ограничения» в PostgreSQL. */
const UNIQUE_VIOLATION = "23505";

/**
 * true, если ошибка — нарушение уникального индекса.
 * Драйвер postgres.js кладёт SQLSTATE в поле `code`.
 * Если передано имя ограничения — дополнительно проверяем, что конфликт
 * именно по нему (а не по какому-то другому индексу той же таблицы).
 */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (err.code !== UNIQUE_VIOLATION) return false;
  if (!constraint) return true;
  const name = err.constraint_name ?? err.constraint;
  return name === constraint;
}
