import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useTelegram, showConfirm } from "../hooks/useTelegram.js";
import { IconTrash } from "../components/Icons.js";

interface AdminUser {
  id: string;
  telegramId: number;
  name: string | null;
  role: "employer" | "worker" | "admin";
  rating: string;
  banned: boolean;
}
interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  reviewerName: string | null;
  targetName: string | null;
}
interface AdminOrder {
  id: string;
  basePay: number;
  status: string;
  date: string;
  startTime: string;
}
interface Stats {
  users: number;
  banned: number;
  orders: number;
  openOrders: number;
  reviews: number;
  responses: number;
}

type Section = "stats" | "users" | "reviews" | "orders";

export function AdminPanel() {
  const { initData } = useTelegram();
  const [section, setSection] = useState<Section>("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);

  const reload = useCallback(async () => {
    if (!initData) return;
    if (section === "stats") setStats(await apiFetch<Stats>("/api/admin/stats", {}, initData));
    if (section === "users") setUsers(await apiFetch<AdminUser[]>("/api/admin/users", {}, initData));
    if (section === "reviews") setReviews(await apiFetch<AdminReview[]>("/api/admin/reviews", {}, initData));
    if (section === "orders") setOrders(await apiFetch<AdminOrder[]>("/api/admin/orders", {}, initData));
  }, [initData, section]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const setRole = async (id: string, role: string) => {
    await apiFetch(`/api/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }, initData);
    reload();
  };
  const setBan = async (id: string, banned: boolean) => {
    await apiFetch(`/api/admin/users/${id}/ban`, { method: "PATCH", body: JSON.stringify({ banned }) }, initData);
    reload();
  };
  const delReview = async (id: string) => {
    if (!(await showConfirm("Удалить отзыв? Рейтинг будет пересчитан."))) return;
    await apiFetch(`/api/admin/reviews/${id}`, { method: "DELETE" }, initData);
    reload();
  };
  const cancelOrder = async (id: string) => {
    if (!(await showConfirm("Принудительно отменить заказ?"))) return;
    await apiFetch(`/api/admin/orders/${id}/cancel`, { method: "POST" }, initData);
    reload();
  };

  const navChip = (key: Section, label: string) => (
    <span
      onClick={() => setSection(key)}
      style={{
        fontSize: 13,
        fontWeight: section === key ? 600 : 500,
        color: section === key ? "#fff" : "var(--fg-2)",
        background: section === key ? "var(--accent)" : "var(--surface)",
        padding: "7px 13px",
        borderRadius: 999,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );

  return (
    <div className="container">
      <h2 className="h-title">Админ-панель</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto" }}>
        {navChip("stats", "Сводка")}
        {navChip("users", "Пользователи")}
        {navChip("reviews", "Отзывы")}
        {navChip("orders", "Заказы")}
      </div>

      {section === "stats" && stats && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {([
            ["Пользователи", stats.users],
            ["Забанено", stats.banned],
            ["Заказы", stats.orders],
            ["Открытых", stats.openOrders],
            ["Отзывы", stats.reviews],
            ["Отклики", stats.responses],
          ] as const).map(([label, value]) => (
            <div key={label} className="card" style={{ marginBottom: 0 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {section === "users" &&
        users.map((u) => (
          <div key={u.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {u.name ?? "Без имени"} {u.banned && <span style={{ color: "var(--danger)" }}>· бан</span>}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  id {u.telegramId} · ★ {Number(u.rating).toFixed(1)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <select
                value={u.role}
                onChange={(e) => setRole(u.id, e.target.value)}
                style={{ width: "auto", padding: "8px 10px" }}
              >
                <option value="worker">Исполнитель</option>
                <option value="employer">Работодатель</option>
                <option value="admin">Админ</option>
              </select>
              <button
                className={u.banned ? "secondary" : "danger"}
                onClick={() => setBan(u.id, !u.banned)}
                style={{ width: "auto", padding: "8px 14px" }}
              >
                {u.banned ? "Разбанить" : "Забанить"}
              </button>
            </div>
          </div>
        ))}

      {section === "reviews" &&
        reviews.map((r) => (
          <div key={r.id} className="card" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: "var(--gold)" }}>{"★".repeat(r.rating)}</span> {r.reviewerName ?? "—"} → {r.targetName ?? "—"}
              </div>
              {r.comment && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{r.comment}</div>}
            </div>
            <button
              className="danger"
              onClick={() => delReview(r.id)}
              style={{ width: "auto", padding: "8px 10px" }}
              aria-label="Удалить отзыв"
            >
              <IconTrash />
            </button>
          </div>
        ))}

      {section === "orders" &&
        orders.map((o) => (
          <div key={o.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{o.basePay.toLocaleString("ru-RU")} ₽</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                {o.date} {o.startTime} · {o.status}
              </div>
            </div>
            {o.status !== "cancelled" && o.status !== "completed" && (
              <button className="danger" onClick={() => cancelOrder(o.id)} style={{ width: "auto", padding: "8px 14px" }}>
                Отменить
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
