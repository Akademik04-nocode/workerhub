import { describe, it, expect, vi, afterEach } from "vitest";
import { validateShiftStart } from "../src/utils/shift-time.js";

// Фиксируем «сейчас», чтобы тесты не зависели от реального времени запуска.
const NOW = new Date(2026, 6, 10, 12, 0, 0); // 10 июля 2026, 12:00 (локальное)

function freezeNow() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("validateShiftStart", () => {
  it("принимает корректную будущую дату", () => {
    freezeNow();
    const r = validateShiftStart("2026-07-11", "10:00");
    expect(r.ok).toBe(true);
  });

  it("отклоняет несуществующую дату (31 февраля)", () => {
    freezeNow();
    const r = validateShiftStart("2026-02-31", "10:00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/не существует/);
  });

  it("отклоняет несуществующий месяц", () => {
    freezeNow();
    const r = validateShiftStart("2026-13-01", "10:00");
    expect(r.ok).toBe(false);
  });

  it("отклоняет прошедшую дату", () => {
    freezeNow();
    const r = validateShiftStart("2026-07-09", "10:00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/прошедшее/);
  });

  it("отклоняет сегодняшнее, но уже прошедшее время", () => {
    freezeNow();
    const r = validateShiftStart("2026-07-10", "09:00"); // сейчас 12:00
    expect(r.ok).toBe(false);
  });

  it("принимает сегодняшнее будущее время", () => {
    freezeNow();
    const r = validateShiftStart("2026-07-10", "18:00");
    expect(r.ok).toBe(true);
  });

  it("допускает небольшой перекос часов клиента", () => {
    freezeNow();
    // 11:58 при «сейчас» 12:00 — в пределах допуска 5 минут
    const r = validateShiftStart("2026-07-10", "11:58");
    expect(r.ok).toBe(true);
  });

  it("отклоняет опечатку в годе (слишком далёкая дата)", () => {
    freezeNow();
    const r = validateShiftStart("2126-07-10", "10:00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/год/);
  });

  it("29 февраля в високосный год — валидно", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2028, 0, 1, 0, 0, 0));
    const r = validateShiftStart("2028-02-29", "10:00");
    expect(r.ok).toBe(true);
  });

  it("29 февраля в невисокосный год — невалидно", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    const r = validateShiftStart("2026-02-29", "10:00");
    expect(r.ok).toBe(false);
  });
});
