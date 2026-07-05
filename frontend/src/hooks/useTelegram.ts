import { useEffect, useState } from "react";

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
  colorScheme?: "light" | "dark";
  openTelegramLink?: (url: string) => void;
  showAlert?: (message: string, callback?: () => void) => void;
  showConfirm?: (message: string, callback: (ok: boolean) => void) => void;
}

function getWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
    ?.WebApp;
}

/**
 * Уведомление пользователю: нативный попап Telegram, если доступен,
 * иначе браузерный alert (обычный window.alert внутри WebView Telegram
 * на части платформ не показывается).
 */
export function showAlert(message: string) {
  const tg = getWebApp();
  if (tg?.showAlert) {
    try {
      tg.showAlert(message);
      return;
    } catch {
      /* старый клиент без поддержки — фолбэк ниже */
    }
  }
  alert(message);
}

/**
 * Открыть ссылку Telegram (профиль @username или t.me/…) правильным способом:
 * внутри мини-приложения обычный <a> может не сработать, нужен вызов SDK.
 * Принимает и «username», и «@username», и готовый URL.
 */
export function openTelegramLink(usernameOrUrl: string) {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://t.me/${usernameOrUrl.replace(/^@/, "")}`;
  const tg = getWebApp();
  if (tg?.openTelegramLink) {
    try {
      tg.openTelegramLink(url);
      return;
    } catch {
      /* старый клиент — фолбэк ниже */
    }
  }
  window.open(url, "_blank");
}

/** Подтверждение: нативный confirm Telegram с фолбэком на window.confirm. */
export function showConfirm(message: string): Promise<boolean> {
  const tg = getWebApp();
  if (tg?.showConfirm) {
    try {
      return new Promise((resolve) => tg.showConfirm!(message, resolve));
    } catch {
      /* фолбэк ниже */
    }
  }
  return Promise.resolve(confirm(message));
}

export function useTelegram() {
  const tg = getWebApp();
  const [initData, setInitData] = useState("");

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand();
    setInitData(tg.initData);

    // Тёмная тема по colorScheme Telegram.
    if (tg.colorScheme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [tg]);

  // isTelegram: окружение Telegram определяется наличием WebApp с initData.
  return { tg, initData, user: tg?.initDataUnsafe?.user, isTelegram: !!tg?.initData };
}
