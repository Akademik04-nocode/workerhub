import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../src/utils/db-errors.js";

// Форма ошибки взята с реального postgres.js: code = SQLSTATE,
// имя ограничения — в constraint_name.
describe("isUniqueViolation", () => {
  it("распознаёт конфликт уникального индекса", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("сверяет имя ограничения, если оно указано", () => {
    const err = { code: "23505", constraint_name: "reviews_order_reviewer_target_idx" };
    expect(isUniqueViolation(err, "reviews_order_reviewer_target_idx")).toBe(true);
    expect(isUniqueViolation(err, "другой_индекс")).toBe(false);
  });

  it("не принимает другие ошибки БД за конфликт (иначе 500 маскировался бы под 409)", () => {
    expect(isUniqueViolation({ code: "42P01" })).toBe(false); // таблицы нет
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
  });

  it("не падает на мусоре", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("строка")).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });
});
