"use client";

const AGENT_ROWS = [30, 74, 118, 162, 206];

const STAGE = { w: 140, h: 64 };
const COLS = { input: 8, classify: 196, assemble: 384, agents: 590, synth: 830, verdict: 1018 };
const AGENT = { w: 170, h: 34 };
const MID = 165;

const AGENT_LABELS = [
  { name: "The Strategist", tone: "var(--patina)" },
  { name: "The Economist", tone: "var(--accent)" },
  { name: "The Engineer", tone: "var(--patina)" },
  { name: "The Regulator", tone: "var(--accent)" },
  { name: "The Critic", tone: "var(--vermilion)" },
];

function Stage({
  x,
  title,
  lines,
  accent,
}: {
  x: number;
  title: string;
  lines: string[];
  accent?: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={MID - STAGE.h / 2}
        width={STAGE.w}
        height={STAGE.h}
        rx={3}
        fill="var(--surface-elevated)"
        stroke={accent ?? "var(--border-subtle)"}
      />
      {accent && (
        <line
          x1={x + 12}
          y1={MID - STAGE.h / 2}
          x2={x + STAGE.w - 12}
          y2={MID - STAGE.h / 2}
          stroke={accent}
          strokeWidth={1.5}
        />
      )}
      <text
        x={x + STAGE.w / 2}
        y={MID - 8}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={13}
        fontWeight={500}
      >
        {title}
      </text>
      {lines.map((line, i) => (
        <text
          key={line}
          x={x + STAGE.w / 2}
          y={MID + 10 + i * 13}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={10.5}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, x2, y1 = MID, y2 = MID }: { x1: number; x2: number; y1?: number; y2?: number }) {
  const d =
    y1 === y2
      ? `M${x1} ${y1} H${x2}`
      : `M${x1} ${y1} C${x1 + (x2 - x1) * 0.55} ${y1}, ${x2 - (x2 - x1) * 0.55} ${y2}, ${x2} ${y2}`;
  return <path d={d} fill="none" stroke="var(--border-strong)" strokeWidth={1} markerEnd="url(#dx-arrow)" />;
}

export function ArchitectureDiagram() {
  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg
          viewBox="0 0 1160 300"
          className="block h-auto w-full min-w-[46rem]"
          role="img"
          aria-labelledby="dx-diagram-title dx-diagram-desc"
        >
          <title id="dx-diagram-title">The DecisionX evaluation pipeline</title>
          <desc id="dx-diagram-desc">
            An idea and its attachments are classified by domain, then a panel is assembled from a
            twelve-expert roster plus any bespoke experts the orchestrator designs for the idea.
            Every expert evaluates the idea concurrently, and a synthesizer merges their verdicts —
            surfacing where they disagree — into a single scored recommendation.
          </desc>

          <defs>
            <marker id="dx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 1.2 6.6 4 0 6.8" fill="none" stroke="var(--border-strong)" strokeWidth={1} />
            </marker>
          </defs>

          <Stage x={COLS.input} title="Idea" lines={["+ attached", "documents"]} />
          <Arrow x1={COLS.input + STAGE.w} x2={COLS.classify - 6} />

          <Stage x={COLS.classify} title="Classify" lines={["domain", "keywords"]} />
          <Arrow x1={COLS.classify + STAGE.w} x2={COLS.assemble - 6} />

          <Stage
            x={COLS.assemble}
            title="Assemble panel"
            lines={["12-expert roster", "+ bespoke experts"]}
            accent="var(--accent-line)"
          />

          {/* Fan-out for concurrent execution */}
          {AGENT_ROWS.map((y) => (
            <Arrow
              key={`in-${y}`}
              x1={COLS.assemble + STAGE.w}
              x2={COLS.agents - 6}
              y2={y + AGENT.h / 2}
            />
          ))}

          {AGENT_ROWS.map((y, i) => (
            <g key={y}>
              <rect
                x={COLS.agents}
                y={y}
                width={AGENT.w}
                height={AGENT.h}
                rx={3}
                fill="var(--surface)"
                stroke="var(--border-subtle)"
              />
              <rect x={COLS.agents} y={y} width={2} height={AGENT.h} fill={AGENT_LABELS[i].tone} />
              <text x={COLS.agents + 14} y={y + 21} fill="var(--text-secondary)" fontSize={11.5}>
                {AGENT_LABELS[i].name}
              </text>
            </g>
          ))}

          <text
            x={COLS.agents + AGENT.w / 2}
            y={262}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={10.5}
          >
            up to 30, all at once
          </text>

          {/* Converge */}
          {AGENT_ROWS.map((y) => (
            <Arrow
              key={`out-${y}`}
              x1={COLS.agents + AGENT.w}
              x2={COLS.synth - 6}
              y1={y + AGENT.h / 2}
            />
          ))}

          <Stage
            x={COLS.synth}
            title="Synthesize"
            lines={["consensus", "and conflict"]}
            accent="var(--patina)"
          />
          <Arrow x1={COLS.synth + STAGE.w} x2={COLS.verdict - 6} />

          <Stage
            x={COLS.verdict}
            title="Verdict"
            lines={["score, SWOT,", "action plan"]}
            accent="var(--accent)"
          />
        </svg>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-[var(--text-muted)] lg:hidden">
        Scroll to follow the pipeline
        <span aria-hidden="true">→</span>
      </p>

      <figcaption className="measure mt-6 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
        Every expert reads the same brief and writes independently — none of them sees another&rsquo;s
        verdict. That independence is what makes the disagreements meaningful, and running them
        concurrently is why a panel of thirty finishes in about the time a panel of five does.
      </figcaption>
    </figure>
  );
}
