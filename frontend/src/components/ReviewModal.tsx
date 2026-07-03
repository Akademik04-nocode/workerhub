import { useState } from "react";
import { IconStar } from "./Icons.js";
import type { ReviewValues } from "../types.js";

interface Props {
  title?: string;
  subtitle?: string;
  onSubmit: (values: ReviewValues) => Promise<void> | void;
  onClose: () => void;
}

const ASPECTS: Array<{ key: keyof Omit<ReviewValues, "comment">; label: string }> = [
  { key: "punctuality", label: "Пунктуальность" },
  { key: "quality", label: "Качество" },
  { key: "adequacy", label: "Адекватность" },
];

function StarsRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={() => onChange(n)}
          style={{ cursor: "pointer", opacity: n <= value ? 1 : 0.25, transform: "scale(1.35)", padding: "0 2px" }}
        >
          <IconStar size={16} />
        </span>
      ))}
    </div>
  );
}

/** Отзыв из трёх быстрых оценок: пунктуальность, качество, адекватность. */
export function ReviewModal({ title, subtitle, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<ReviewValues>({
    punctuality: 5,
    quality: 5,
    adequacy: 5,
    comment: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 640,
          background: "var(--surface)",
          borderRadius: "20px 20px 0 0",
          padding: "22px 18px calc(22px + env(safe-area-inset-bottom))",
        }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>{title ?? "Как прошла смена?"}</h3>
        <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 14 }}>
          {subtitle ?? "Оцените по трём критериям"}
        </p>

        {ASPECTS.map((a) => (
          <div
            key={a.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</span>
            <StarsRow
              value={values[a.key]}
              onChange={(n) => setValues((v) => ({ ...v, [a.key]: n }))}
            />
          </div>
        ))}

        <textarea
          placeholder="Комментарий (необязательно)"
          value={values.comment}
          onChange={(e) => setValues((v) => ({ ...v, comment: e.target.value }))}
          rows={3}
          style={{ marginBottom: 12, marginTop: 4 }}
        />
        <button onClick={handleSubmit} disabled={loading}>
          {loading ? "Отправляем…" : "Оставить отзыв"}
        </button>
      </div>
    </div>
  );
}
