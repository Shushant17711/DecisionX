"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { FileDrop } from "@/components/FileDrop";
import { HistorySidebar, HistoryToggle } from "@/components/HistorySidebar";
import { Icon } from "@/components/Icon";
import { PanelSizeControl } from "@/components/PanelSizeControl";
import { startEvaluation } from "@/lib/evaluation";

const EXAMPLE_IDEAS = [
  "A tiffin subscription for college students in Pune — home-style meals, monthly plans, routed by a demand model instead of fixed menus",
  "A carbon credit marketplace where small Indian manufacturers can sell verified offsets without a broker",
  "A community library app that matches rural readers with urban book donors and handles the logistics",
  "Résumé screening for HR teams under twenty people, built to strip identity signals before ranking",
  "A skill exchange where people trade expertise by the hour instead of paying each other",
];

export default function HomePage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [panelSize, setPanelSize] = useState(5);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  const submit = () => {
    const trimmed = idea.trim();
    if (!trimmed) return;
    startEvaluation({ idea: trimmed, context: context.trim(), panelSize, files });
    router.push("/results");
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
        <section className="grid gap-x-16 gap-y-12 pb-8 pt-16 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
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
          </div>

          {/* Form */}
          <div className="panel-raised seam p-6 md:p-7">
            <label htmlFor="idea" className="label">
              The idea
            </label>
            <textarea
              id="idea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              placeholder="A tiffin subscription for college students that routes meals by demand rather than a fixed menu…"
              rows={5}
              className="field mt-2.5 resize-y"
            />

            <div className="mt-5">
              <FileDrop files={files} onChange={setFiles} />
            </div>

            <button
              type="button"
              onClick={() => setShowContext((v) => !v)}
              aria-expanded={showContext}
              className="mt-4 flex items-center gap-1.5 text-[0.8125rem] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
            >
              <Icon
                name="chevronDown"
                size={14}
                style={{
                  transform: showContext ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 0.16s var(--ease-out)",
                }}
              />
              Add written context
            </button>

            {showContext && (
              <textarea
                id="context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Budget, timeline, what you have already tried, constraints you cannot change…"
                rows={3}
                className="field mt-2.5 resize-y text-[0.875rem]"
              />
            )}

            <hr className="my-6 border-0 border-t border-[var(--border-subtle)]" />

            <PanelSizeControl value={panelSize} onChange={setPanelSize} />

            <button
              type="button"
              onClick={submit}
              disabled={!idea.trim()}
              className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3.5 text-[0.9375rem]"
            >
              Convene the panel
              <Icon name="arrowRight" size={17} />
            </button>
            <p className="mt-2.5 text-center text-[0.75rem] text-[var(--text-muted)]">
              Results stream in as each expert finishes
            </p>
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
                  onClick={() => setIdea(example)}
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
