"use client";

/**
 * A score, rendered as a measurement mark rather than a progress ring.
 *
 * Ten ticks, filled to the score. It reads as an instrument reading — which is
 * what a panel score is — and stays legible at 16px where a donut turns to mush.
 */
export function ScoreMark({
  score,
  color,
  size = "sm",
}: {
  /** Null, undefined or NaN render as "not scored" rather than as a zero. */
  score: number | null | undefined;
  color: string;
  size?: "sm" | "lg";
}) {
  const value = typeof score === "number" && Number.isFinite(score) ? score : null;
  const scored = value !== null;
  const clamped = value !== null ? Math.max(0, Math.min(10, Math.round(value * 10) / 10)) : 0;
  const filled = scored ? Math.round(clamped) : 0;
  const large = size === "lg";

  return (
    <div className="flex items-end gap-2.5">
      <span
        className="tnum font-light leading-[0.85]"
        style={{ color: scored ? color : "var(--text-muted)", fontSize: large ? "3.5rem" : "1.5rem" }}
      >
        {!scored ? "—" : Number.isInteger(clamped) ? clamped : clamped.toFixed(1)}
      </span>
      <div className={large ? "pb-2" : "pb-1"}>
        <div className="flex items-end gap-[2px]" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              style={{
                width: large ? 4 : 2,
                height: large ? (i % 5 === 0 ? 20 : 13) : i % 5 === 0 ? 11 : 7,
                background: i < filled ? color : "var(--border-subtle)",
              }}
            />
          ))}
        </div>
        {/* The caption earns its space once, on the headline score. Repeating
            it on every one of thirty expert cards is noise, not information. */}
        {large && (
          <span className="mt-1.5 block text-[0.6875rem] text-[var(--text-muted)]">out of 10</span>
        )}
      </div>
      <span className="sr-only">{scored ? "out of 10" : "not scored"}</span>
    </div>
  );
}
