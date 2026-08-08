"use client";

import { useId, useState } from "react";

import { Icon } from "./Icon";
import type { Chart, ChartPoint } from "@/lib/types";

const SPLIT_COLORS = ["#bf8600", "#00a299", "#d04f47", "#7973ca", "#b3622a"];

const SERIES = "var(--accent)";
const GRID = "var(--border-subtle)";
const AXIS_TEXT = "var(--text-muted)";

function formatValue(value: number, unit: string): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000) text = `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) text = `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  else text = Number.isInteger(value) ? String(value) : value.toFixed(abs < 10 ? 1 : 0);

  if (!unit) return text;
  if (unit === "%" || unit.startsWith("/")) return `${text}${unit}`;
  return `${text} ${unit}`;
}

function BarChart({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0) || 1;
  const rowH = 30;

  return (
    <div className="mt-4">
      {data.map((d, i) => {
        const pct = (Math.abs(d.value) / max) * 100;
        const active = hover === i;
        return (
          <div
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="grid items-center gap-3"
            style={{ gridTemplateColumns: "minmax(4.5rem, 8rem) 1fr auto", height: rowH }}
          >
            <span className="truncate text-[0.75rem] text-[var(--text-secondary)]" title={d.label}>
              {d.label}
            </span>
            <div className="relative h-2.5">
              <div className="absolute inset-0 rounded-[1px]" style={{ background: GRID, opacity: 0.5 }} />
              <div
                className="absolute inset-y-0 left-0 rounded-r-[3px] transition-[filter] duration-150"
                style={{
                  width: `${Math.max(pct, 1.5)}%`,
                  background: SERIES,
                  filter: active ? "brightness(1.15)" : undefined,
                }}
              />
            </div>
            <span
              className="tnum w-[4.5rem] text-right text-[0.75rem] tabular-nums"
              style={{ color: active ? "var(--foreground)" : "var(--text-secondary)" }}
            >
              {formatValue(d.value, unit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const W = 520;
  const H = 170;
  const PAD = { top: 14, right: 12, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = data.map((d) => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = rawMin >= 0 && rawMin <= rawMax * 0.4 ? 0 : rawMin;
  const max = rawMax;
  const span = max - min || 1;

  const x = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;

  const linePath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;
  const crossesZero = min < 0 && max > 0;
  const ticks = crossesZero ? [min, 0, max] : [min, min + span / 2, max];

  return (
    <div className="scroll-x mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full min-w-[17rem]"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={data.map((d) => `${d.label}: ${formatValue(d.value, unit)}`).join(", ")}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              y1={y(t)}
              x2={W - PAD.right}
              y2={y(t)}
              stroke={t === 0 && crossesZero ? "var(--border-strong)" : GRID}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fill={AXIS_TEXT} fontSize={10}>
              {formatValue(t, "")}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={d.label}>
            {/* Hit target far larger than the mark */}
            <rect
              x={x(i) - plotW / (data.length * 2) - 2}
              y={PAD.top}
              width={plotW / data.length + 4}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <circle
              cx={x(i)}
              cy={y(d.value)}
              r={hover === i ? 5 : 3.5}
              fill={SERIES}
              stroke="var(--surface)"
              strokeWidth={2}
            />
            {(i === 0 || i === data.length - 1 || hover === i) && (
              <text
                x={x(i)}
                y={PAD.top + plotH + 17}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                fill={hover === i ? "var(--foreground)" : AXIS_TEXT}
                fontSize={10}
              >
                {d.label}
              </text>
            )}
          </g>
        ))}

        {hover !== null && (
          <text
            x={x(hover)}
            y={Math.max(y(data[hover].value) - 12, 12)}
            textAnchor={hover === 0 ? "start" : hover === data.length - 1 ? "end" : "middle"}
            fill="var(--foreground)"
            fontSize={11}
            fontWeight={500}
          >
            {formatValue(data[hover].value, unit)}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ── Split: part-to-whole ── */

function SplitChart({ data, unit, compact }: { data: ChartPoint[]; unit: string; compact: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <div className="mt-4">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden">
        {data.map((d, i) => (
          <div
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="h-full rounded-[1px] transition-[filter] duration-150"
            style={{
              width: `${(d.value / total) * 100}%`,
              background: SPLIT_COLORS[i % SPLIT_COLORS.length],
              filter: hover === i ? "brightness(1.2)" : hover === null ? undefined : "saturate(0.5)",
            }}
          />
        ))}
      </div>

      {/* Direct-label every segment for accessibility. */}
      <ul className={`mt-4 grid gap-x-6 gap-y-2 ${compact ? "" : "sm:grid-cols-2"}`}>
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-2.5 text-[0.75rem]"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[1px]"
              style={{ background: SPLIT_COLORS[i % SPLIT_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={d.label}>
              {d.label}
            </span>
            <span className="tnum shrink-0 text-[var(--foreground)]">
              {Math.round((d.value / total) * 100)}%
            </span>
            <span className="tnum shrink-0 text-right text-[var(--text-muted)]">
              {formatValue(d.value, unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Tile ── */

export function ChartTile({ chart, compact = false }: { chart: Chart; compact?: boolean }) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <figure
      className={`panel m-0 min-w-0 ${compact ? "p-4" : "p-5"}`}
      style={{ background: "var(--lacquer-deep)" }}
    >
      <figcaption className="flex items-start justify-between gap-3">
        <h4 className="text-[0.8125rem] font-medium leading-snug">{chart.title}</h4>
        <span
          className="shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-[0.08em]"
          style={
            chart.measured
              ? { borderColor: "oklch(70% 0.12 188 / 0.35)", color: "var(--patina)" }
              : { borderColor: "var(--border-subtle)", color: "var(--text-muted)" }
          }
          title={
            chart.measured
              ? "Built from the panel's actual scores"
              : "The expert's own estimate, not a measurement"
          }
        >
          {chart.measured ? "Measured" : "Estimate"}
        </span>
      </figcaption>

      {chart.type === "bar" && <BarChart data={chart.data} unit={chart.unit} />}
      {chart.type === "line" && <LineChart data={chart.data} unit={chart.unit} />}
      {chart.type === "split" && <SplitChart data={chart.data} unit={chart.unit} compact={compact} />}

      {chart.note && (
        <p className="mt-4 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">{chart.note}</p>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        aria-controls={tableId}
        className="mt-3 flex items-center gap-1.5 text-[0.6875rem] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <Icon
          name="chevronDown"
          size={12}
          style={{
            transform: showTable ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.16s var(--ease-out)",
          }}
        />
        {showTable ? "Hide values" : "View as table"}
      </button>

      {showTable && (
        <table id={tableId} className="mt-2 w-full text-[0.75rem]">
          <tbody>
            {chart.data.map((d) => (
              <tr key={d.label} className="border-t border-[var(--border-subtle)]">
                <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{d.label}</td>
                <td className="tnum py-1.5 text-right text-[var(--foreground)]">
                  {formatValue(d.value, chart.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
