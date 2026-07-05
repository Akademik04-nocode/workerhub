import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram, showAlert, showConfirm } from "../hooks/useTelegram.js";
import { IconBack, IconClock, IconPin, IconUsers, IconStar } from "../components/Icons.js";
import { ReviewModal } from "../components/ReviewModal.js";
import { Avatar } from "../components/Avatar.js";
import type { Me, Order, ReviewValues } from "../types.js";

const statusLabel: Record<Order["status"], { text: string; color: string; bg: string }> = {
  open: { text: "Открыт", color: "var(--green)", bg: "var(--green-bg)" },
  in_progress: { text: "В работе", color: "var(--accent)", bg: "var(--chip)" },
  completed: { text: "Завершён", color: "var(--chip-fg)", bg: "var(--chip)" },
  cancelled: { text: "Отменён", color: "var(--danger)", bg: "var(--chip)" },
};

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { initData, tg } = useTelegram();
  const [order, setOrder] = useState<Order | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const loadOrder = useCallback(async () => {
    const data = await apiFetch<Order>(`/api/orders/${id}`, {}, initData);
    setOrder(data);
    if (data.status === "completed") {
      const mine = await apiFetch<{ targetIds: string[] }>(
        `/api/orders/${id}/reviews/mine`,
        {},
        initData
      ).catch(() => ({ targetIds: [] }));
      setReviewedIds(mine.targetIds);
    }
  }, [id, initData]);

  useEffect(() => {
    if (!initData) return;
    apiFetch<Me>("/api/me", {}, initData).then(setMe).catch(() => {});
    loadOrder().catch(() => {});
  }, [initData, loadOrder]);

  const respond = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${id}/respond`, { method: "POST" }, initData);
      await loadOrder();
      showAlert("Отклик отправлен");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Подтверждение выхода на смену (за час приходит напоминание от бота).
  const confirmShift = async () => {
    if (!order?.myResponse) return;
    setBusy(true);
    try {
      await apiFetch(`/api/responses/${order.myResponse.id}/confirm`, { method: "POST" }, initData);
      await loadOrder();
      showAlert("Выход подтверждён. Хорошей смены!");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Отзыв о работодателе по завершённому заказу.
  const submitEmployerReview = async (values: ReviewValues) => {
    try {
      await apiFetch(
        "/api/reviews",
        {
          method: "POST",
          body: JSON.stringify({
            orderId: id,
            targetId: order?.employerId,
            punctuality: values.punctuality,
            quality: values.quality,
            adequacy: values.adequacy,
            comment: values.comment || undefined,
          }),
        },
        initData
      );
      await loadOrder();
      showAlert("Отзыв сохранён");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
      throw e;
    }
  };

  const cancel = async () => {
    if (!(await showConfirm("Отменить этот заказ?"))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${id}/cancel`, { method: "POST" }, initData);
      await loadOrder();
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!(await showConfirm("Открыть донабор? Заказ снова появится в ленте у исполнителей."))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${id}/reopen`, { method: "POST", body: JSON.stringify({ addSlots: 1 }) }, initData);
      await loadOrder();
      showAlert("Донабор открыт");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!(await showConfirm("Завершить заказ?"))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${id}/complete`, { method: "POST" }, initData);
      await loadOrder();
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const writeToEmployer = () => {
    if (order?.employerUsername && tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/${order.employerUsername}`);
    }
  };

  if (!order) return <div className="container">Загрузка…</div>;

  const isEmployer = me?.role === "employer";
  const isWorker = me?.role === "worker";
  const st = statusLabel[order.status];

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
        <span onClick={() => navigate(-1)} style={{ cursor: "pointer" }}>
          <IconBack />
        </span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>Заказ</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            fontWeight: 600,
            color: st.color,
            background: st.bg,
            padding: "5px 10px",
            borderRadius: 999,
          }}
        >
          {st.text}
        </span>
      </div>

      {order.title && (
        <div style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 12px", lineHeight: 1.3 }}>
          {order.title}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span className="price">{order.basePay.toLocaleString("ru-RU")} ₽</span>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>за смену · от {order.minHours} ч</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Продление {order.overtimeRate} ₽/ч
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="meta">
          <IconClock />
          {order.date}, {order.startTime}
        </div>
        <div className="meta">
          <IconPin />
          {order.address ?? "адрес уточняется"}
        </div>
        <div className="meta">
          <IconUsers />
          Нужно исполнителей: {order.workersNeeded}
        </div>
      </div>

      {order.description && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
            ОПИСАНИЕ
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{order.description}</div>
        </div>
      )}

      {order.employerName && (
        <div
          className="card"
          onClick={() => order.employerId && navigate(`/user/${order.employerId}`)}
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
        >
          <Avatar url={order.employerPhotoUrl} name={order.employerName} />
          <div>
            <div style={{ fontWeight: 600 }}>{order.employerName}</div>
            <span className="rating">
              <IconStar />
              {order.employerRating ? Number(order.employerRating).toFixed(2) : "—"} · профиль и отзывы
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {isWorker && order.status === "open" && !order.myResponse && (
          <button onClick={respond} disabled={busy}>
            Откликнуться
          </button>
        )}

        {isWorker && order.myResponse?.status === "pending" && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "6px 0" }}>
            Отклик отправлен — ждём решения заказчика
          </div>
        )}

        {isWorker &&
          order.myResponse?.status === "accepted" &&
          (order.status === "open" || order.status === "in_progress") &&
          (order.myResponse.confirmedAt ? (
            <div style={{ textAlign: "center", color: "var(--green)", fontWeight: 600, fontSize: 14, padding: "6px 0" }}>
              ✓ Выход на смену подтверждён
            </div>
          ) : (
            <button onClick={confirmShift} disabled={busy}>
              Подтвердить выход на смену
            </button>
          ))}

        {isWorker &&
          order.status === "completed" &&
          order.myResponse?.status === "accepted" &&
          order.employerId &&
          !reviewedIds.includes(order.employerId) && (
            <button onClick={() => setReviewOpen(true)}>Оценить работодателя</button>
          )}

        {order.employerUsername && !isEmployer && (
          <button className="secondary" onClick={writeToEmployer}>
            Написать в Telegram
          </button>
        )}

        {isEmployer && (
          <button onClick={() => navigate(`/order/${id}/responses`)}>Отклики</button>
        )}

        {isEmployer && (order.status === "in_progress" || order.status === "open") && (
          <button className="secondary" onClick={reopen} disabled={busy}>
            Донабор (+1 место)
          </button>
        )}

        {isEmployer && order.status === "in_progress" && (
          <button className="secondary" onClick={complete} disabled={busy}>
            Завершить заказ
          </button>
        )}

        {isEmployer && (order.status === "open" || order.status === "in_progress") && (
          <button className="danger" onClick={cancel} disabled={busy}>
            Отменить заказ
          </button>
        )}
      </div>

      {reviewOpen && (
        <ReviewModal
          title="Оцените работодателя"
          onSubmit={submitEmployerReview}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
