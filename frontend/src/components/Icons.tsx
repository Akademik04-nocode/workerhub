interface P {
  size?: number;
  color?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconClock = ({ size = 15, color = "var(--faint)" }: P) => (
  <svg {...base(size)} stroke={color}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconPin = ({ size = 15, color = "var(--faint)" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const IconBag = ({ size = 13, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M3 7h18M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const IconUsers = ({ size = 15, color = "var(--faint)" }: P) => (
  <svg {...base(size)} stroke={color}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 6M17 20a5.5 5.5 0 0 0-3-4.9" />
  </svg>
);

export const IconStar = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--gold)" stroke="none">
    <path d="m12 2 2.9 6 6.6.6-5 4.3 1.5 6.5L12 16.9 5.9 19.4 7.4 12.9l-5-4.3 6.6-.6L12 2Z" />
  </svg>
);

export const IconBack = ({ size = 22, color = "var(--fg)" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const IconFeed = ({ size = 23, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);

export const IconMy = ({ size = 23, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 9h18" />
  </svg>
);

export const IconUser = ({ size = 23, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <circle cx="12" cy="8" r="4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

export const IconPlus = ({ size = 23, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconShield = ({ size = 23, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
    <path d="M9.5 12l1.8 1.8 3.2-3.6" />
  </svg>
);

export const IconTrash = ({ size = 18, color = "currentColor" }: P) => (
  <svg {...base(size)} stroke={color}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
);
