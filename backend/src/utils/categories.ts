/** Виды работ. Держим в одном месте: схема БД, валидация, тексты уведомлений. */
export const ORDER_CATEGORIES = ["loading", "unloading", "installation"] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<OrderCategory, string> = {
  loading: "Погрузка",
  unloading: "Разгрузка",
  installation: "Монтаж",
};
