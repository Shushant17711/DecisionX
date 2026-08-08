"use client";

/**
 * The report — one evaluation, laid out as a document rather than as an interface.
 *
 * It is drawn on paper, not lacquer: a report is read end to end, printed, and
 * handed to someone who was not in the room, and the dark product chrome would
 * fight all three. The same content backs the HTML and CSV exports, and this page
 * is what the PDF option prints.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { DownloadMenu } from "@/components/DownloadMenu";
import { Icon, personaIcon } from "@/components/Icon";
import { getHistory, getHistoryServerSnapshot, subscribeHistory } from "@/lib/history";
import { getNote, setNote } from "@/lib/notes";
import { formatDate, statusLabel } from "@/lib/report";
import {
  personaRole,
  personaStatus,
  ROLE_LENSES,
  synthesisStatus,
  verdictStatus,
  type RoleId,
  type StatusId,
} from "@/lib/roles";
import { FEATURED_SAMPLE_ID, seedSamples } from "@/lib/samples";
import type { Disagreement, PersonaResult } from "@/lib/types";

const STATUS_INK: Record<StatusId, string> = {
  favour: "var(--doc-go)",
  mixed: "var(--doc-caution)",
  against: "var(--doc-no)",
  unreachable: "var(--doc-muted)",
};

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-11 border-b border-[var(--doc-rule)] pb-2 text-[0.8125rem] font-medium uppercase tracking-[0.14em]">
      {children}
    </h2>
  );
}

function Bullets({ items, marker }: { items: string[] | undefined; marker?: string }) {
  if (!items?.length) {
    return <p className="text-[0.875rem] italic text-[var(--doc-muted)]">Nothing identified.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[0.875rem] leading-relaxed">
          <span
            aria-hidden="true"
            className="mt-[0.6em] h-px w-2.5 shrink-0"
            style={{ background: marker ?? "var(--doc-rule)" }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function sidesLines(sides: Disagreement["sides"]): string[] {
  if (!sides) return [];
  if (typeof sides === "string") return [sides];
  return Object.entries(sides).map(([expert, view]) => `${expert} — ${String(view)}`);
}

function ExpertEntry({ persona }: { persona: PersonaResult }) {
  const analysis = persona.analysis;
  const status = personaStatus(persona);
  const ink = STATUS_INK[status];

  return (
    <article className="doc-card break-inside-avoid p-5">
      <header className="flex items-baseline gap-2.5">
        <Icon
          name={personaIcon(persona.icon)}
          size={16}
          className="mt-0.5 shrink-0"
          style={{ color: "var(--doc-muted)" }}
        />
        <h3 className="text-[0.9375rem] font-medium">{persona.name}</h3>
        {persona.custom && (
          <span className="doc-tag" title="Designed by the orchestrator for this idea">
            Bespoke
          </span>
        )}
        <span className="tnum ml-auto shrink-0 text-[1.25rem] font-light" style={{ color: ink }}>
          {analysis?._failed ? "—" : analysis?.score}
          {!analysis?._failed && <span className="text-[0.75rem] text-[var(--doc-muted)]">/10</span>}
        </span>
      </header>

      <p className="mt-1 text-[0.8125rem] text-[var(--doc-muted)]">
        {persona.role} · <span style={{ color: ink }}>{statusLabel(status)}</span>
      </p>

      <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--doc-ink)]">{analysis?.headline}</p>

      {!analysis?._failed && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="doc-label">In favour</p>
              <div className="mt-1.5">
                <Bullets items={analysis?.strengths} marker="var(--doc-go)" />
              </div>
            </div>
            <div>
              <p className="doc-label">Against</p>
              <div className="mt-1.5">
                <Bullets items={analysis?.concerns} marker="var(--doc-no)" />
              </div>
            </div>
          </div>

          {analysis?.recommendation && (
            <p className="mt-4 border-t border-[var(--doc-rule)] pt-3 text-[0.875rem] leading-relaxed">
              <span style={{ color: "var(--doc-accent)" }}>Do this — </span>
              {analysis.recommendation}
            </p>
          )}
        </>
      )}
    </article>
  );
}

function ReportView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const wantsPrint = params.get("print") === "1";

  const entries = useSyncExternalStore(subscribeHistory, getHistory, getHistoryServerSnapshot);
  const entry = useMemo(() => entries.find((e) => e.id === id), [entries, id]);

  const [note, setNoteText] = useState("");
  const [seeding, setSeeding] = useState(false);
  const noteLoadedFor = useRef<string | null>(null);
  const printed = useRef(false);

  // Notes live in localStorage, so they can only be read after hydration.
  useEffect(() => {
    if (!id || noteLoadedFor.current === id) return;
    noteLoadedFor.current = id;
    setNoteText(getNote(id));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const handle = window.setTimeout(() => setNote(id, note), 400);
    return () => window.clearTimeout(handle);
  }, [id, note]);

  // Arriving with ?print=1 means the reader chose PDF elsewhere: print once the
  // document has actually rendered, never twice.
  useEffect(() => {
    if (!wantsPrint || !entry || printed.current) return;
    printed.current = true;
    const handle = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(handle);
  }, [wantsPrint, entry]);

  const loadSamples = async () => {
    setSeeding(true);
    const outcome = await seedSamples();
    setSeeding(false);
    if (outcome.ok) router.replace(`/report?id=${FEATURED_SAMPLE_ID}`);
  };

  if (!entry) {
    return (
      <DocShell>
        <div className="py-24 text-center">
          <h1 className="text-[1.375rem] font-medium">No report to show</h1>
          <p className="mx-auto mt-3 max-w-[44ch] text-[0.9375rem] leading-relaxed">
            A report is generated from an evaluation stored in this browser. Open one from your
            history, or load the worked sample records to see a finished report.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button onClick={loadSamples} disabled={seeding} className="doc-btn-primary px-4 py-2 text-[0.875rem]">
              {seeding ? "Loading…" : "Load sample records"}
            </button>
            <Link href="/" className="doc-btn px-4 py-2 text-[0.875rem] no-underline">
              Evaluate an idea
            </Link>
          </div>
          <p className="mt-6 text-[0.8125rem] text-[var(--doc-muted)]">
            Or read a pre-generated export:{" "}
            <a href="/sample-report.html" className="underline" style={{ color: "var(--doc-accent)" }}>
              HTML
            </a>{" "}
            ·{" "}
            <a href="/sample-report.csv" className="underline" style={{ color: "var(--doc-accent)" }}>
              CSV
            </a>
          </p>
        </div>
      </DocShell>
    );
  }

  const result = entry.result;
  const synthesis = result.synthesis;
  const brief = entry.brief;
  const personas = result.personas ?? [];
  const status = synthesis ? synthesisStatus(synthesis) : verdictStatus(entry.verdict);
  const ink = STATUS_INK[status];
  const included = (result.attachments ?? []).filter((a) => a.included);

  // The panel is presented by role, which is how the report is read: a reviewer
  // looks for their own seat before reading anyone else's.
  const byRole = new Map<RoleId, PersonaResult[]>();
  for (const persona of personas) {
    const role = personaRole(persona);
    const bucket = byRole.get(role);
    if (bucket) bucket.push(persona);
    else byRole.set(role, [persona]);
  }
  const orderedRoles = ROLE_LENSES.filter((lens) => byRole.has(lens.id));

  return (
    <DocShell
      toolbar={
        <>
          <Link
            href={`/results?id=${entry.id}`}
            className="doc-btn flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] no-underline"
          >
            <Icon name="arrowLeft" size={15} />
            <span className="hidden sm:inline">Back to results</span>
          </Link>
          <DownloadMenu entry={entry} note={note} onPdf={() => window.print()} />
        </>
      }
    >
      <header>
        <p className="doc-label">DecisionX — panel report</p>
        <h1 className="mt-2.5 text-[clamp(1.5rem,3vw,2.125rem)] font-normal leading-[1.15] tracking-[-0.02em] text-[var(--doc-ink)]">
          {entry.idea}
        </h1>
        <p className="tnum mt-3 text-[0.8125rem] text-[var(--doc-muted)]">
          {formatDate(entry.createdAt)} · {entry.panelSize} experts ·{" "}
          {entry.domains.length ? entry.domains.join(" · ") : "no domain matched"}
          {result.elapsed_seconds != null ? ` · ${result.elapsed_seconds}s` : ""}
        </p>

        <div className="mt-7 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="tnum text-[3rem] font-light leading-none" style={{ color: ink }}>
            {entry.score}
          </span>
          <span
            className="rounded-[2px] border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em]"
            style={{ color: ink, borderColor: "currentColor" }}
          >
            {entry.verdict}
          </span>
          <span className="tnum text-[0.8125rem] text-[var(--doc-muted)]">
            {synthesis?.consensus_percentage != null
              ? `${synthesis.consensus_percentage}% agreement across ${personas.length} experts`
              : `${personas.length} experts`}
          </span>
        </div>

        {synthesis?.executive_summary && (
          <p className="mt-6 max-w-[62ch] text-[1.0625rem] leading-relaxed text-[var(--doc-ink)]">
            {synthesis.executive_summary}
          </p>
        )}
      </header>

      <DocHeading>The brief</DocHeading>
      <div className="doc-card break-inside-avoid p-5">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[10rem_1fr]">
          <dt className="doc-label pt-0.5">Readiness</dt>
          <dd className="text-[0.9375rem]">
            {brief ? (
              <>
                <span className="tnum text-[var(--doc-ink)]">
                  {brief.completed} of {brief.total} sections
                </span>
                <span className="text-[var(--doc-muted)]">
                  {brief.requiredMet
                    ? " — every required section was complete before the panel convened."
                    : " — required sections were left open, so the panel worked from a partial brief."}
                </span>
              </>
            ) : (
              <span className="text-[var(--doc-muted)]">
                Recorded before the readiness checklist existed.
              </span>
            )}
          </dd>

          {brief?.context && (
            <>
              <dt className="doc-label pt-0.5">Decision context</dt>
              <dd className="text-[0.9375rem] leading-relaxed">{brief.context}</dd>
            </>
          )}
          {brief?.criteria && (
            <>
              <dt className="doc-label pt-0.5">Success criteria</dt>
              <dd className="text-[0.9375rem] leading-relaxed">{brief.criteria}</dd>
            </>
          )}
          {brief?.constraints && (
            <>
              <dt className="doc-label pt-0.5">Constraints</dt>
              <dd className="text-[0.9375rem] leading-relaxed">{brief.constraints}</dd>
            </>
          )}

          <dt className="doc-label pt-0.5">Sources read</dt>
          <dd className="text-[0.9375rem]">
            {included.length ? (
              included.map((a) => a.name).join(", ")
            ) : (
              <span className="text-[var(--doc-muted)]">None attached.</span>
            )}
            {(result.attachments ?? []).some((a) => !a.included) && (
              <span className="block text-[0.8125rem] text-[var(--doc-muted)]">
                Excluded:{" "}
                {(result.attachments ?? [])
                  .filter((a) => !a.included)
                  .map((a) => `${a.name}${a.error ? ` (${a.error})` : ""}`)
                  .join("; ")}
              </span>
            )}
          </dd>

          <dt className="doc-label pt-0.5">Roles on the panel</dt>
          <dd className="text-[0.9375rem]">
            {orderedRoles
              .map((lens) => `${lens.label} (${byRole.get(lens.id)?.length ?? 0})`)
              .join(", ")}
          </dd>
        </dl>
      </div>

      <DocHeading>The panel</DocHeading>
      <div className="space-y-8">
        {orderedRoles.map((lens) => (
          <section key={lens.id}>
            <div className="mb-3 flex items-baseline gap-3">
              <h3 className="text-[0.9375rem] font-medium">{lens.label}</h3>
              <span className="tnum text-[0.75rem] text-[var(--doc-muted)]">
                {byRole.get(lens.id)?.length} of {personas.length}
              </span>
              <span className="hidden text-[0.8125rem] text-[var(--doc-muted)] sm:inline">
                {lens.blurb}
              </span>
            </div>
            <div className="space-y-3">
              {byRole.get(lens.id)?.map((persona) => (
                <ExpertEntry key={persona.key} persona={persona} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {synthesis && (synthesis.consensus_points?.length ?? 0) > 0 && (
        <>
          <DocHeading>What they agree on</DocHeading>
          <div className="doc-card break-inside-avoid p-5">
            <Bullets items={synthesis.consensus_points} marker="var(--doc-go)" />
          </div>
        </>
      )}

      {synthesis && (synthesis.disagreements?.length ?? 0) > 0 && (
        <>
          <DocHeading>Where they split</DocHeading>
          <div className="space-y-3">
            {synthesis.disagreements.map((disagreement, i) => (
              <article key={i} className="doc-card break-inside-avoid p-5">
                <h3 className="text-[0.9375rem] font-medium">{disagreement.topic}</h3>
                <div className="mt-3">
                  <Bullets items={sidesLines(disagreement.sides)} />
                </div>
                {disagreement.resolution && (
                  <p className="mt-4 border-t border-[var(--doc-rule)] pt-3 text-[0.875rem] leading-relaxed">
                    <span style={{ color: "var(--doc-accent)" }}>Reconciled — </span>
                    {disagreement.resolution}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {synthesis && (
        <>
          <DocHeading>Standing and exposure</DocHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Strengths", synthesis.strengths, "var(--doc-go)"],
                ["Weaknesses", synthesis.weaknesses, "var(--doc-no)"],
                ["Opportunities", synthesis.opportunities, "var(--doc-caution)"],
                ["Threats", synthesis.threats, "oklch(45% 0.09 52)"],
              ] as [string, string[] | undefined, string][]
            ).map(([title, items, color]) => (
              <div key={title} className="doc-card break-inside-avoid p-5">
                <h3 className="text-[0.9375rem] font-medium" style={{ color }}>
                  {title}
                </h3>
                <div className="mt-3">
                  <Bullets items={items} marker={color} />
                </div>
              </div>
            ))}
          </div>

          <DocHeading>What to do next</DocHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Immediate", "7 days", synthesis.action_plan_7_days],
                ["Follow-through", "30 days", synthesis.action_plan_30_days],
              ] as [string, string, string[] | undefined][]
            ).map(([title, horizon, steps]) => (
              <div key={title} className="doc-card break-inside-avoid p-5">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-[0.9375rem] font-medium">{title}</h3>
                  <span className="tnum text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--doc-muted)]">
                    {horizon}
                  </span>
                </div>
                <ol className="mt-3 space-y-2.5">
                  {(steps ?? []).map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-[0.875rem] leading-relaxed">
                      <span className="tnum shrink-0 text-[0.75rem]" style={{ color: "var(--doc-accent)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}

      {synthesis?.final_recommendation && (
        <>
          <DocHeading>The chair&rsquo;s recommendation</DocHeading>
          <div className="doc-card break-inside-avoid p-5 md:p-6">
            <p className="max-w-[62ch] text-[1rem] leading-relaxed text-[var(--doc-ink)]">
              {synthesis.final_recommendation}
            </p>
          </div>
        </>
      )}

      <DocHeading>Reviewer notes</DocHeading>
      <div className="doc-card p-5">
        <label htmlFor="reviewer-note" className="doc-label">
          Added by the reader of this report
        </label>
        <textarea
          id="reviewer-note"
          value={note}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          placeholder="What you decided, what you disagree with, what happens next…"
          className="doc-field mt-2 w-full resize-y rounded-[3px] px-3 py-2.5 text-[0.9375rem] leading-relaxed print:hidden"
        />
        {/* Printing an empty form field would waste a block; print the text only. */}
        <p className="mt-2 hidden whitespace-pre-wrap text-[0.9375rem] leading-relaxed print:block">
          {note.trim() || "—"}
        </p>
        <p className="mt-2 text-[0.75rem] text-[var(--doc-muted)] print:hidden">
          Saved in this browser and included in every export.
        </p>
      </div>

      <footer className="mt-12 border-t border-[var(--doc-rule)] pt-4 text-[0.75rem] leading-relaxed text-[var(--doc-muted)]">
        AI-generated analysis produced by DecisionX for thinking through an idea. Not financial,
        legal, medical or professional advice. Evaluation {entry.id} · generated{" "}
        {formatDate(entry.createdAt)}.
      </footer>
    </DocShell>
  );
}

function DocShell({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="relative z-[1] min-h-dvh pb-16 print:pb-0">
      <nav className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[oklch(7%_0.006_95/0.97)] backdrop-blur-lg print:hidden">
        <div className="mx-auto flex max-w-[60rem] items-center gap-3 px-6 py-4">
          <Link href="/" className="wordmark mr-auto no-underline">
            DecisionX
          </Link>
          {toolbar}
        </div>
      </nav>

      <main className="mx-auto mt-6 max-w-[60rem] px-4 print:mt-0 print:max-w-none print:px-0">
        <div className="doc px-6 py-10 shadow-[var(--shadow-lifted)] md:px-12 md:py-14 print:p-0 print:shadow-none">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <p className="text-[0.875rem] text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <ReportView />
    </Suspense>
  );
}
