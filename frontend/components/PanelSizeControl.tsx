"use client";

import { Icon } from "./Icon";

export const MAX_PANEL = 30;
/** Size of the built-in roster in backend/agents/personas.py. Past this point
 *  the Panel Architect designs experts specifically for the idea. */
export const BUILTIN_ROSTER = 12;

const PRESETS = [3, 5, 8, 12, 20, 30];

export function PanelSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const bespoke = Math.max(0, value - BUILTIN_ROSTER);
  const rosterRatio = ((BUILTIN_ROSTER - 1) / (MAX_PANEL - 1)) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="panel-size" className="label">
          Panel size
        </label>
        <p className="tnum text-[0.8125rem] text-[var(--text-secondary)]">
          <span className="text-[1.375rem] font-light text-[var(--foreground)]">{value}</span>
          <span className="ml-1.5">expert{value === 1 ? "" : "s"}</span>
        </p>
      </div>

      <div className="relative mt-3">
        <input
          id="panel-size"
          type="range"
          min={1}
          max={MAX_PANEL}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${value} experts${bespoke ? `, ${bespoke} designed for this idea` : ""}`}
          className="panel-range"
          style={{ "--fill": `${((value - 1) / (MAX_PANEL - 1)) * 100}%` } as React.CSSProperties}
        />
        {/* Where the built-in roster runs out and bespoke experts begin. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--border-strong)]"
          style={{ left: `calc(${rosterRatio}% + ${8 - rosterRatio * 0.16}px)` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className="tnum rounded-[2px] border px-2 py-0.5 text-[0.75rem] transition-colors duration-150"
            style={
              value === n
                ? { borderColor: "var(--accent-line)", background: "var(--accent-dim)", color: "var(--accent)" }
                : { borderColor: "var(--border-subtle)", color: "var(--text-muted)" }
            }
          >
            {n}
          </button>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-2 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
        <Icon
          name={bespoke ? "spark" : "check"}
          size={13}
          className="mt-0.5 shrink-0"
          style={bespoke ? { color: "var(--accent)" } : undefined}
        />
        <span>
          {bespoke > 0 ? (
            <>
              The roster covers {BUILTIN_ROSTER}. The orchestrator will design{" "}
              <span className="tnum text-[var(--accent)]">{bespoke}</span> more expert
              {bespoke === 1 ? "" : "s"} built for this specific idea.
            </>
          ) : (
            <>
              Drawn from the {BUILTIN_ROSTER}-expert roster, matched to the idea&rsquo;s domain. Past{" "}
              {BUILTIN_ROSTER}, the orchestrator designs bespoke experts.
            </>
          )}
        </span>
      </p>
    </div>
  );
}
