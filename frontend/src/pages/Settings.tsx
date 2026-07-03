import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useTelegram } from "../hooks/useTelegram.js";
import { CATEGORY_LABELS, type OrderCategory } from "../types.js";
import { IconStar } from "../components/Icons.js";
import type { Me } from "../types.js";

export function Settings() {
  const { initData, tg } = useTelegram();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!initData) return;
    apiFetch<Me>("/api/me", {}, initData)
      .then((u) => {
        setMe(u);
        setName(u.name ?? "");
        setPhone(u.phone ?? "");
      })
      .catch(() => {});
  }, [initData]);

  const patch = async (body: object) => {
    const updated = await apiFetch<Me>(
      "/api/me",
      { method: "PATCH", body: JSON.stringify(body) },
      initData
    );
    setMe(updated);
    return updated;
  };

  const save = async () => {
    await patch({ name, phone });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as OrderCategory[];

  const toggleCategory = async (c: OrderCategory) => {
    if (!me) return;
    const current = me.notifyCategories === null ? ALL_CATEGORIES : me.notifyCategories;
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    // Все категории выбраны => храним null («все», включая будущие).
    await patch({ notifyCategories: next.length === ALL_CATEGORIES.length ? null : next });
  };

  const openSupport = () => {
    const url = "https://t.me/akademik_04";
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  };

  const switchRole = async () => {
    if (!me) return;
    const role = me.role === "employer" ? "worker" : "employer";
    const updated = await apiFetch<Me>(
      "/api/me/role",
      { method: "PATCH", body: JSON.stringify({ role }) },
      initData
    );
    setMe(updated);
  };

  if (!me) return <div className="container">Загрузка…</div>;

  const initials = (me.name ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="container">
      <h2 className="h-title">Настройки</h2>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 999,
            background: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 18,
            color: "#fff",
          }}
        >
          {initials}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{me.name ?? "Без имени"}</div>
          <span className="rating">
            <IconStar />
            {Number(me.rating).toFixed(2)} · {me.ratingCount} оценок
          </span>
          {me.noShowCount > 0 && (
            <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 3, fontWeight: 600 }}>
              ⚠ Неявок: {me.noShowCount}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <label style={{ marginTop: 0 }}>Имя</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label>Телефон</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7…" />
        <button onClick={save} style={{ marginTop: 12 }}>
          {saved ? "Сохранено ✓" : "Сохранить"}
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Уведомления</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Новые заказы и отклики</div>
          </div>
          <Toggle
            on={me.notifyEnabled}
            onChange={() => patch({ notifyEnabled: !me.notifyEnabled })}
          />
        </div>
      </div>

      {me.role !== "employer" && (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Категории уведомлений</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            Получать уведомления только о выбранных видах работ
          </div>
          {(Object.keys(CATEGORY_LABELS) as OrderCategory[]).map((c) => {
            const selected = me.notifyCategories === null || me.notifyCategories.includes(c);
            return (
              <div
                key={c}
                onClick={() => toggleCategory(c)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 0",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 15 }}>{CATEGORY_LABELS[c]}</span>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    border: selected ? "none" : "2px solid var(--border-2)",
                    background: selected ? "var(--green)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {selected ? "✓" : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Поддержка</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Вопросы, споры и жалобы — напишите нам
            </div>
          </div>
          <button className="ghost" onClick={openSupport}>
            Написать
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Роль</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {me.role === "admin"
                ? "Администратор"
                : me.role === "employer"
                  ? "Работодатель"
                  : "Исполнитель"}
            </div>
          </div>
          {me.role !== "admin" && (
            <button className="ghost" onClick={switchRole}>
              Сменить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <span
      onClick={onChange}
      style={{
        width: 46,
        height: 28,
        borderRadius: 999,
        background: on ? "var(--green)" : "var(--border-2)",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "#fff",
          transition: "left 0.15s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </span>
  );
}
