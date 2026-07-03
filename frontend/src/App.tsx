import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { apiFetch } from "./api/client.js";
import { useTelegram } from "./hooks/useTelegram.js";
import { BottomTabBar } from "./components/BottomTabBar.js";
import { RoleSelect } from "./pages/RoleSelect.js";
import { Feed } from "./pages/Feed.js";
import { CreateOrder } from "./pages/CreateOrder.js";
import { OrderDetail } from "./pages/OrderDetail.js";
import { MyOrders } from "./pages/MyOrders.js";
import { OrderResponses } from "./pages/OrderResponses.js";
import { AdminPanel } from "./pages/AdminPanel.js";
import { Settings } from "./pages/Settings.js";
import { UserProfile } from "./pages/UserProfile.js";
import type { Me } from "./types.js";

export default function App() {
  const { initData } = useTelegram();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [outsideTelegram, setOutsideTelegram] = useState(false);

  useEffect(() => {
    if (!initData) {
      // Даём WebApp время инициализироваться; если initData так и не появился —
      // приложение открыто не из Telegram, показываем понятное сообщение
      // вместо вечной «Загрузки…».
      const timer = setTimeout(() => setOutsideTelegram(true), 1500);
      return () => clearTimeout(timer);
    }
    setOutsideTelegram(false);
    apiFetch<Me>("/api/me", {}, initData)
      .then(setMe)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initData]);

  if (outsideTelegram && !initData) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: "center" }}>
        <h2 style={{ fontSize: 20 }}>Откройте через Telegram</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
          WorkerHub — мини-приложение Telegram. Найдите бота и нажмите «Открыть WorkerHub».
        </p>
      </div>
    );
  }

  if (loading) return <div className="container">Загрузка…</div>;

  // Пользователь создаётся как worker по умолчанию. На первом входе (нет отметки
  // об онбординге) предлагаем явно выбрать роль. Админ онбординг пропускает.
  const onboarded = typeof localStorage !== "undefined" && localStorage.getItem("wh_onboarded");
  const needsRole = !!me && me.role !== "admin" && !onboarded;

  const home = !me
    ? "/role"
    : needsRole
      ? "/role"
      : me.role === "employer"
        ? "/create"
        : "/feed";

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/role" element={<RoleSelect />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/create" element={<CreateOrder />} />
        <Route path="/order/:id" element={<OrderDetail />} />
        <Route path="/order/:id/responses" element={<OrderResponses />} />
        <Route path="/my" element={<MyOrders />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/user/:id" element={<UserProfile />} />
        <Route path="*" element={<Navigate to={home} />} />
      </Routes>
      {me && <BottomTabBar role={me.role} />}
    </BrowserRouter>
  );
}
