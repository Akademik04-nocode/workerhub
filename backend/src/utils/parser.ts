export interface ParsedPayment {
  basePay: number;
  overtimeRate: number;
  minHours: number;
}

/**
 * Разбирает строку оплаты формата "база/продление/мин.часы", например "1800/400/4".
 * Возвращает null при некорректном вводе.
 */
export function parsePaymentString(input: unknown): ParsedPayment | null {
  if (typeof input !== "string") return null;

  const parts = input.trim().split("/");
  if (parts.length !== 3) return null;

  const [base, overtime, hours] = parts.map((p) => Number(p.trim()));

  if (![base, overtime, hours].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }
  if (base <= 0 || hours <= 0) return null;

  return {
    basePay: Math.round(base),
    overtimeRate: Math.round(overtime),
    minHours: Math.round(hours),
  };
}
