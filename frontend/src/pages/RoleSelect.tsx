import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { useTelegram, showAlert } from "../hooks/useTelegram.js";
import { IconBag, IconUser } from "../components/Icons.js";

export function RoleSelect() {
  const { initData } = useTelegram();
  const navigate = useNavigate();

  const choose = async (role: "employer" | "worker") => {
    try {
      await apiFetch("/api/me/role", { method: "PATCH", body: JSON.stringify({ role }) }, initData);
    } catch (e) {
      showAlert("Не удалось сохранить роль: " + (e as Error).message);
      return;
    }
    try {
      localStorage.setItem("wh_onboarded", "1");
    } catch {
      /* webview без localStorage — не критично */
    }
    navigate(role === "employer" ? "/create" : "/feed");
  };

  const roleCard = (
    role: "employer" | "worker",
    title: string,
    subtitle: string,
    icon: React.ReactNode
  ) => (
    <div
      className="card"
      onClick={() => choose(role)}
      style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: "var(--chip)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent)",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: "var(--accent)",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconBag size={30} color="#fff" />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Добро пожаловать</h1>
        <p style={{ color: "var(--muted)", marginTop: 6 }}>Подработка за пару минут</p>
      </div>

      {roleCard("employer", "Работодатель", "Создавайте заказы и выбирайте людей", <IconBag size={22} color="var(--accent)" />)}
      {roleCard("worker", "Исполнитель", "Находите смены рядом и откликайтесь", <IconUser size={22} color="var(--accent)" />)}

      <p style={{ textAlign: "center", color: "var(--faint)", fontSize: 12, marginTop: 20 }}>
        Продолжая, вы принимаете условия сервиса
      </p>
    </div>
  );
}
