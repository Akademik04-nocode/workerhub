import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram, showAlert } from "../hooks/useTelegram.js";

export function CreateOrder() {
  const { initData } = useTelegram();
  const navigate = useNavigate();
  const [favFirst, setFavFirst] = useState(false);
  const [f, setF] = useState({
    title: "",
    base: "",
    overtime: "400",
    hours: "4",
    workers: "1",
    date: "",
    startTime: "",
    address: "",
    description: "",
    minRating: "0",
  });
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    if (f.title.trim().length < 3) {
      showAlert("Укажите название заказа (что нужно сделать)");
      return;
    }
    if (!f.base || !f.date || !f.startTime) {
      showAlert("Заполните оплату, дату и время");
      return;
    }
    setLoading(true);
    try {
      await apiFetch(
        "/api/orders",
        {
          method: "POST",
          body: JSON.stringify({
            title: f.title.trim(),
            notifyFavoritesFirst: favFirst,
            paymentString: `${f.base}/${f.overtime || 0}/${f.hours || 1}`,
            workersNeeded: Number(f.workers) || 1,
            date: f.date,
            startTime: f.startTime,
            address: f.address,
            description: f.description,
            minRating: Number(f.minRating) || 0,
          }),
        },
        initData
      );
      navigate("/my");
    } catch (e) {
      showAlert("Ошибка: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const section = (title: string, children: React.ReactNode) => (
    <div className="card">
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );

  return (
    <div className="container">
      <h2 className="h-title">Новый заказ</h2>

      {section(
        "НАЗВАНИЕ",
        <input
          type="text"
          placeholder="Например: Разгрузка фуры, стройматериалы"
          maxLength={80}
          value={f.title}
          onChange={set("title")}
        />
      )}

      {section(
        "ОПЛАТА",
        <>
          <label>База за смену, ₽</label>
          <input type="number" inputMode="numeric" placeholder="1800" value={f.base} onChange={set("base")} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label>Продление, ₽/ч</label>
              <input type="number" inputMode="numeric" value={f.overtime} onChange={set("overtime")} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Минимум часов</label>
              <input type="number" inputMode="numeric" value={f.hours} onChange={set("hours")} />
            </div>
          </div>
          <label>Сколько человек нужно</label>
          <input type="number" inputMode="numeric" min={1} value={f.workers} onChange={set("workers")} />
        </>
      )}

      {section(
        "КОГДА И ГДЕ",
        <>
          <label>Дата</label>
          <input type="date" value={f.date} onChange={set("date")} />
          <label>Время начала</label>
          <input type="time" value={f.startTime} onChange={set("startTime")} />
          <label>Адрес</label>
          <input placeholder="ул. Ленина, 12" value={f.address} onChange={set("address")} />
        </>
      )}

      {section(
        "ДЕТАЛИ",
        <>
          <label>Описание</label>
          <textarea rows={3} value={f.description} onChange={set("description")} />
          <label>Мин. рейтинг исполнителя</label>
          <input type="number" min={0} max={5} step={0.1} value={f.minRating} onChange={set("minRating")} />
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4 }}>
            Исполнители с рейтингом ниже не увидят заказ.
          </div>
        </>
      )}

      {section(
        "УВЕДОМЛЕНИЯ",
        <div
          onClick={() => setFavFirst((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              flexShrink: 0,
              border: favFirst ? "none" : "2px solid var(--border-2)",
              background: favFirst ? "var(--accent)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {favFirst ? "✓" : ""}
          </span>
          <span>
            <span style={{ fontSize: 15, fontWeight: 500 }}>Сначала предложить избранным</span>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Избранные исполнители получат уведомление сразу, остальные — через 10 минут
            </div>
          </span>
        </div>
      )}

      <button onClick={submit} disabled={loading} style={{ marginTop: 8 }}>
        {loading ? "Публикуем…" : "Опубликовать заказ"}
      </button>
    </div>
  );
}
