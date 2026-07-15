/**
 * Проверка даты и времени начала смены.
 *
 * Схема (JSON Schema) отсекает только форму строки: "2026-02-31" и "2026-13-01"
 * ей соответствуют, хотя таких дат не существует. Здесь проверяем семантику:
 * дата настоящая и смена не в прошлом.
 *
 * Время трактуем в таймзоне процесса (в проде TZ=Europe/Moscow, см.
 * docker-compose): для площадки в одном городе это корректно и совпадает с тем,
 * как даты сравнивает планировщик.
 */

/** Насколько заказ может быть «в прошлом» — небольшой допуск на часы клиента. */
const PAST_TOLERANCE_MS = 5 * 60 * 1000;
/** Дальше этого срока смену планировать бессмысленно (защита от опечаток в годе). */
const MAX_FUTURE_DAYS = 365;

export type ShiftStartCheck =
  | { ok: true; startsAt: Date }
  | { ok: false; error: string };

export function validateShiftStart(date: string, startTime: string): ShiftStartCheck {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);

  // Конструируем дату и сверяем компоненты обратно: JS «переполняет» несуществующие
  // даты (31 февраля → 3 марта), поэтому расхождение = даты не существует.
  const startsAt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (
    Number.isNaN(startsAt.getTime()) ||
    startsAt.getFullYear() !== y ||
    startsAt.getMonth() !== m - 1 ||
    startsAt.getDate() !== d
  ) {
    return { ok: false, error: "Такой даты не существует" };
  }

  const now = Date.now();
  if (startsAt.getTime() < now - PAST_TOLERANCE_MS) {
    return { ok: false, error: "Нельзя создать заказ на прошедшее время" };
  }
  if (startsAt.getTime() > now + MAX_FUTURE_DAYS * 86_400_000) {
    return { ok: false, error: "Слишком далёкая дата — проверьте год" };
  }

  return { ok: true, startsAt };
}
