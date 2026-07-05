import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram, showConfirm, openTelegramLink } from "../hooks/useTelegram.js";
import { IconTrash } from "../components/Icons.js";

interface AdminUser {
  id: string;
  telegramId: number;
  name: string | null;
  username: string | null;
  role: "employer" | "worker" | "admin";
  rating: string;
  noShowCount: number;
  banned: boolean;
}
interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerId: string;
  reviewerName: string | null;
  reviewerUsername: string | null;
  targetId: string;
  targetName: string | null;
  targetUsername: string | null;
  orderId: string | null;
  orderTitle: string | null;
  orderDate: string | null;
}
interface AdminOrder {
  id: string;
  title: string | null;
  basePay: number;
  status: string;
  date: string;
  startTime: string;
}
interface DetailResponse {
  id: string;
  status: "pending" | "accepted" | "rejected";
  confirmedAt: string | null;
  workerId: string;
  workerName: string | null;
  workerUsername: string | null;
  workerRating: string;
  workerNoShow: number;
}
interface DetailReview {
  id: string;
  rating: number;
  comment: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewerUsername: string | null;
  targetId: string;
  targetName: string | null;
  targetUsername: string | null;
}
interface OrderDetail {
  order: {
    id: string;
    title: string | null;
    status: string;
    basePay: number;
    workersNeeded: number;
    date: string;
    startTime: string;
    address: string | null;
    description: string | null;
    employerId: string | null;
    employerName: string | null;
    employerUsername: string | null;
    employerRating: string | null;
  };
  responses: DetailResponse[];
  reviews: DetailReview[];
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

const ORDER_STATUS: Record<string, string> = {
  open: "Открыт",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
};
const RESP_STATUS: Record<string, { label: string; color: string }> = {
  accepted: { label: "Выбран", color: "var(--accent)" },
  pending: { label: "Откликнулся", color: "var(--muted)" },
  rejected: { label: "Отклонён", color: "var(--faint)" },
};

export function AdminPanel() {
  const { initData } = useTelegram();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [userQuery, setUserQuery] = useState("");

  // Раскрытый заказ и его подробности (грузятся по клику).
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!initData) return;
    if (section === "stats") setStats(await apiFetch<Stats>("/api/admin/stats", {}, initData));
    if (section === "users") {
      const q = userQuery.trim();
      const path = q ? `/api/admin/users?q=${encodeURIComponent(q)}` : "/api/admin/users";
      setUsers(await apiFetch<AdminUser[]>(path, {}, initData));
    }
    if (section === "reviews") setReviews(await apiFetch<AdminReview[]>("/api/admin/reviews", {}, initData));
    if (section === "orders") setOrders(await apiFetch<AdminOrder[]>("/api/admin/orders", {}, initData));
  }, [initData, section, userQuery]);

  // Небольшой дебаунс: гасит частые перезапросы при вводе в поиск.
  useEffect(() => {
    const t = setTimeout(() => reload().catch(() => {}), 250);
    return () => clearTimeout(t);
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
    if (expandedOrder === id) setExpandedOrder(null);
    reload();
  };

  const toggleOrder = async (id: string) => {
    if (expandedOrder === id) {
      setExpandedOrder(null);
      setOrderDetail(null);
      return;
    }
    setExpandedOrder(id);
    setOrderDetail(null);
    setDetailLoading(true);
    try {
      setOrderDetail(await apiFetch<OrderDetail>(`/api/admin/orders/${id}`, {}, initData));
    } catch {
      /* оставим панель пустой */
    } finally {
      setDetailLoading(false);
    }
  };

  // Имя-ссылка на профиль + опциональный кликабельный @username (открывает Telegram).
  const person = (
    id: string | null,
    name: string | null,
    username: string | null | undefined
  ) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        onClick={() => id && navigate(`/user/${id}`)}
        style={{ color: "var(--accent)", cursor: id ? "pointer" : "default", fontWeight: 500 }}
      >
        {name ?? "—"}
      </span>
      {username && (
        <span
          onClick={() => openTelegramLink(username)}
          style={{ color: "var(--muted)", cursor: "pointer", fontSize: 12 }}
        >
          @{username}
        </span>
      )}
    </span>
  );

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

      {section === "users" && (
        <>
          <input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Поиск по имени, @username или id"
            style={{ marginBottom: 12 }}
          />
          {users.length === 0 && <p style={{ color: "var(--muted)" }}>Ничего не найдено.</p>}
          {users.map((u) => (
            <div key={u.id} className="card">
              <div style={{ fontWeight: 600 }}>
                <span onClick={() => navigate(`/user/${u.id}`)} style={{ cursor: "pointer" }}>
                  {u.name ?? "Без имени"}
                </span>{" "}
                {u.banned && <span style={{ color: "var(--danger)" }}>· бан</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                id {u.telegramId} · ★ {Number(u.rating).toFixed(1)}
                {u.noShowCount > 0 && (
                  <span style={{ color: "var(--danger)" }}> · неявок {u.noShowCount}</span>
                )}
              </div>
              {u.username && (
                <div
                  onClick={() => openTelegramLink(u.username as string)}
                  style={{ fontSize: 13, color: "var(--accent)", cursor: "pointer", marginTop: 2 }}
                >
                  @{u.username}
                </div>
              )}
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
        </>
      )}

      {section === "reviews" &&
        reviews.map((r) => (
          <div key={r.id} className="card" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 14 }}>
                <span style={{ color: "var(--gold)" }}>{"★".repeat(r.rating)}</span>
                {person(r.reviewerId, r.reviewerName, r.reviewerUsername)}
                <span style={{ color: "var(--muted)" }}>→</span>
                {person(r.targetId, r.targetName, r.targetUsername)}
              </div>
              {r.comment && (
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{r.comment}</div>
              )}
              {r.orderId && (
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4 }}>
                  Заказ: {r.orderTitle || "без названия"}
                  {r.orderDate ? ` · ${r.orderDate}` : ""}
                </div>
              )}
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
          <div key={o.id} className="card">
            <div
              onClick={() => toggleOrder(o.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {o.title || `${o.basePay.toLocaleString("ru-RU")} ₽`}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {o.date} {o.startTime} · {ORDER_STATUS[o.status] ?? o.status} ·{" "}
                  {o.basePay.toLocaleString("ru-RU")} ₽
                </div>
              </div>
              <span style={{ color: "var(--faint)", fontSize: 15 }}>
                {expandedOrder === o.id ? "▲" : "▼"}
              </span>
            </div>

            {expandedOrder === o.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--chip)", paddingTop: 12 }}>
                {detailLoading && <div style={{ color: "var(--muted)" }}>Загрузка…</div>}
                {orderDetail && orderDetail.order.id === o.id && (
                  <>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
                      Нужно исполнителей: {orderDetail.order.workersNeeded}
                      {orderDetail.order.address ? ` · ${orderDetail.order.address}` : ""}
                    </div>
                    {orderDetail.order.description && (
                      <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.45 }}>
                        {orderDetail.order.description}
                      </div>
                    )}

                    <div style={{ fontSize: 13, fontWeight: 600, margin: "6px 0 4px" }}>Работодатель</div>
                    {person(
                      orderDetail.order.employerId,
                      orderDetail.order.employerName,
                      orderDetail.order.employerUsername
                    )}

                    <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>
                      Отклики ({orderDetail.responses.length})
                    </div>
                    {orderDetail.responses.length === 0 && (
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>Откликов нет.</div>
                    )}
                    {orderDetail.responses.map((rp) => (
                      <div
                        key={rp.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 0",
                        }}
                      >
                        <span style={{ fontSize: 14 }}>
                          {person(rp.workerId, rp.workerName, rp.workerUsername)}
                          <span style={{ color: "var(--faint)", fontSize: 12 }}>
                            {" "}★ {Number(rp.workerRating).toFixed(1)}
                            {rp.workerNoShow > 0 ? ` · неявок ${rp.workerNoShow}` : ""}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            color: RESP_STATUS[rp.status]?.color ?? "var(--muted)",
                          }}
                        >
                          {RESP_STATUS[rp.status]?.label ?? rp.status}
                          {rp.status === "accepted" && rp.confirmedAt ? " · вышел ✓" : ""}
                        </span>
                      </div>
                    ))}

                    <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>
                      Отзывы по заказу ({orderDetail.reviews.length})
                    </div>
                    {orderDetail.reviews.length === 0 && (
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>Отзывов нет.</div>
                    )}
                    {orderDetail.reviews.map((rv) => (
                      <div key={rv.id} style={{ padding: "5px 0", fontSize: 13 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--gold)" }}>{"★".repeat(rv.rating)}</span>
                          {person(rv.reviewerId, rv.reviewerName, rv.reviewerUsername)}
                          <span style={{ color: "var(--muted)" }}>→</span>
                          {person(rv.targetId, rv.targetName, rv.targetUsername)}
                        </div>
                        {rv.comment && (
                          <div style={{ color: "var(--muted)", marginTop: 2 }}>{rv.comment}</div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {o.status !== "cancelled" && o.status !== "completed" && (
              <button
                className="danger"
                onClick={() => cancelOrder(o.id)}
                style={{ width: "auto", padding: "8px 14px", marginTop: 12 }}
              >
                Отменить заказ
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
