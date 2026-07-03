import { useState } from "react";
import { IconStar } from "./Icons.js";
import type { ReviewValues } from "../types.js";

export interface RemovePayload {
  noShow: boolean;
  review?: ReviewValues;
}

interface Props {
  workerName: string;
  onSubmit: (payload: RemovePayload) => Promise<void> | void;
  onClose: () => void;
}

const ASPECTS: Array<{ key: keyof Omit<ReviewValues, "comment">; label: string }> = [
  { key: "punctuality", label: "Пунктуальность" },
  { key: "quality", label: "Качество" },
  { key: "adequacy", label: "Адекватность" },
];

/**
 * Снятие исполнителя с заказа: отметка «не вышел на смену» (счётчик неявок)
 * и опциональный отзыв — на выбор работодателя.
 */
export function RemoveWorkerModal({ workerName, onSubmit, onClose }: Props) {
  const [noShow, setNoShow] = useState(false);
  const [withReview, setWithReview] = useState(false);
  const [values, setValues] = useState<ReviewValues>({
    punctuality: 1,
    quality: 1,
    adequacy: 1,
    comment: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit({ noShow, review: withReview ? values : undefined });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const checkboxRow = (checked: boolean, onToggle: () => void, label: string, hint?: string) => (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          flexShrink: 0,
          border: checked ? "none" : "2px solid var(--border-2)",
          background: checked ? "var(--accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      <span>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
        {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hint}</div>}
      </span>
    </div>
  );

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
        <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>Снять исполнителя</h3>
        <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 14 }}>
          {workerName} будет снят с заказа, место вернётся в ленту.
        </p>

        {checkboxRow(
          noShow,
          () => setNoShow((v) => !v),
          "Не вышел на смену",
          "Отметка попадёт в счётчик неявок в профиле исполнителя"
        )}
        {checkboxRow(withReview, () => setWithReview((v) => !v), "Оставить отзыв")}

        {withReview && (
          <div style={{ marginTop: 6 }}>
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
                <div style={{ display: "flex", gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      onClick={() => setValues((v) => ({ ...v, [a.key]: n }))}
                      style={{
                        cursor: "pointer",
                        opacity: n <= values[a.key] ? 1 : 0.25,
                        transform: "scale(1.35)",
                        padding: "0 2px",
                      }}
                    >
                      <IconStar size={16} />
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <textarea
              placeholder="Комментарий (необязательно)"
              value={values.comment}
              onChange={(e) => setValues((v) => ({ ...v, comment: e.target.value }))}
              rows={2}
              style={{ marginBottom: 4 }}
            />
          </div>
        )}

        <button className="danger" onClick={handleSubmit} disabled={loading} style={{ marginTop: 10 }}>
          {loading ? "Снимаем…" : "Снять с заказа"}
        </button>
      </div>
    </div>
  );
}
