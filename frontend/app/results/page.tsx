"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";

import { HistorySidebar, HistoryToggle } from "@/components/HistorySidebar";
import { ChartTile } from "@/components/ChartTile";
import { DownloadMenu } from "@/components/DownloadMenu";
import { Icon, personaIcon } from "@/components/Icon";
import { RoleTabs, StatusChips } from "@/components/RoleFilter";
import { ScoreMark } from "@/components/ScoreMark";
import {
  getServerSnapshot,
  getSnapshot,
  loadFromHistory,
  resetEvaluation,
  subscribe,
} from "@/lib/evaluation";
import { getEntry } from "@/lib/history";
import { getNote } from "@/lib/notes";
import { personaRole, personaStatus, roleLens, tallyRoles, type RoleId, type StatusId } from "@/lib/roles";
import type { Chart, Disagreement, Expert, PersonaResult, Synthesis } from "@/lib/types";

/* ─── Verdict vocabulary ─── */

function verdictTone(verdict: string): { className: string; color: string } {
  const v = verdict?.toLowerCase();
  if (v === "go" || v === "bullish") return { className: "verdict-go", color: "var(--patina)" };
  if (v === "no-go" || v === "bearish")
    return { className: "verdict-nogo", color: "oklch(72% 0.15 27)" };
  return { className: "verdict-caution", color: "var(--accent)" };
}

/* ─── Sections ─── */

function SectionHeading({ children, count }: { children: React.ReactNode; count?: string }) {
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-[var(--border-subtle)] pb-3">
      <h2 className="text-[1.25rem]">{children}</h2>
      {count && <span className="tnum shrink-0 text-[0.75rem] text-[var(--text-muted)]">{count}</span>}
    </div>
  );
}

