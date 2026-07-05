import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram, showAlert, showConfirm } from "../hooks/useTelegram.js";
import { IconBack, IconStar } from "../components/Icons.js";
import { ReviewModal } from "../components/ReviewModal.js";
import { RemoveWorkerModal, type RemovePayload } from "../components/RemoveWorkerModal.js";
import { Avatar } from "../components/Avatar.js";
import type { Order, ReviewValues } from "../types.js";

interface ResponseRow {
  id: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  confirmedAt: string | null;
  worker: {
    id: string;
    name: string | null;
    rating: string;
    ratingCount: number;
    noShowCount: number;
    photoUrl: string | null;
  };
}

type Sort = "first" | "rating";

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

export function OrderResponses() {
  const { id } = useParams<{ id: string }>();
  const { initData } = useTelegram();
  const navigate = useNavigate();
  const [items, setItems] = useState<ResponseRow[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [sort, setSort] = useState<Sort>("first");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ResponseRow | null>(null);
  const [reviewing, setReviewing] = useState<ResponseRow | null>(null);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!initData) return;
    const [resp, ord] = await Promise.all([
      apiFetch<ResponseRow[]>(`/api/orders/${id}/responses?sort=${sort}`, {}, initData),
      apiFetch<Order>(`/api/orders/${id}`, {}, initData),
    ]);
    setItems(resp);
    setOrder(ord);
    if (ord.status === "completed") {
      const mine = await apiFetch<{ targetIds: string[] }>(
        `/api/orders/${id}/reviews/mine`,
        {},
        initData
      ).catch(() => ({ targetIds: [] }));
      setReviewedIds(mine.targetIds);
    }
    setLoading(false);
  }, [id, initData, sort]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const acceptedCount = items.filter((r) => r.status === "accepted").length;
  const need = order?.workersNeeded ?? 1;
  const full = acceptedCount >= need;

  const choose = async (responseId: string) => {
    if (!(await showConfirm("Выбрать этого исполнителя?"))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/responses/${responseId}/accept`, { method: "PATCH" }, initData);
      await load();
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeWorker = async (payload: RemovePayload) => {
    if (!removing) return;
    try {
      await apiFetch(
        `/api/responses/${removing.id}/remove`,
        {
          method: "POST",
          body: JSON.stringify({
            noShow: payload.noShow,
            review: payload.review
              ? { ...payload.review, comment: payload.review.comment || undefined }
              : undefined,
          }),
        },
        initData
      );
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
      return;
    }
    setRemoving(null);
    await load();
  };

  // Отзыв об исполнителе по завершённому заказу.
  const submitWorkerReview = async (values: ReviewValues) => {
    if (!reviewing) return;
    try {
      await apiFetch(
        "/api/reviews",
        {
          method: "POST",
          body: JSON.stringify({
            orderId: id,
            targetId: reviewing.worker.id,
            punctuality: values.punctuality,
            quality: values.quality,
            adequacy: values.adequacy,
            comment: values.comment || undefined,
          }),
        },
        initData
      );
      await load();
      showAlert("Отзыв сохранён");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
      throw e;
    }
  };

  const tab = (key: Sort, label: string) => (
    <span
      onClick={() => setSort(key)}
      style={{
        flex: 1,
        textAlign: "center",
        padding: "9px 0",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: sort === key ? 600 : 500,
        cursor: "pointer",
        background: sort === key ? "var(--accent)" : "var(--surface)",
        color: sort === key ? "#fff" : "var(--fg-2)",
      }}
    >
      {label}
    </span>
  );

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
        <span onClick={() => navigate(-1)} style={{ cursor: "pointer" }}>
          <IconBack />
        </span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>Отклики · {items.length}</span>
      </div>

      <div
        style={{
          fontSize: 14,
          color: full ? "var(--green)" : "var(--fg-2)",
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        Выбрано {acceptedCount} из {need}
        {full && " — мест больше нет"}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {tab("first", "Кто раньше")}
        {tab("rating", "По рейтингу")}
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Загрузка…</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Пока никто не откликнулся.</p>
      )}

      {items.map((r) => {
        const name = r.worker.name ?? "Без имени";
        const completed = order?.status === "completed";
        return (
          <div key={r.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span onClick={() => navigate(`/user/${r.worker.id}`)} style={{ cursor: "pointer" }}>
              <Avatar url={r.worker.photoUrl} name={r.worker.name} />
            </span>
            <div
              style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
              onClick={() => navigate(`/user/${r.worker.id}`)}
            >
              <div style={{ fontWeight: 600 }}>{name}</div>
              <span className="rating">
                <IconStar />
                {Number(r.worker.rating).toFixed(2)} ({r.worker.ratingCount}) · {ago(r.createdAt)}
              </span>
              {r.worker.noShowCount > 0 && (
                <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600, marginTop: 2 }}>
                  ⚠ Неявок: {r.worker.noShowCount}
                </div>
              )}
              {r.status === "accepted" && !completed && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    marginTop: 2,
                    color: r.confirmedAt ? "var(--green)" : "var(--muted)",
                  }}
                >
                  {r.confirmedAt ? "✓ Подтвердил выход" : "Выход не подтверждён"}
                </div>
              )}
            </div>
            {r.status === "accepted" ? (
              completed ? (
                reviewedIds.includes(r.worker.id) ? (
                  <span style={{ color: "var(--green)", fontSize: 14, fontWeight: 600 }}>Оценён</span>
                ) : (
                  <button
                    onClick={() => setReviewing(r)}
                    style={{ width: "auto", padding: "9px 16px" }}
                  >
                    Оценить
                  </button>
                )
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--green)", fontSize: 14, fontWeight: 600 }}>Выбран</span>
                  <button
                    className="danger"
                    onClick={() => setRemoving(r)}
                    style={{ width: "auto", padding: "8px 14px" }}
                  >
                    Снять
                  </button>
                </div>
              )
            ) : r.status === "rejected" ? (
              <span style={{ color: "var(--faint)", fontSize: 14 }}>Отклонён</span>
            ) : (
              <button
                onClick={() => choose(r.id)}
                disabled={full || busy || completed}
                style={{ width: "auto", padding: "9px 16px" }}
              >
                Выбрать
              </button>
            )}
          </div>
        );
      })}

      {removing && (
        <RemoveWorkerModal
          workerName={removing.worker.name ?? "Исполнитель"}
          onSubmit={removeWorker}
          onClose={() => setRemoving(null)}
        />
      )}

      {reviewing && (
        <ReviewModal
          title="Оцените исполнителя"
          subtitle={reviewing.worker.name ?? undefined}
          onSubmit={submitWorkerReview}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
