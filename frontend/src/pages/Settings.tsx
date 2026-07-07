import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useNavigate } from "react-router-dom";
import { useTelegram } from "../hooks/useTelegram.js";
import { Avatar } from "../components/Avatar.js";
import { IconStar } from "../components/Icons.js";
import type { Me } from "../types.js";

// Карта для добровольной поддержки автора.
const DONATION_CARD = "2200701324389292";
const DONATION_CARD_PRETTY = "2200 7013 2438 9292";

export function Settings() {
  const navigate = useNavigate();
  const { initData, tg } = useTelegram();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const openSupport = () => {
    const url = "https://t.me/akademik_04";
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  };

  // Копирование номера карты для доната. navigator.clipboard работает в большинстве
  // webview Telegram; на всякий случай — фолбэк через временный textarea.
  const copyCard = async () => {
    try {
      await navigator.clipboard.writeText(DONATION_CARD);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = DONATION_CARD;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* совсем старый клиент — оставим как есть */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!me) return <div className="container">Загрузка…</div>;

  return (
    <div className="container">
      <h2 className="h-title">Настройки</h2>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar url={me.photoUrl} name={me.name} size={54} accent />
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

      <div className="card">
        <div style={{ fontWeight: 600 }}>Поддержка автора</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>
          Если приложение оказалось полезным — можно поддержать разработку. Спасибо! 🙏
        </div>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "var(--surface-2, rgba(128,128,128,0.10))",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <span style={{ fontSize: 16, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>
            {DONATION_CARD_PRETTY}
          </span>
          <button className="ghost" onClick={copyCard} style={{ flexShrink: 0 }}>
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
        </div>
      </div>

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
        <div
          onClick={() => navigate("/privacy")}
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border, rgba(128,128,128,0.15))",
            fontSize: 13,
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          Политика конфиденциальности →
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
