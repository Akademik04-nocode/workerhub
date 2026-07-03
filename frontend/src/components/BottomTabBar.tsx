import { NavLink } from "react-router-dom";
import { IconFeed, IconMy, IconUser, IconPlus, IconShield } from "./Icons.js";

const bar: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  display: "flex",
  justifyContent: "space-around",
  padding: "9px 0 calc(9px + env(safe-area-inset-bottom))",
  background: "var(--surface)",
  borderTop: "1px solid var(--border)",
  maxWidth: 640,
  margin: "0 auto",
};

function item(isActive: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    textDecoration: "none",
    color: isActive ? "var(--accent)" : "var(--faint)",
    fontSize: 10,
    fontWeight: isActive ? 600 : 500,
  };
}

export function BottomTabBar({ role }: { role: string }) {
  return (
    <nav style={bar}>
      {role === "employer" ? (
        <NavLink to="/create" style={({ isActive }) => item(isActive)}>
          {({ isActive }: { isActive: boolean }) => (
            <>
              <IconPlus color={isActive ? "var(--accent)" : "var(--faint)"} />
              <span>Создать</span>
            </>
          )}
        </NavLink>
      ) : (
        <NavLink to="/feed" style={({ isActive }) => item(isActive)}>
          {({ isActive }: { isActive: boolean }) => (
            <>
              <IconFeed color={isActive ? "var(--accent)" : "var(--faint)"} />
              <span>Лента</span>
            </>
          )}
        </NavLink>
      )}

      <NavLink to="/my" style={({ isActive }) => item(isActive)}>
        {({ isActive }: { isActive: boolean }) => (
          <>
            <IconMy color={isActive ? "var(--accent)" : "var(--faint)"} />
            <span>Мои</span>
          </>
        )}
      </NavLink>

      {role === "admin" && (
        <NavLink to="/admin" style={({ isActive }) => item(isActive)}>
          {({ isActive }: { isActive: boolean }) => (
            <>
              <IconShield color={isActive ? "var(--accent)" : "var(--faint)"} />
              <span>Админ</span>
            </>
          )}
        </NavLink>
      )}

      <NavLink to="/settings" style={({ isActive }) => item(isActive)}>
        {({ isActive }: { isActive: boolean }) => (
          <>
            <IconUser color={isActive ? "var(--accent)" : "var(--faint)"} />
            <span>Настройки</span>
          </>
        )}
      </NavLink>
    </nav>
  );
}
