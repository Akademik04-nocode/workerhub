import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram } from "../hooks/useTelegram.js";
import { IconBack, IconStar } from "../components/Icons.js";
import { Avatar } from "../components/Avatar.js";
import type { PublicProfile, UserReview } from "../types.js";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

/** Публичный профиль: рейтинг, счётчик неявок, история отзывов с разбивкой. */
export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { initData } = useTelegram();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initData || !id) return;
    Promise.all([
      apiFetch<PublicProfile>(`/api/users/${id}`, {}, initData),
      apiFetch<UserReview[]>(`/api/users/${id}/reviews`, {}, initData),
    ])
      .then(([p, r]) => {
        setProfile(p);
        setReviews(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initData, id]);

  if (loading) return <div className="container">Загрузка…</div>;
  if (!profile) return <div className="container">Профиль не найден.</div>;

  const name = profile.name ?? "Без имени";

  const aspect = (label: string, value: number | null) =>
    value === null ? null : (
      <span
        key={label}
        style={{
          fontSize: 12,
          color: "var(--chip-fg)",
          background: "var(--chip)",
          padding: "3px 8px",
          borderRadius: 999,
        }}
      >
        {label} {value}
      </span>
    );

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
        <span onClick={() => navigate(-1)} style={{ cursor: "pointer" }}>
          <IconBack />
        </span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>Профиль</span>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar url={profile.photoUrl} name={profile.name} size={54} accent />
        <div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{name}</div>
          <span className="rating">
            <IconStar />
            {Number(profile.rating).toFixed(2)} · {profile.ratingCount}{" "}
            {profile.ratingCount === 1 ? "оценка" : "оценок"}
          </span>
          {profile.noShowCount > 0 && (
            <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 3, fontWeight: 600 }}>
              ⚠ Неявок: {profile.noShowCount}
            </div>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: 16, margin: "18px 0 10px" }}>Отзывы</h3>
      {reviews.length === 0 && <p style={{ color: "var(--muted)" }}>Отзывов пока нет.</p>}

      {reviews.map((r) => (
        <div key={r.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="rating">
              <IconStar />
              {r.rating.toFixed(1)} · {r.reviewerName ?? "Аноним"}
            </span>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>{fmtDate(r.createdAt)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {aspect("Пунктуальность", r.punctuality)}
            {aspect("Качество", r.quality)}
            {aspect("Адекватность", r.adequacy)}
          </div>
          {r.comment && (
            <div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 8 }}>{r.comment}</div>
          )}
        </div>
      ))}
    </div>
  );
}
