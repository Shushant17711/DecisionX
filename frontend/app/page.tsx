"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { BriefChecklist } from "@/components/BriefChecklist";
import { FileDrop } from "@/components/FileDrop";
import { HistorySidebar, HistoryToggle } from "@/components/HistorySidebar";
import { Icon } from "@/components/Icon";
import { PanelSizeControl } from "@/components/PanelSizeControl";
import {
  buildChecklist,
  composeContext,
  getDraft,
  getDraftServerSnapshot,
  replaceDraft,
  sampleSourceFile,
  SAMPLE_BRIEF,
  snapshot,
  subscribeDraft,
  summarise,
  updateDraft,
  type BriefField,
} from "@/lib/brief";
import { startEvaluation } from "@/lib/evaluation";
import { FEATURED_SAMPLE_ID, seedSamples } from "@/lib/samples";

const EXAMPLE_IDEAS = [
  "A tiffin subscription for college students in Pune — home-style meals, monthly plans, routed by a demand model instead of fixed menus",
  "A carbon credit marketplace where small Indian manufacturers can sell verified offsets without a broker",
  "A community library app that matches rural readers with urban book donors and handles the logistics",
  "Résumé screening for HR teams under twenty people, built to strip identity signals before ranking",
  "A skill exchange where people trade expertise by the hour instead of paying each other",
];

