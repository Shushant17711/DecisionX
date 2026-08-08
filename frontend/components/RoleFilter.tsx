"use client";

/**
 * Role and status filters, shared by the panel on the results page and the
 * record list in the history sidebar.
 *
 * Both are plain toggle groups rather than ARIA tabs: nothing is being swapped
 * for a different view, a single list is being narrowed, and the count on each
 * control is part of the information — a reader should see that the authority
 * seat exists and holds two experts before deciding to click it.
 */

import { ROLE_LENSES, STATUS_FILTERS, type RoleId, type StatusId } from "@/lib/roles";

const STATUS_TONE: Record<StatusId, { color: string; border: string; background: string }> = {
  favour: { color: "var(--patina)", border: "oklch(70% 0.12 188 / 0.35)", background: "var(--patina-dim)" },
  mixed: { color: "var(--accent)", border: "var(--accent-line)", background: "var(--accent-dim)" },
  against: { color: "oklch(72% 0.15 27)", border: "oklch(62% 0.17 27 / 0.38)", background: "var(--vermilion-dim)" },
  unreachable: { color: "var(--text-secondary)", border: "var(--border-strong)", background: "var(--surface-hover)" },
};

export function RoleTabs({
  counts,
  total,
  value,
  onChange,
  everyoneLabel = "Everyone",
}: {
  counts: Map<RoleId, number>;
  total: number;
  value: RoleId | "all";
  onChange: (next: RoleId | "all") => void;
  everyoneLabel?: string;
}) {
  const present = ROLE_LENSES.filter((lens) => (counts.get(lens.id) ?? 0) > 0);

  return (
    <div
      role="group"
      aria-label="Filter by role"
      className="scroll-x -mb-px flex items-stretch gap-1 border-b border-[var(--border-subtle)]"
    >
      <FilterTab
        label={everyoneLabel}
        count={total}
        active={value === "all"}
        onClick={() => onChange("all")}
      />
      {present.map((lens) => (
        <FilterTab
          key={lens.id}
          label={lens.label}
          title={lens.blurb}
          count={counts.get(lens.id) ?? 0}
          active={value === lens.id}
          onClick={() => onChange(lens.id)}
        />
      ))}
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="relative shrink-0 whitespace-nowrap px-3 py-2 text-[0.8125rem] transition-colors duration-150"
      style={{ color: active ? "var(--foreground)" : "var(--text-muted)" }}
    >
      {label}
      <span className="tnum ml-1.5 text-[0.6875rem] text-[var(--text-muted)]">{count}</span>
      {/* The rule sits on the container's own border line. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-1.5 bottom-0 h-px"
        style={{ background: active ? "var(--accent)" : "transparent" }}
      />
    </button>
  );
}

export function StatusChips({
  counts,
  value,
  onChange,
}: {
  counts: Map<StatusId, number>;
  value: StatusId | "all";
  onChange: (next: StatusId | "all") => void;
}) {
  const present = STATUS_FILTERS.filter((status) => (counts.get(status.id) ?? 0) > 0);
  if (present.length < 2) return null;

  return (
    <div role="group" aria-label="Filter by verdict" className="flex flex-wrap items-center gap-1.5">
      {present.map((status) => {
        const active = value === status.id;
        const tone = STATUS_TONE[status.id];
        return (
          <button
            key={status.id}
            type="button"
            onClick={() => onChange(active ? "all" : status.id)}
            aria-pressed={active}
            className="tnum rounded-[2px] border px-2 py-0.5 text-[0.75rem] transition-colors duration-150"
            style={
              active
                ? { borderColor: tone.border, background: tone.background, color: tone.color }
                : { borderColor: "var(--border-subtle)", color: "var(--text-muted)" }
            }
          >
            {status.label}
            <span className="ml-1.5 text-[0.6875rem] text-[var(--text-muted)]">
              {counts.get(status.id) ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
