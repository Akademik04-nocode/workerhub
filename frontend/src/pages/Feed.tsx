import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram } from "../hooks/useTelegram.js";
import { IconClock, IconPin, IconUsers, IconStar } from "../components/Icons.js";
import type { Order, OrdersPage } from "../types.js";

type OrderWithEmployer = Order & { employer?: { name: string | null; rating: string } };

const PAGE_LIMIT = 50;

function dayLabel(date: string): string {
  const today = new Date();
  // Парсим "YYYY-MM-DD" как локальную дату: new Date(string) трактует её как UTC,
  // из-за чего «Сегодня» в таймзонах западнее UTC определялось неверно.
  const [y, m, d0] = date.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, d0 ?? 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (same(d, today)) return "Сегодня";
  if (same(d, tomorrow)) return "Завтра";
  return date;
}

export function Feed() {
  const { initData } = useTelegram();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderWithEmployer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "today">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initData) return;
    apiFetch<OrdersPage<OrderWithEmployer>>(`/api/orders?page=${page}&limit=${PAGE_LIMIT}`, {}, initData)
      .then((data) => {
        setOrders((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [initData, page]);

  const shown = useMemo(() => {
    if (filter === "today")
      return orders.filter((o) => dayLabel(o.date) === "Сегодня");
    return orders;
  }, [orders, filter]);

  const chip = (key: "all" | "today", label: string) => (
    <span
      onClick={() => setFilter(key)}
      style={{
        fontSize: 13,
        fontWeight: filter === key ? 600 : 500,
        color: filter === key ? "#fff" : "var(--fg-2)",
        background: filter === key ? "var(--accent)" : "var(--surface)",
        padding: "7px 14px",
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      {label}
    </span>
  );

  return (
    <div className="container">
      <h2 className="h-title">Лента</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {chip("all", "Все")}
        {chip("today", "Сегодня")}
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Загрузка…</p>}
      {error && <p style={{ color: "var(--danger)" }}>Ошибка: {error}</p>}
      {!loading && shown.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Пока нет подходящих заказов.</p>
      )}

      {shown.map((o) => (
        <div key={o.id} className="card" style={{ cursor: "pointer", padding: 0 }} onClick={() => navigate(`/order/${o.id}`)}>
          <div style={{ padding: "15px 16px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="chip">
                <IconUsers size={13} color="var(--chip-fg)" />
                {o.workersNeeded > 1 ? `${o.workersNeeded} человека` : "1 человек"}
              </span>
              <span className="chip chip-orange">{dayLabel(o.date)}</span>
            </div>

            {o.title && (
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, lineHeight: 1.3 }}>
                {o.title}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span className="price">{o.basePay.toLocaleString("ru-RU")} ₽</span>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>от {o.minHours} ч</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="meta">
                <IconClock />
                {o.startTime} · продление {o.overtimeRate} ₽/ч
              </div>
              <div className="meta">
                <IconPin />
                {o.address ?? "адрес уточняется"}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span className="rating">
              <IconStar />
              {o.employer ? `${Number(o.employer.rating).toFixed(1)} · ${o.employer.name ?? "Заказчик"}` : "Заказчик"}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>Подробнее</span>
          </div>
        </div>
      ))}

      {!loading && orders.length < total && (
        <button className="secondary" onClick={() => setPage((p) => p + 1)} style={{ marginTop: 4 }}>
          Показать ещё ({total - orders.length})
        </button>
      )}
    </div>
  );
}
