/**
 * Аватар пользователя: фото из Telegram, если есть, иначе кружок с инициалами.
 */
export function Avatar({
  url,
  name,
  size = 42,
  accent = false,
}: {
  url?: string | null;
  name: string | null | undefined;
  size?: number;
  accent?: boolean;
}) {
  const initials = (name ?? "?").slice(0, 2).toUpperCase();
  const base = {
    width: size,
    height: size,
    borderRadius: 999,
    flexShrink: 0 as const,
  };
  if (url) {
    return (
      <img
        src={url}
        alt={initials}
        style={{ ...base, objectFit: "cover" as const, display: "block" }}
      />
    );
  }
  return (
    <div
      style={{
        ...base,
        background: accent ? "var(--accent)" : "var(--chip)",
        color: accent ? "#fff" : "var(--chip-fg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: Math.round(size / 2.8),
      }}
    >
      {initials}
    </div>
  );
}
