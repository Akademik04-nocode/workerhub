import { describe, it, expect } from "vitest";
import { parsePaymentString } from "../src/utils/parser.js";

describe("parsePaymentString", () => {
  it("парсит корректную строку", () => {
    expect(parsePaymentString("1800/400/4")).toEqual({
      basePay: 1800,
      overtimeRate: 400,
      minHours: 4,
    });
  });

  it("обрезает пробелы", () => {
    expect(parsePaymentString(" 1800 / 400 / 4 ")).toEqual({
      basePay: 1800,
      overtimeRate: 400,
      minHours: 4,
    });
  });

  it("отклоняет неверный формат", () => {
    expect(parsePaymentString("1800/400")).toBeNull();
    expect(parsePaymentString("abc/def/ghi")).toBeNull();
    expect(parsePaymentString("")).toBeNull();
    expect(parsePaymentString(123 as unknown as string)).toBeNull();
  });

  it("отклоняет нулевую базу и нулевые часы", () => {
    expect(parsePaymentString("0/400/4")).toBeNull();
    expect(parsePaymentString("1800/400/0")).toBeNull();
  });

  it("разрешает нулевую ставку продления", () => {
    expect(parsePaymentString("1800/0/4")).toEqual({
      basePay: 1800,
      overtimeRate: 0,
      minHours: 4,
    });
  });
});
