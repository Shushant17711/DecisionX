"use client";

/**
 * The readiness checklist: which sections of the brief are complete before the
 * panel is convened.
 *
 * It never blocks submission — a thin brief is a legitimate choice, and the
 * verdict is honest about what it was given. What it does is make the gap
 * visible, and let a row jump straight to the field it is asking for, so the
 * checklist is a control surface rather than a scold.
 */

import { Icon } from "./Icon";
import type { BriefField, ChecklistSummary } from "@/lib/brief";

export function BriefChecklist({
  summary,
  onFocusField,
}: {
  summary: ChecklistSummary;
  onFocusField: (field: BriefField) => void;
}) {
  const { items, completed, total } = summary;
  const nextOpen = items.find((item) => item.required && !item.complete) ?? items.find((i) => !i.complete);

  return (
    <section aria-label="Brief readiness">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label">Readiness</p>
        <p className="tnum text-[0.75rem] text-[var(--text-secondary)]">
          <span className={completed === total ? "text-[var(--patina)]" : "text-[var(--foreground)]"}>
            {completed}
          </span>
          <span className="text-[var(--text-muted)]"> of {total} sections</span>
        </p>
      </div>

      {/* Scaled rather than resized: transform stays off the layout thread. */}
      <div className="mt-2 h-px w-full overflow-hidden bg-[var(--border-subtle)]">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-label={`${completed} of ${total} brief sections complete`}
          className="h-px w-full origin-left"
          style={{
            transform: `scaleX(${total ? completed / total : 0})`,
            background: completed === total ? "var(--patina)" : "var(--accent)",
            transition: "transform 0.18s var(--ease-out), background-color 0.18s var(--ease-out)",
          }}
        />
      </div>

      <ul className="mt-3 space-y-px">
        {items.map((item) => {
          const isNext = item === nextOpen;
          return (
            <li key={item.field}>
              <button
                type="button"
                onClick={() => onFocusField(item.field)}
                title={item.hint}
                className="group flex w-full items-center gap-2.5 rounded-[2px] py-1 text-left"
              >
                <span
                  aria-hidden="true"
                  className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
                  style={
                    item.complete
                      ? {
                          borderColor: "oklch(70% 0.12 188 / 0.45)",
                          background: "var(--patina-dim)",
                          color: "var(--patina)",
                        }
                      : {
                          borderColor: isNext ? "var(--accent-line)" : "var(--border-subtle)",
                          color: "transparent",
                        }
                  }
                >
                  <Icon name="check" size={10} strokeWidth={2.2} />
                </span>

                <span
                  className="flex-1 truncate text-[0.8125rem] transition-colors duration-150"
                  style={{
                    color: item.complete ? "var(--text-secondary)" : "var(--foreground)",
                  }}
                >
                  {item.label}
                </span>

                {!item.complete && (
                  <span className="shrink-0 text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    {item.required ? "Required" : "Optional"}
                  </span>
                )}
                <span className="sr-only">{item.complete ? "complete" : "not complete"}</span>
              </button>

              {/* One hint at a time — the section the reader should write next. */}
              {isNext && (
                <p className="pb-1 pl-[26px] text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
                  {item.hint}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
