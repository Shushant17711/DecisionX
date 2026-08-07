// Consistent 24x24 icon set using currentColor. Prevents OS emoji inconsistency.

export type IconName =
  // Persona vocabulary — mirrors ICON_NAMES in backend/agents/personas.py
  | "target" | "wrench" | "user" | "wallet" | "compass" | "scales" | "palette"
  | "beaker" | "globe" | "megaphone" | "layers" | "flame" | "shield" | "pulse"
  | "network" | "seedling" | "terminal" | "gauge" | "route" | "spark"
  // Interface vocabulary
  | "panel" | "close" | "plus" | "search" | "trash" | "upload" | "file"
  | "arrowRight" | "arrowLeft" | "check" | "cross" | "chevronDown" | "clock"
  | "copy" | "alert" | "split" | "grid" | "list" | "refresh" | "download";

const PATHS: Record<IconName, React.ReactNode> = {
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  wrench: (
    <>
      <path d="M15.4 3.6a5 5 0 0 0-6.2 6.4l-5.7 5.7a1.8 1.8 0 0 0 0 2.5l2.3 2.3a1.8 1.8 0 0 0 2.5 0l5.7-5.7a5 5 0 0 0 6.4-6.2l-3 3-2.9-.7-.7-2.9Z" />
      <path d="M7.2 16.8 8.6 18.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.8 20.2a7.4 7.4 0 0 1 14.4 0" />
    </>
  ),
  wallet: (
    <>
      <path d="M3.5 7.6A2.1 2.1 0 0 1 5.6 5.5h10.2a2.1 2.1 0 0 1 2.1 2.1v1.1" />
      <rect x="3.5" y="7.6" width="17" height="11.4" rx="2.1" />
      <path d="M20.5 12.4h-3.6a1.7 1.7 0 0 0 0 3.4h3.6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.2 8.8-1.7 4.7-4.7 1.7 1.7-4.7 4.7-1.7Z" />
    </>
  ),
  scales: (
    <>
      <path d="M12 4.2v15.6M7 6.4h10M5.5 20h13" />
      <path d="M7 6.4 4 13.2h6L7 6.4ZM17 6.4l-3 6.8h6l-3-6.8Z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 2-.8 2-1.8 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1 .8-1.8 1.8-1.8h1.7a4.2 4.2 0 0 0 4.2-4.2c0-3.6-3.8-6.4-8.5-6.4Z" />
      <circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  beaker: (
    <>
      <path d="M9.4 3.5v6.1L4.8 17.6a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3l-4.6-8V3.5" />
      <path d="M8.2 3.5h7.6M7 14.4h10" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17Z" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10.2v3.6a1.8 1.8 0 0 0 1.8 1.8h2L14 19.4V4.6L7.8 8.4h-2A1.8 1.8 0 0 0 4 10.2Z" />
      <path d="M17.4 9.2a4 4 0 0 1 0 5.6M7.8 15.6v3.8h2.6v-2.3" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.4L12 12.3 3.5 7.9 12 3.5Z" />
      <path d="m3.5 12.4 8.5 4.4 8.5-4.4M3.5 16.6l8.5 4.4 8.5-4.4" />
    </>
  ),
  flame: (
    <>
      <path d="M12 3.2c.5 3 2.2 4 3.7 5.6a6.6 6.6 0 0 1 2 4.7 5.7 5.7 0 0 1-11.4 0c0-1.9 1-3.4 2-4.3.2 1 .8 1.8 1.6 2 .3-3.4 1-6 2.1-8Z" />
      <path d="M12 20.2a2.7 2.7 0 0 1-2.7-2.7c0-1.5 1.3-2.3 2.7-4.3 1.4 2 2.7 2.8 2.7 4.3a2.7 2.7 0 0 1-2.7 2.7Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.4 4.8 6.2v5.4c0 4.2 3 7.5 7.2 9 4.2-1.5 7.2-4.8 7.2-9V6.2L12 3.4Z" />
      <path d="m9.2 12 2 2 3.6-3.9" />
    </>
  ),
  pulse: (
    <>
      <path d="M3 12h3.6l2-5.4 3.2 11 2.4-7 1.6 3.2H21" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18.4" r="2.2" />
      <circle cx="19" cy="18.4" r="2.2" />
      <path d="M10.6 6.9 6.2 16.4M13.4 6.9l4.4 9.5M7.2 18.4h9.6" />
    </>
  ),
  seedling: (
    <>
      <path d="M12 20.4v-6.6" />
      <path d="M12 13.8c0-3.2 2.4-5.6 5.6-5.6 0 3.2-2.4 5.6-5.6 5.6ZM12 13.8c0-2.7-2-4.7-4.7-4.7 0 2.7 2 4.7 4.7 4.7Z" />
      <path d="M8 20.4h8" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.6" width="18" height="14.8" rx="2.2" />
      <path d="m7.4 10 2.6 2.4-2.6 2.4M12.8 15h4" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17.4a9 9 0 1 1 16 0" />
      <path d="m12 12.6 3.6-3.4" />
      <circle cx="12" cy="13.6" r="1.3" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.4 6h4.4a3.2 3.2 0 0 1 0 6.4h-1.6a3.2 3.2 0 0 0 0 6.4h4.4" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6l-1.9-5.8-5.8-1.9L10.1 9 12 3.2Z" />
      <path d="M18.6 3.4v3M17.1 4.9h3" />
    </>
  ),

  panel: (
    <>
      <rect x="3" y="4.6" width="18" height="14.8" rx="2.2" />
      <path d="M9.6 4.6v14.8M6.2 9.4h1M6.2 12.4h1" />
    </>
  ),
  close: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />,
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.2 4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 6.9h14.4M9.4 6.9V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.7" />
      <path d="M6.6 6.9 7.5 19a1.6 1.6 0 0 0 1.6 1.4h5.8a1.6 1.6 0 0 0 1.6-1.4l.9-12.1" />
      <path d="M10.4 10.6v6M13.6 10.6v6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.6V4.4M8.2 8.2 12 4.4l3.8 3.8" />
      <path d="M4.4 15.2v3a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-3" />
    </>
  ),
  file: (
    <>
      <path d="M13.6 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6l-5-5Z" />
      <path d="M13.4 3.8v4.6h4.8" />
    </>
  ),
  arrowRight: <path d="M4.6 12h14.8M13.6 6.2 19.4 12l-5.8 5.8" />,
  arrowLeft: <path d="M19.4 12H4.6M10.4 6.2 4.6 12l5.8 5.8" />,
  check: <path d="m5 12.6 4.6 4.6L19 7.4" />,
  cross: <path d="m7 7 10 10M17 7 7 17" />,
  chevronDown: <path d="m6.6 9.4 5.4 5.4 5.4-5.4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2" />
      <path d="M15.4 5.6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.4a2 2 0 0 0 2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2 2.8 20h18.4L12 4.2Z" />
      <path d="M12 10.2v4.2" />
      <circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  split: (
    <>
      <path d="M12 3.6v16.8" strokeDasharray="2.5 3" />
      <path d="M8.2 8.4 4.6 12l3.6 3.6M15.8 8.4 19.4 12l-3.6 3.6" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.4" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" />
    </>
  ),
  list: <path d="M8.4 6.4h11.2M8.4 12h11.2M8.4 17.6h11.2M4.6 6.4h.01M4.6 12h.01M4.6 17.6h.01" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.2 4.4v4.4h-4.4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.4v11.2M8.2 11.8 12 15.6l3.8-3.8" />
      <path d="M4.4 15.2v3a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-3" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
  style,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.spark}
    </svg>
  );
}

/** Backend persona icon name → drawn icon, with a safe default. */
export function personaIcon(name: string | undefined): IconName {
  return name && name in PATHS ? (name as IconName) : "spark";
}
