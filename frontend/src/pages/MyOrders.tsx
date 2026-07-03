import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram } from "../hooks/useTelegram.js";
import { IconClock, IconPin } from "../components/Icons.js";
import type { Me, Order } from "../types.js";

export function MyOrders() {
  const { initData } = useTelegram();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [role, setRole] = useState<Me["role"]>("worker");
  const [tab, setTab] = useState<"active" | "done">("active");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initData) return;
    (async () => {
      const me = await apiFetch<Me>("/api/me", {}, initData);
      setRole(me.role);
      const path = me.role === "worker" ? "/api/orders/my" : "/api/orders/employer";
      const data = await apiFetch<Order[] | { order: Order }[]>(path, {}, initData);
      const normalized = data.map((d) => ("order" in d ? d.order : d)) as Order[];
      setOrders(normalized);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [initData]);

  const shown = useMemo(
    () =>
      orders.filter((o) =>
        tab === "active"
          ? o.status === "open" || o.status === "in_progress"
          : o.status === "completed" || o.status === "cancelled"
      ),
    [orders, tab]
  );

  const chip = (key: "active" | "done", label: string) => (
    <span
      onClick={() => setTab(key)}
      style={{
        fontSize: 13,
        fontWeight: tab === key ? 600 : 500,
        color: tab === key ? "#fff" : "var(--fg-2)",
        background: tab === key ? "var(--accent)" : "var(--surface)",
        padding: "7px 14px",
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      {label}
    </span>
  );

  const statusText: Record<Order["status"], string> = {
    open: "Открыт",
    in_progress: "Исполнитель найден",
    completed: "Завершён",
    cancelled: "Отменён",
  };

  return (
    <div className="container">
      <h2 className="h-title">Мои заказы</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {chip("active", "Активные")}
        {chip("done", "Завершённые")}
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Загрузка…</p>}
      {!loading && shown.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Заказов нет.</p>
      )}

      {shown.map((o) => (
        <div key={o.id} className="card" style={{ cursor: "pointer" }} onClick={() => navigate(`/order/${o.id}`)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="price" style={{ fontSize: 20 }}>
              {o.basePay.toLocaleString("ru-RU")} ₽
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
              {statusText[o.status]}
            </span>
          </div>
          <div className="meta" style={{ marginTop: 8 }}>
            <IconClock />
            {o.date}, {o.startTime}
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            <IconPin />
            {o.address ?? "адрес уточняется"}
          </div>
          {role !== "worker" && o.acceptedCount !== undefined && (
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                fontWeight: 600,
                color: o.acceptedCount >= o.workersNeeded ? "var(--green)" : "var(--accent)",
              }}
            >
              Выбрано {o.acceptedCount} из {o.workersNeeded}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