function ExpertCard({ persona }: { persona: PersonaResult }) {
  const { analysis } = persona;
  const tone = verdictTone(analysis.verdict);
  const failed = analysis._failed;

  return (
    <article
      className="panel seam settle flex h-full min-w-0 flex-col p-5"
      style={{ "--seam-color": `${persona.color}` } as React.CSSProperties}
    >
      <header className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[3px]"
          style={{ background: `color-mix(in oklab, ${persona.color} 14%, transparent)`, color: persona.color }}
        >
          <Icon name={personaIcon(persona.icon)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.9375rem] font-medium leading-tight">{persona.name}</h3>
          <p className="mt-0.5 truncate text-[0.75rem] text-[var(--text-muted)]">{persona.role}</p>
        </div>
        {persona.custom && (
          <span
            className="shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-[0.1em]"
            style={{ borderColor: "var(--accent-line)", color: "var(--accent)" }}
            title="Designed by the orchestrator for this specific idea"
          >
            Bespoke
          </span>
        )}
      </header>

      {failed ? (
        <p className="mt-5 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-[oklch(72%_0.15_27)]" />
          This expert could not be reached. {analysis.headline}
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className={`verdict ${tone.className}`}>{analysis.verdict}</span>
            <ScoreMark score={analysis.score} color={persona.color} />
          </div>

          <p className="mt-4 text-[0.875rem] leading-relaxed text-[var(--foreground)]">
            {analysis.headline}
          </p>

          {analysis.strengths?.length > 0 && (
            <div className="mt-5">
              <p className="label">In favour</p>
              <ul className="mt-2 space-y-1.5">
                {analysis.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]"
                  >
                    <Icon name="check" size={13} className="mt-1 shrink-0 text-[var(--patina)]" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.concerns?.length > 0 && (
            <div className="mt-4">
              <p className="label">Against</p>
              <ul className="mt-2 space-y-1.5">
                {analysis.concerns.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]"
                  >
                    <Icon name="cross" size={13} className="mt-1 shrink-0 text-[oklch(72%_0.15_27)]" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Appears only when this expert attached one */}
          {analysis.chart && (
            <div className="mt-5">
              <ChartTile chart={analysis.chart} compact />
            </div>
          )}

          {analysis.recommendation && (
            <p className="mt-auto border-t border-[var(--border-subtle)] pt-3.5 text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]">
              <span className="text-[var(--accent)]">Do this — </span>
              {analysis.recommendation}
            </p>
          )}
        </>
      )}
    </article>
  );
}

function AwaitingCard({ expert }: { expert: Expert }) {
  return (
    <article className="panel awaiting relative flex h-full flex-col p-5" aria-busy="true">
      <header className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[3px]"
          style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}
        >
          <Icon name={personaIcon(expert.icon)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.9375rem] font-medium leading-tight text-[var(--text-secondary)]">
            {expert.name}
          </h3>
          <p className="mt-0.5 truncate text-[0.75rem] text-[var(--text-muted)]">{expert.role}</p>
        </div>
      </header>
      <p className="mt-6 text-[0.8125rem] text-[var(--text-muted)]">Reading the brief…</p>
      <div className="mt-4 space-y-2" aria-hidden="true">
        {[100, 82, 64].map((w) => (
          <div key={w} className="h-2 rounded-[1px] bg-[var(--surface-elevated)]" style={{ width: `${w}%` }} />
        ))}
      </div>
    </article>
  );
}

function DisagreementSides({ sides }: { sides: Disagreement["sides"] }) {
  if (typeof sides === "string") {
    return <p className="text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">{sides}</p>;
  }
  return (
    <dl className="space-y-2">
      {Object.entries(sides ?? {}).map(([expert, view]) => (
        <div key={expert} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-[0.8125rem] font-medium text-[var(--foreground)] sm:w-40">
            {expert}
          </dt>
          <dd className="text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
            {String(view)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SwotQuadrant({
  title,
  items,
  color,
}: {
  title: string;
  items: string[] | undefined;
  color: string;
}) {
  return (
    <div className="panel seam p-5" style={{ "--seam-color": color } as React.CSSProperties}>
      <h3 className="text-[0.875rem] font-medium" style={{ color }}>
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items?.length ? (
          items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]"
            >
              <span className="mt-[0.55em] h-px w-2.5 shrink-0" style={{ background: color }} />
              <span>{item}</span>
            </li>
          ))
        ) : (
          <li className="text-[0.875rem] text-[var(--text-muted)]">Nothing identified.</li>
        )}
      </ul>
    </div>
  );
}

function ActionPlan({ title, horizon, steps }: { title: string; horizon: string; steps: string[] }) {
  return (
    <div className="panel p-5">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[0.875rem] font-medium">{title}</h3>
        <span className="tnum text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {horizon}
        </span>
      </div>
      <ol className="mt-4 space-y-3">
        {steps?.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="tnum mt-[0.15em] shrink-0 text-[0.75rem] text-[var(--accent)]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─── Page ─── */

function ResultsView() {
  const router = useRouter();
  const params = useSearchParams();
  const historyId = params.get("id");
  const [historyOpen, setHistoryOpen] = useState(false);

  const [role, setRole] = useState<RoleId | "all">("all");
  const [status, setStatus] = useState<StatusId | "all">("all");

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const notFound = state.status === "missing";

  useEffect(() => {
    if (historyId) loadFromHistory(historyId);
  }, [historyId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHistoryOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const done = state.personas.length;
  const total = state.experts.length || state.panelSize;
  const answered = useMemo(() => new Set(state.personas.map((p) => p.key)), [state.personas]);
  const pending = state.experts.filter((e) => !answered.has(e.key));
  const synthesis: Synthesis | undefined = state.result?.synthesis;

  /* ── Role and status lenses over the panel ──
     Counts come from every seat on the panel, answered or not, so a tab never
     appears and then vanishes as verdicts arrive. */
  const roleCounts = useMemo(
    () => tallyRoles(state.experts.length ? state.experts : state.personas),
    [state.experts, state.personas],
  );
  const statusCounts = useMemo(() => {
    const counts = new Map<StatusId, number>();
    for (const persona of state.personas) {
      const id = personaStatus(persona);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [state.personas]);

  const matchesRole = useCallback(
    (expert: { key: string; role: string; name: string }) =>
      role === "all" || personaRole(expert) === role,
    [role],
  );

  const shownPersonas = useMemo(
    () =>
      state.personas.filter(
        (p) => matchesRole(p) && (status === "all" || personaStatus(p) === status),
      ),
    [state.personas, matchesRole, status],
  );
  const shownPending = useMemo(
    () => (status === "all" ? pending.filter(matchesRole) : []),
    [pending, matchesRole, status],
  );

  const filtered = role !== "all" || status !== "all";
  const shownCount = shownPersonas.length + shownPending.length;

  const entry = state.historyId ? getEntry(state.historyId) : undefined;

  const boardCharts = useMemo(
    () => [synthesis?.score_chart, ...(synthesis?.charts ?? [])].filter(Boolean) as Chart[],
    [synthesis],
  );

  const startNew = () => {
    resetEvaluation();
    router.push("/");
  };

  /* Nothing to show — direct navigation to /results with no run and no id. */
  if (state.status === "idle" && !historyId) {
    return (
      <Shell onOpenHistory={() => setHistoryOpen(true)} historyOpen={historyOpen} onCloseHistory={() => setHistoryOpen(false)}>
        <div className="py-28 text-center">
          <h2 className="text-[1.25rem]">No evaluation loaded</h2>
          <p className="mx-auto mt-3 max-w-[42ch] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            Start one from the home page, or open a past evaluation from your history.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button onClick={startNew} className="btn-primary px-5 py-2.5 text-[0.875rem]">
              Evaluate an idea
            </button>
            <button
              onClick={() => setHistoryOpen(true)}
              className="btn-quiet px-5 py-2.5 text-[0.875rem]"
            >
              Open history
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell onOpenHistory={() => setHistoryOpen(true)} historyOpen={historyOpen} onCloseHistory={() => setHistoryOpen(false)}>
        <div className="py-28 text-center">
          <h2 className="text-[1.25rem]">That evaluation is not on this device</h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            History is stored in this browser only, so a link to an evaluation will not open
            anywhere else — and clearing site data removes it.
          </p>
          <button onClick={startNew} className="btn-primary mt-7 px-5 py-2.5 text-[0.875rem]">
            Evaluate an idea
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      onOpenHistory={() => setHistoryOpen(true)}
      historyOpen={historyOpen}
      onCloseHistory={() => setHistoryOpen(false)}
      activeId={state.historyId}
      onNew={startNew}
      actions={
        entry && (
          <>
            <Link
              href={`/report?id=${entry.id}`}
              className="btn-quiet flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] no-underline"
            >
              <Icon name="file" size={15} />
              <span className="hidden sm:inline">Report</span>
            </Link>
            <DownloadMenu
              entry={entry}
              note={getNote(entry.id)}
              onPdf={() => router.push(`/report?id=${entry.id}&print=1`)}
            />
          </>
        )
      }
    >
      {/* ── The brief ── */}
      <section className="pt-10">
        <div 
          className="panel seam p-6 md:p-8"
          style={{ "--seam-color": "var(--vermilion)" } as React.CSSProperties}
        >
          <div className="w-full max-h-[30vh] overflow-y-auto pr-4 scrollbar-thin
                         text-[1rem] leading-relaxed text-[var(--text-secondary)]
                         [&>p]:mb-4 [&>p:last-child]:mb-0
                         [&>h1]:text-[1.5rem] [&>h1]:font-medium [&>h1]:text-[var(--foreground)] [&>h1]:mb-3 [&>h1]:mt-6 [&>h1:first-child]:mt-0
                         [&>h2]:text-[1.25rem] [&>h2]:font-medium [&>h2]:text-[var(--foreground)] [&>h2]:mb-3 [&>h2]:mt-6 [&>h2:first-child]:mt-0
                         [&>h3]:text-[1.125rem] [&>h3]:font-medium [&>h3]:text-[var(--foreground)] [&>h3]:mb-2 [&>h3]:mt-5 [&>h3:first-child]:mt-0
                         [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-4 [&>ul:last-child]:mb-0 [&>ul>li]:mb-1.5 [&>ul>li::marker]:text-[var(--accent-line)]
                         [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:mb-4 [&>ol:last-child]:mb-0 [&>ol>li]:mb-1.5 [&>ol>li::marker]:text-[var(--accent-line)]
                         [&>strong]:text-[var(--foreground)] [&>strong]:font-medium
                         [&>em]:italic">
            <ReactMarkdown>
              {state.idea}
            </ReactMarkdown>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-4 text-[0.75rem] text-[var(--text-muted)]">
            {state.domains.map((d) => (
              <span key={d} className="uppercase tracking-[0.12em]">
                {d}
              </span>
            ))}
            {state.attachments.filter((a) => a.included).length > 0 && (
              <span className="flex items-center gap-1.5">
                <Icon name="file" size={12} />
                {state.attachments.filter((a) => a.included).length} document
                {state.attachments.filter((a) => a.included).length === 1 ? "" : "s"} read
              </span>
            )}
            {state.result?.elapsed_seconds != null && (
              <span className="tnum flex items-center gap-1.5">
                <Icon name="clock" size={12} />
                {state.result.elapsed_seconds}s
              </span>
            )}
          </div>

          {state.attachments.some((a) => a.error) && (
            <ul className="mt-3 space-y-1">
              {state.attachments
                .filter((a) => a.error)
                .map((a) => (
                  <li
                    key={a.name}
                    className="flex items-start gap-2 text-[0.75rem] text-[var(--text-muted)]"
                  >
                    <Icon name="alert" size={12} className="mt-0.5 shrink-0 text-[oklch(72%_0.15_27)]" />
                    {a.name}: {a.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Error ── */}
      {state.status === "error" && (
        <section className="mt-8">
          <div
            className="panel p-6"
            style={{ borderColor: "oklch(62% 0.17 27 / 0.4)", background: "var(--vermilion-dim)" }}
          >
            <h2 className="flex items-center gap-2 text-[1rem]">
              <Icon name="alert" size={18} className="text-[oklch(72%_0.15_27)]" />
              The evaluation stopped
            </h2>
            <p className="measure mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
              {state.error}
            </p>
            <button onClick={startNew} className="btn-quiet mt-5 flex items-center gap-2 px-4 py-2 text-[0.875rem]">
              <Icon name="refresh" size={15} />
              Start over
            </button>
          </div>
        </section>
      )}

      {/* ── Verdict ── */}
      {/* Do not show fallback score as a real verdict if all experts failed. */}
      {synthesis?.panel_unreachable ? (
        <section className="mt-10">
          <div
            className="panel p-6 md:p-8"
            style={{ borderColor: "oklch(62% 0.17 27 / 0.4)", background: "var(--vermilion-dim)" }}
          >
            <h2 className="flex items-center gap-2.5 text-[1.125rem]">
              <Icon name="alert" size={19} className="shrink-0 text-[oklch(72%_0.15_27)]" />
              No expert could be reached
            </h2>
            <p className="measure mt-3 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
              The panel was assembled but every provider call failed, so there is no verdict to
              report. Each card below carries the exact error. The usual cause is a missing or
              expired API key on the backend.
            </p>
            <button onClick={startNew} className="btn-quiet mt-5 flex items-center gap-2 px-4 py-2 text-[0.875rem]">
              <Icon name="refresh" size={15} />
              Try again
            </button>
          </div>
        </section>
      ) : synthesis ? (
        <section className="mt-10">
          <div
            className="panel-raised seam settle p-6 md:p-8"
            style={{ "--seam-color": verdictTone(synthesis.verdict).color } as React.CSSProperties}
          >
            <div className="flex flex-col gap-7 md:flex-row md:items-start md:gap-10">
              <div className="shrink-0">
                <ScoreMark
                  score={synthesis.overall_score}
                  color={verdictTone(synthesis.verdict).color}
                  size="lg"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`verdict ${verdictTone(synthesis.verdict).className}`}>
                    {synthesis.verdict}
                  </span>
                  <span className="tnum text-[0.8125rem] text-[var(--text-muted)]">
                    {synthesis.consensus_percentage}% agreement across {state.personas.length} experts
                  </span>
                </div>
                <p className="measure mt-4 text-[1.0625rem] leading-relaxed text-[var(--foreground)]">
                  {synthesis.executive_summary}
                </p>
              </div>
            </div>

            {(synthesis.failed_agents?.length ?? 0) > 0 && (
              <p className="mt-6 flex items-start gap-2 border-t border-[var(--border-subtle)] pt-4 text-[0.8125rem] text-[var(--text-muted)]">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-[oklch(72%_0.15_27)]" />
                {synthesis.failed_agents!.join(", ")} could not be reached and{" "}
                {synthesis.failed_agents!.length === 1 ? "was" : "were"} left out of the score.
              </p>
            )}
          </div>
        </section>
      ) : state.status === "running" ? (
        <section className="mt-10">
          <div className="panel awaiting relative p-6 md:p-8">
            <p className="text-[0.9375rem] text-[var(--text-secondary)]">
              {state.stage === "assembling"
                ? "Assembling the panel around this idea…"
                : state.stage === "synthesizing"
                  ? "All verdicts in. Reconciling where the experts disagree…"
                  : `Hearing the panel — ${done} of ${total} ${done === 1 ? "verdict" : "verdicts"} in.`}
            </p>
            <div
              className="mt-4 h-px w-full bg-[var(--border-subtle)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={done}
            >
              <div
                className="h-px bg-[var(--accent)] transition-[width] duration-500 ease-out"
                style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* ── The panel ── */}
      {(state.personas.length > 0 || pending.length > 0) && (
        <section className="mt-14">
          <SectionHeading
            count={
              filtered
                ? `Showing ${shownCount} of ${done + pending.length}`
                : total
                  ? `${done} of ${total}`
                  : undefined
            }
          >
            The panel
          </SectionHeading>

          {/* Whose seat you are reading from. Counts sit on the controls so the
              shape of the panel is legible before anything is clicked. */}
          <div className="mb-6">
            <RoleTabs counts={roleCounts} total={done + pending.length} value={role} onChange={setRole} />
            {(statusCounts.size > 1 || filtered) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusChips counts={statusCounts} value={status} onChange={setStatus} />
                {filtered && (
                  <button
                    type="button"
                    onClick={() => {
                      setRole("all");
                      setStatus("all");
                    }}
                    className="flex items-center gap-1.5 text-[0.75rem] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
                  >
                    <Icon name="close" size={12} />
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          {shownCount === 0 ? (
            <p className="panel px-5 py-8 text-center text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
              No expert on this panel matches{" "}
              {role !== "all" && <span className="text-[var(--text-secondary)]">{roleLens(role).label}</span>}
              {role !== "all" && status !== "all" && " with this verdict"}
              {role === "all" && "this verdict"}.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shownPersonas.map((p) => (
                <ExpertCard key={p.key} persona={p} />
              ))}
              {shownPending.map((e) => (
                <AwaitingCard key={e.key} expert={e} />
              ))}
            </div>
          )}
        </section>
      )}

      {synthesis && !synthesis.panel_unreachable && (
        <>
          {synthesis.disagreements?.length > 0 && (
            <section className="mt-16">
              <SectionHeading count={`${synthesis.disagreements.length}`}>
                Where they split
              </SectionHeading>
              <div className="space-y-4">
                {synthesis.disagreements.map((d, i) => (
                  <article key={i} className="panel p-5 md:p-6">
                    <h3 className="flex items-start gap-2.5 text-[0.9375rem] font-medium">
                      <Icon name="split" size={17} className="mt-0.5 shrink-0 text-[var(--patina)]" />
                      {d.topic}
                    </h3>
                    <div className="mt-3.5 pl-[27px]">
                      <DisagreementSides sides={d.sides} />
                      {d.resolution && (
                        <p className="mt-4 border-t border-[var(--border-subtle)] pt-3.5 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                          <span className="text-[var(--accent)]">Reconciled — </span>
                          {d.resolution}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Board charts appear only if panel produced quantitative data. */}
          {boardCharts.length > 0 && (
            <section className="mt-16">
              <SectionHeading count={`${boardCharts.length}`}>By the numbers</SectionHeading>
              <div
                className={`grid gap-4 ${boardCharts.length > 1 ? "md:grid-cols-2" : "max-w-2xl"}`}
              >
                {boardCharts.map((chart, i) => (
                  <div key={`${chart.title}-${i}`} className="min-w-0">
                    <ChartTile chart={chart} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {synthesis.consensus_points?.length > 0 && (
            <section className="mt-16">
              <SectionHeading>What they all agree on</SectionHeading>
              <ul className="grid gap-3 md:grid-cols-2">
                {synthesis.consensus_points.map((point, i) => (
                  <li
                    key={i}
                    className="panel flex items-start gap-3 p-4 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]"
                  >
                    <Icon name="check" size={15} className="mt-0.5 shrink-0 text-[var(--patina)]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-16">
            <SectionHeading>Standing and exposure</SectionHeading>
            <div className="grid gap-4 md:grid-cols-2">
              <SwotQuadrant title="Strengths" items={synthesis.strengths} color="var(--patina)" />
              <SwotQuadrant title="Weaknesses" items={synthesis.weaknesses} color="oklch(72% 0.15 27)" />
              <SwotQuadrant title="Opportunities" items={synthesis.opportunities} color="var(--accent)" />
              {/* Use bronze to ensure quadrant doesn't look unfinished. */}
              <SwotQuadrant title="Threats" items={synthesis.threats} color="oklch(66% 0.1 52)" />
            </div>
          </section>

          <section className="mt-16">
            <SectionHeading>What to do next</SectionHeading>
            <div className="grid gap-4 md:grid-cols-2">
              <ActionPlan
                title="Immediate"
                horizon="7 days"
                steps={synthesis.action_plan_7_days ?? []}
              />
              <ActionPlan
                title="Follow-through"
                horizon="30 days"
                steps={synthesis.action_plan_30_days ?? []}
              />
            </div>
          </section>

          <section className="mt-16">
            <div
              className="panel-raised seam p-6 md:p-8"
              style={{ "--seam-color": "var(--accent)" } as React.CSSProperties}
            >
              <h2 className="text-[1.125rem]">The chair&rsquo;s recommendation</h2>
              <p className="measure mt-4 text-[1rem] leading-relaxed text-[var(--text-secondary)]">
                {synthesis.final_recommendation}
              </p>
            </div>
          </section>
        </>
      )}

      {/* ── Take it with you ── */}
      {entry && (
        <section className="mt-16">
          <div
            className="panel seam flex flex-col gap-5 p-6 md:flex-row md:items-center md:gap-8 md:p-7"
            style={{ "--seam-color": "var(--patina)" } as React.CSSProperties}
          >
            <div className="min-w-0 flex-1">
              <h2 className="text-[1.0625rem]">Take the verdict with you</h2>
              <p className="measure mt-2 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                The full report lays out the brief, every expert grouped by the role they answer to,
                the splits and the action plan as one document — ready to print or hand over.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Link
                href={`/report?id=${entry.id}`}
                className="btn-primary flex items-center gap-2 px-4 py-2.5 text-[0.875rem] no-underline"
              >
                <Icon name="file" size={16} />
                Report
              </Link>
              <DownloadMenu
                entry={entry}
                note={getNote(entry.id)}
                align="left"
                onPdf={() => router.push(`/report?id=${entry.id}&print=1`)}
              />
            </div>
          </div>
        </section>
      )}

      <footer className="mt-16 border-t border-[var(--border-subtle)] py-8">
        <p className="measure text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
          AI-generated analysis for thinking through an idea. Not financial, legal, medical, or
          professional advice. This evaluation is saved in this browser only.
        </p>
      </footer>
    </Shell>
  );
}

function Shell({
  children,
  onOpenHistory,
  historyOpen,
  onCloseHistory,
  activeId,
  onNew,
  actions,
}: {
  children: React.ReactNode;
  onOpenHistory: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
  activeId?: string | null;
  onNew?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="relative z-[1] min-h-dvh">
      <HistorySidebar open={historyOpen} onClose={onCloseHistory} activeId={activeId} />
      <nav className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[oklch(7%_0.006_95/0.97)] backdrop-blur-lg">
        <div className="mx-auto flex max-w-[76rem] items-center gap-3 px-6 py-4 md:px-10">
          <Link href="/" className="wordmark mr-auto no-underline">
            DecisionX
          </Link>
          {actions}
          <HistoryToggle onClick={onOpenHistory} />
          {onNew && (
            <button onClick={onNew} className="btn-quiet flex items-center gap-2 px-3 py-1.5 text-[0.8125rem]">
              <Icon name="plus" size={15} />
              <span className="hidden sm:inline">New</span>
            </button>
          )}
        </div>
      </nav>
      <main className="mx-auto max-w-[76rem] px-6 pb-4 md:px-10">{children}</main>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <p className="text-[0.875rem] text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <ResultsView />
    </Suspense>
  );
}