export default function HomePage() {
  const router = useRouter();
  const draft = useSyncExternalStore(subscribeDraft, getDraft, getDraftServerSnapshot);
  const [files, setFiles] = useState<File[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const constraintsRef = useRef<HTMLTextAreaElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

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

  const summary = useMemo(
    () => summarise(buildChecklist(draft, files.length)),
    [draft, files.length],
  );

  const focusField = (field: BriefField) => {
    const target =
      field === "idea"
        ? ideaRef.current
        : field === "criteria"
          ? criteriaRef.current
          : field === "context"
            ? contextRef.current
            : field === "constraints"
              ? constraintsRef.current
              : // FileDrop's own trigger — the checklist row should land on the
                // control that satisfies it, not merely near it.
                sourcesRef.current?.querySelector<HTMLButtonElement>("button");
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  };

  const submit = () => {
    const idea = draft.idea.trim();
    if (!idea) return;
    startEvaluation({
      idea,
      context: composeContext(draft),
      panelSize: draft.panelSize,
      files,
      brief: snapshot(draft, summary, files.map((f) => f.name)),
    });
    router.push("/results");
  };

  const loadWorkedExample = async () => {
    setSampleState("loading");
    replaceDraft({ ...SAMPLE_BRIEF, sourceNames: ["unit-economics.csv"], updatedAt: Date.now() });
    setFiles([sampleSourceFile()]);
    const outcome = await seedSamples();
    setSampleState(outcome.ok ? "ready" : "failed");
  };

  return (
    <div className="relative z-[1] min-h-dvh">
      <HistorySidebar open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <nav className="mx-auto flex max-w-[76rem] items-center justify-between px-6 py-5 md:px-10">
        <span className="wordmark">DecisionX</span>
        <HistoryToggle onClick={() => setHistoryOpen(true)} />
      </nav>

      <main className="mx-auto max-w-[76rem] px-6 md:px-10">
        {/* Hero — offset rather than centered, so the page reads left-to-right
            into the form instead of stacking symmetric blocks. */}
        <section className="grid items-start gap-x-16 gap-y-12 pb-8 pt-16 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
          <div className="lg:sticky lg:top-10">
            <h1 className="max-w-[14ch]">
              Your idea,
              <br />
              <span className="font-medium text-[var(--accent)]">cross-examined.</span>
            </h1>
            <p className="measure mt-8 text-[1.0625rem] leading-relaxed text-[var(--text-secondary)]">
              Describe anything — a business, a system design, a policy, a research direction. A
              panel of experts is assembled around it, each one argues its own corner, and you get
              back a scored verdict that shows exactly where they split.
            </p>

            <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
              {[
                { term: "30", detail: "experts per panel, max" },
                { term: "12", detail: "on the standing roster" },
                { term: "∞", detail: "designed per idea" },
              ].map(({ term, detail }) => (
                <div key={detail}>
                  <dt className="tnum text-[1.75rem] font-light leading-none text-[var(--foreground)]">
                    {term}
                  </dt>
                  <dd className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">{detail}</dd>
                </div>
              ))}
            </dl>

            {/* The worked example: a complete brief and three finished evaluations,
                so the filters and the report have something real to act on. */}
            <div className="mt-10 border-t border-[var(--border-subtle)] pt-6">
              <p className="label">First time here</p>
              <p className="measure mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                Load a worked example: every section of the brief filled in, with three finished
                evaluations added to your history to read and export.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={loadWorkedExample}
                  disabled={sampleState === "loading"}
                  className="btn-quiet flex items-center gap-2 px-3.5 py-2 text-[0.8125rem]"
                >
                  <Icon name="spark" size={15} />
                  {sampleState === "loading" ? "Loading…" : "Load a worked example"}
                </button>
                {sampleState === "ready" && (
                  <button
                    type="button"
                    onClick={() => router.push(`/report?id=${FEATURED_SAMPLE_ID}`)}
                    className="flex items-center gap-1.5 text-[0.8125rem] text-[var(--accent)]"
                  >
                    Open the sample report
                    <Icon name="arrowRight" size={14} />
                  </button>
                )}
                {sampleState === "failed" && (
                  <span className="text-[0.8125rem] text-[var(--text-muted)]">
                    The brief is filled in, but the sample records could not be read.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="panel-raised seam p-6 md:p-7">
            <label htmlFor="idea" className="label">
              The idea
            </label>
            <textarea
              id="idea"
              ref={ideaRef}
              value={draft.idea}
              onChange={(e) => updateDraft({ idea: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              placeholder="A tiffin subscription for college students that routes meals by demand rather than a fixed menu…"
              rows={5}
              className="field mt-2.5 resize-y"
            />

            <label htmlFor="criteria" className="label mt-5 block">
              Success criteria
            </label>
            <textarea
              id="criteria"
              ref={criteriaRef}
              value={draft.criteria}
              onChange={(e) => updateDraft({ criteria: e.target.value })}
              placeholder="The bar this has to clear — margin, adoption, timeline, risk you can accept…"
              rows={2}
              className="field mt-2.5 resize-y text-[0.875rem]"
            />

            <label htmlFor="context" className="label mt-5 block">
              Decision context
            </label>
            <textarea
              id="context"
              ref={contextRef}
              value={draft.context}
              onChange={(e) => updateDraft({ context: e.target.value })}
              placeholder="Stage, budget, timeline, what you have already tried…"
              rows={3}
              className="field mt-2.5 resize-y text-[0.875rem]"
            />

            <label htmlFor="constraints" className="label mt-5 block">
              Constraints <span className="normal-case tracking-normal">— optional</span>
            </label>
            <textarea
              id="constraints"
              ref={constraintsRef}
              value={draft.constraints}
              onChange={(e) => updateDraft({ constraints: e.target.value })}
              placeholder="What cannot change: regulation, headcount, a ceiling you will not cross…"
              rows={2}
              className="field mt-2.5 resize-y text-[0.875rem]"
            />

            <div className="mt-5" ref={sourcesRef}>
              <FileDrop files={files} onChange={setFiles} />
            </div>

            <hr className="my-6 border-0 border-t border-[var(--border-subtle)]" />

            <PanelSizeControl value={draft.panelSize} onChange={(n) => updateDraft({ panelSize: n })} />

            <hr className="my-6 border-0 border-t border-[var(--border-subtle)]" />

            <BriefChecklist summary={summary} onFocusField={focusField} />

            <button
              type="button"
              onClick={submit}
              disabled={!draft.idea.trim()}
              className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3.5 text-[0.9375rem]"
            >
              Convene the panel
              <Icon name="arrowRight" size={17} />
            </button>

            {summary.missingRequired.length > 0 ? (
              <p className="mt-2.5 flex items-start justify-center gap-1.5 text-center text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <span>
                  {summary.missingRequired.join(" and ")} still open — the panel will run on a
                  thinner brief.
                </span>
              </p>
            ) : (
              <p className="mt-2.5 text-center text-[0.75rem] text-[var(--text-muted)]">
                Results stream in as each expert finishes
              </p>
            )}
          </div>
        </section>

        {/* Examples */}
        <section className="border-t border-[var(--border-subtle)] py-10">
          <p className="label">Start from one of these</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLE_IDEAS.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => updateDraft({ idea: example })}
                  className="panel panel-interactive h-full w-full px-4 py-3 text-left text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works — the actual mechanism, not three feature cards */}
        <section className="border-t border-[var(--border-subtle)] py-16">
          <h2 className="max-w-[20ch]">What happens after you press the button</h2>
          <div className="mt-10">
            <ArchitectureDiagram />
          </div>
        </section>

        <footer className="border-t border-[var(--border-subtle)] py-8">
          <p className="measure text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
            DecisionX produces AI-generated analysis for thinking through an idea. It is not
            financial, legal, medical, or professional advice. Evaluations are stored in this
            browser only.
          </p>
        </footer>
      </main>
    </div>
  );
}
