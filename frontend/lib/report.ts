/**
 * Report generation — one evaluation, flattened into formats a reader can keep.
 *
 * Everything here is derived from what the panel already produced: the brief and
 * its checklist, each expert's verdict and score, the board's consensus and
 * splits, the SWOT quadrants, both action horizons, and any reviewer notes. No
 * new analysis is invented at export time.
 *
 * The builders are pure string functions with no DOM dependency, so the same code
 * produces the in-app report, the standalone HTML download, the CSV, and the
 * committed sample export under public/. Only `downloadFile` touches the browser.
 */

import type { BriefSnapshot } from "./brief";
import type { HistoryEntry } from "./history";
import { personaRole, personaStatus, roleLens, verdictStatus, type StatusId } from "./roles";
import type { Disagreement, PersonaResult } from "./types";

export type ReportFormat = "pdf" | "csv" | "html";

const STATUS_LABEL: Record<StatusId, string> = {
  favour: "In favour",
  mixed: "Mixed",
  against: "Against",
  unreachable: "Unreachable",
};

export function statusLabel(status: StatusId): string {
  return STATUS_LABEL[status];
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A stable, human-readable slug for downloaded filenames. */
export function reportFilename(entry: HistoryEntry, extension: ReportFormat | "html" | "csv"): string {
  const slug =
    entry.idea
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "evaluation";
  const stamp = new Date(entry.createdAt).toISOString().slice(0, 10);
  return `decisionx-${slug}-${stamp}.${extension}`;
}

/** Flatten `sides` — the synthesizer returns prose or a per-expert map. */
function sidesLines(sides: Disagreement["sides"]): string[] {
  if (!sides) return [];
  if (typeof sides === "string") return [sides];
  return Object.entries(sides).map(([expert, view]) => `${expert}: ${String(view)}`);
}

/* ─── CSV ─── */

export interface ReportRow {
  section: string;
  role: string;
  item: string;
  detail: string;
  score: string;
  status: string;
}

/**
 * One uniform table covering the whole evaluation. A flat shape keeps the CSV
 * openable anywhere and filterable by section or role, which a multi-block CSV
 * with shifting columns is not.
 */
export function buildReportRows(entry: HistoryEntry, note: string): ReportRow[] {
  const rows: ReportRow[] = [];
  const result = entry.result;
  const synthesis = result.synthesis;
  const brief: BriefSnapshot | undefined = entry.brief;

  const push = (
    section: string,
    item: string,
    detail: string,
    extras: { role?: string; score?: string; status?: string } = {},
  ) => {
    rows.push({
      section,
      role: extras.role ?? "",
      item,
      detail,
      score: extras.score ?? "",
      status: extras.status ?? "",
    });
  };

  push("Evaluation", "Idea", entry.idea, {
    score: `${entry.score}/10`,
    status: statusLabel(verdictStatus(entry.verdict, synthesis?.panel_unreachable)),
  });
  push("Evaluation", "Verdict", entry.verdict);
  push("Evaluation", "Generated", formatDate(entry.createdAt));
  push("Evaluation", "Panel size", `${entry.panelSize} experts`);
  push("Evaluation", "Domains detected", entry.domains.join(", ") || "none");
  if (synthesis?.consensus_percentage != null) {
    push("Evaluation", "Agreement", `${synthesis.consensus_percentage}%`);
  }
  if (result.elapsed_seconds != null) {
    push("Evaluation", "Elapsed", `${result.elapsed_seconds}s`);
  }

  if (brief) {
    push("Brief", "Checklist", `${brief.completed} of ${brief.total} sections complete`, {
      status: brief.requiredMet ? "Required complete" : "Required sections open",
    });
    if (brief.context) push("Brief", "Decision context", brief.context);
    if (brief.criteria) push("Brief", "Success criteria", brief.criteria);
    if (brief.constraints) push("Brief", "Constraints", brief.constraints);
  }

  for (const attachment of result.attachments ?? []) {
    push("Sources", attachment.name, attachment.error ?? (attachment.truncated ? "Read, truncated" : "Read in full"), {
      status: attachment.included ? "Included" : "Excluded",
    });
  }

  for (const persona of result.personas ?? []) {
    const lens = roleLens(personaRole(persona)).label;
    const status = statusLabel(personaStatus(persona));
    const score = persona.analysis?._failed ? "" : `${persona.analysis?.score ?? ""}/10`;
    push("Panel", persona.name, persona.analysis?.headline ?? "", { role: lens, score, status });
    for (const strength of persona.analysis?.strengths ?? []) {
      push("Panel — in favour", persona.name, strength, { role: lens });
    }
    for (const concern of persona.analysis?.concerns ?? []) {
      push("Panel — against", persona.name, concern, { role: lens });
    }
    if (persona.analysis?.recommendation) {
      push("Panel — recommendation", persona.name, persona.analysis.recommendation, { role: lens });
    }
  }

  if (synthesis) {
    if (synthesis.executive_summary) push("Synthesis", "Executive summary", synthesis.executive_summary);
    for (const point of synthesis.consensus_points ?? []) push("Consensus", "Agreed", point);

    for (const disagreement of synthesis.disagreements ?? []) {
      for (const line of sidesLines(disagreement.sides)) {
        push("Disagreement", disagreement.topic, line);
      }
      if (disagreement.resolution) {
        push("Disagreement — reconciled", disagreement.topic, disagreement.resolution);
      }
    }

    const quadrants: [string, string[] | undefined][] = [
      ["Strength", synthesis.strengths],
      ["Weakness", synthesis.weaknesses],
      ["Opportunity", synthesis.opportunities],
      ["Threat", synthesis.threats],
    ];
    for (const [label, items] of quadrants) {
      for (const item of items ?? []) push("SWOT", label, item);
    }

    for (const step of synthesis.action_plan_7_days ?? []) push("Action plan", "Next 7 days", step);
    for (const step of synthesis.action_plan_30_days ?? []) push("Action plan", "Next 30 days", step);

    if (synthesis.final_recommendation) {
      push("Recommendation", "The chair", synthesis.final_recommendation);
    }
    for (const failed of synthesis.failed_agents ?? []) {
      push("Panel", failed, "Provider call failed; excluded from the score", { status: "Unreachable" });
    }
  }

  if (note.trim()) push("Reviewer notes", "Note", note.trim());

  return rows;
}

const CSV_HEADER = ["Section", "Role", "Item", "Detail", "Score", "Status"];

function csvCell(value: string): string {
  const text = value.replace(/\r?\n/g, " ").trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildReportCsv(entry: HistoryEntry, note: string): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of buildReportRows(entry, note)) {
    lines.push(
      [row.section, row.role, row.item, row.detail, row.score, row.status].map(csvCell).join(","),
    );
  }
  // A BOM so spreadsheet apps read the em dashes and rupee signs as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* ─── Standalone HTML ─── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function verdictInkVar(status: StatusId): string {
  if (status === "favour") return "var(--doc-go)";
  if (status === "against") return "var(--doc-no)";
  if (status === "unreachable") return "var(--doc-muted)";
  return "var(--doc-caution)";
}

function list(items: string[] | undefined, className = ""): string {
  if (!items?.length) return `<p class="empty">Nothing identified.</p>`;
  const attr = className ? ` class="${className}"` : "";
  return `<ul${attr}>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function expertBlock(persona: PersonaResult): string {
  const analysis = persona.analysis;
  const status = personaStatus(persona);
  const lens = roleLens(personaRole(persona)).label;

  if (analysis?._failed) {
    return `<article class="expert">
      <header><h3>${escapeHtml(persona.name)}</h3><span class="tag">${escapeHtml(lens)}</span></header>
      <p class="role">${escapeHtml(persona.role)}</p>
      <p class="empty">Unreachable — ${escapeHtml(analysis.headline ?? "the provider call failed.")}</p>
    </article>`;
  }

  return `<article class="expert">
    <header>
      <h3>${escapeHtml(persona.name)}</h3>
      <span class="tag">${escapeHtml(lens)}</span>
      <span class="score" style="color:${verdictInkVar(status)}">${analysis?.score ?? "–"}<small>/10</small></span>
    </header>
    <p class="role">${escapeHtml(persona.role)} · <strong style="color:${verdictInkVar(status)}">${escapeHtml(
      statusLabel(status),
    )}</strong>${persona.custom ? ' · <em>bespoke</em>' : ""}</p>
    <p class="headline">${escapeHtml(analysis?.headline ?? "")}</p>
    <h4>In favour</h4>
    ${list(analysis?.strengths)}
    <h4>Against</h4>
    ${list(analysis?.concerns)}
    ${
      analysis?.recommendation
        ? `<p class="rec"><span>Do this —</span> ${escapeHtml(analysis.recommendation)}</p>`
        : ""
    }
  </article>`;
}

/**
 * A self-contained document: no external stylesheet, font or script, so the file
 * renders identically offline and prints to PDF straight from the browser.
 */
export function buildReportHtml(entry: HistoryEntry, note: string): string {
  const result = entry.result;
  const synthesis = result.synthesis;
  const brief = entry.brief;
  const status = verdictStatus(entry.verdict, synthesis?.panel_unreachable);
  const personas = result.personas ?? [];

  const roleTally = new Map<string, number>();
  for (const persona of personas) {
    const label = roleLens(personaRole(persona)).label;
    roleTally.set(label, (roleTally.get(label) ?? 0) + 1);
  }

  const included = (result.attachments ?? []).filter((a) => a.included);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DecisionX report — ${escapeHtml(entry.idea.slice(0, 70))}</title>
<style>
  :root {
    --doc-paper: #fbf9f4;
    --doc-panel: #ffffff;
    --doc-ink: #211f1a;
    --doc-body: #4a463d;
    --doc-muted: #7c7669;
    --doc-rule: rgba(33, 31, 26, 0.14);
    --doc-accent: #8a6410;
    --doc-go: #1f6f6a;
    --doc-caution: #8a6410;
    --doc-no: #a63a2c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.5rem 4rem;
    background: var(--doc-paper);
    color: var(--doc-body);
    font: 400 15px/1.65 "Albert Sans", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .sheet { max-width: 52rem; margin: 0 auto; }
  h1, h2, h3, h4 { color: var(--doc-ink); font-weight: 500; line-height: 1.15; margin: 0; }
  h1 { font-size: 1.9rem; letter-spacing: -0.02em; }
  h2 {
    font-size: 1.05rem; letter-spacing: 0.02em; text-transform: uppercase;
    padding-bottom: 0.5rem; border-bottom: 1px solid var(--doc-rule); margin: 2.75rem 0 1.25rem;
  }
  h3 { font-size: 1rem; }
  h4 {
    font-size: 0.6875rem; letter-spacing: 0.13em; text-transform: uppercase;
    color: var(--doc-muted); margin: 1.1rem 0 0.4rem;
  }
  p { margin: 0 0 0.75rem; }
  ul { margin: 0 0 0.75rem; padding-left: 1.1rem; }
  li { margin-bottom: 0.3rem; }
  .wordmark { font-size: 0.7rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--doc-muted); }
  .meta { font-size: 0.8125rem; color: var(--doc-muted); margin-top: 0.5rem; }
  .verdict-line { display: flex; align-items: baseline; gap: 1rem; margin: 1.75rem 0 0; }
  .verdict-line .big { font-size: 3rem; font-weight: 300; line-height: 1; color: ${verdictInkVar(status)}; }
  .verdict-line .chip {
    font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
    border: 1px solid currentColor; border-radius: 2px; padding: 0.2rem 0.5rem; color: ${verdictInkVar(status)};
  }
  .summary { font-size: 1.0625rem; color: var(--doc-ink); max-width: 62ch; }
  .grid { display: grid; gap: 1rem; }
  @media (min-width: 40rem) { .grid.two { grid-template-columns: 1fr 1fr; } }
  .card, .expert {
    background: var(--doc-panel); border: 1px solid var(--doc-rule);
    border-radius: 3px; padding: 1.1rem 1.25rem; break-inside: avoid;
  }
  .expert { margin-bottom: 1rem; }
  .expert header { display: flex; align-items: baseline; gap: 0.6rem; }
  .expert .score { margin-left: auto; font-size: 1.35rem; font-weight: 300; }
  .expert .score small { font-size: 0.75rem; color: var(--doc-muted); }
  .expert .role { font-size: 0.8125rem; color: var(--doc-muted); margin: 0.15rem 0 0.75rem; }
  .expert .headline { color: var(--doc-ink); }
  .tag {
    font-size: 0.625rem; letter-spacing: 0.1em; text-transform: uppercase;
    border: 1px solid var(--doc-rule); border-radius: 2px; padding: 0.1rem 0.35rem; color: var(--doc-muted);
  }
  .rec { border-top: 1px solid var(--doc-rule); padding-top: 0.6rem; margin: 0.85rem 0 0; font-size: 0.9375rem; }
  .rec span { color: var(--doc-accent); }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1.25rem; font-size: 0.9375rem; }
  .kv dt { color: var(--doc-muted); }
  .kv dd { margin: 0; color: var(--doc-ink); }
  .empty { color: var(--doc-muted); font-style: italic; }
  .quad h3 { font-size: 0.9375rem; margin-bottom: 0.5rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--doc-rule); font-size: 0.75rem; color: var(--doc-muted); }
  @page { margin: 16mm; }
  @media print { body { padding: 0; background: #fff; } .card, .expert { border-color: #ddd; } }
</style>
</head>
<body>
<div class="sheet">
  <p class="wordmark">DecisionX — panel report</p>
  <h1>${escapeHtml(entry.idea)}</h1>
  <p class="meta">${escapeHtml(formatDate(entry.createdAt))} · ${entry.panelSize} experts · ${
    entry.domains.length ? escapeHtml(entry.domains.join(" · ")) : "no domain matched"
  }${result.elapsed_seconds != null ? ` · ${result.elapsed_seconds}s` : ""}</p>

  <div class="verdict-line">
    <span class="big">${entry.score}</span>
    <span class="chip">${escapeHtml(entry.verdict)}</span>
    <span class="meta">${
      synthesis?.consensus_percentage != null
        ? `${synthesis.consensus_percentage}% agreement across ${personas.length} experts`
        : `${personas.length} experts`
    }</span>
  </div>

  ${synthesis?.executive_summary ? `<p class="summary" style="margin-top:1.5rem">${escapeHtml(synthesis.executive_summary)}</p>` : ""}

  <h2>The brief</h2>
  <div class="card">
    <dl class="kv">
      ${
        brief
          ? `<dt>Checklist</dt><dd>${brief.completed} of ${brief.total} sections complete${
              brief.requiredMet ? "" : " — required sections were left open"
            }</dd>`
          : ""
      }
      ${brief?.context ? `<dt>Context</dt><dd>${escapeHtml(brief.context)}</dd>` : ""}
      ${brief?.criteria ? `<dt>Success criteria</dt><dd>${escapeHtml(brief.criteria)}</dd>` : ""}
      ${brief?.constraints ? `<dt>Constraints</dt><dd>${escapeHtml(brief.constraints)}</dd>` : ""}
      <dt>Sources read</dt><dd>${
        included.length ? included.map((a) => escapeHtml(a.name)).join(", ") : "none attached"
      }</dd>
      <dt>Roles on the panel</dt><dd>${
        [...roleTally.entries()].map(([label, n]) => `${escapeHtml(label)} (${n})`).join(", ") || "—"
      }</dd>
    </dl>
  </div>

  <h2>The panel</h2>
  ${personas.map(expertBlock).join("")}

  ${
    synthesis?.consensus_points?.length
      ? `<h2>What they agree on</h2><div class="card">${list(synthesis.consensus_points)}</div>`
      : ""
  }

  ${
    synthesis?.disagreements?.length
      ? `<h2>Where they split</h2>${synthesis.disagreements
          .map(
            (d) => `<div class="card" style="margin-bottom:1rem">
              <h3>${escapeHtml(d.topic)}</h3>
              ${list(sidesLines(d.sides))}
              ${d.resolution ? `<p class="rec"><span>Reconciled —</span> ${escapeHtml(d.resolution)}</p>` : ""}
            </div>`,
          )
          .join("")}`
      : ""
  }

  ${
    synthesis
      ? `<h2>Standing and exposure</h2>
    <div class="grid two">
      <div class="card quad"><h3 style="color:var(--doc-go)">Strengths</h3>${list(synthesis.strengths)}</div>
      <div class="card quad"><h3 style="color:var(--doc-no)">Weaknesses</h3>${list(synthesis.weaknesses)}</div>
      <div class="card quad"><h3 style="color:var(--doc-caution)">Opportunities</h3>${list(synthesis.opportunities)}</div>
      <div class="card quad"><h3 style="color:#8d5a2b">Threats</h3>${list(synthesis.threats)}</div>
    </div>

    <h2>What to do next</h2>
    <div class="grid two">
      <div class="card quad"><h3>Immediate — 7 days</h3>${list(synthesis.action_plan_7_days)}</div>
      <div class="card quad"><h3>Follow-through — 30 days</h3>${list(synthesis.action_plan_30_days)}</div>
    </div>`
      : ""
  }

  ${
    synthesis?.final_recommendation
      ? `<h2>The chair's recommendation</h2><div class="card"><p class="summary">${escapeHtml(
          synthesis.final_recommendation,
        )}</p></div>`
      : ""
  }

  ${note.trim() ? `<h2>Reviewer notes</h2><div class="card"><p>${escapeHtml(note.trim())}</p></div>` : ""}

  <footer>
    AI-generated analysis produced by DecisionX for thinking through an idea. Not financial, legal,
    medical or professional advice. Exported ${escapeHtml(formatDate(Date.now()))}.
  </footer>
</div>
</body>
</html>
`;
}

/* ─── Delivery ─── */

const MIME: Record<"csv" | "html", string> = {
  csv: "text/csv;charset=utf-8",
  html: "text/html;charset=utf-8",
};

/** Hand a generated string to the browser as a download. */
export function downloadFile(filename: string, kind: "csv" | "html", contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: MIME[kind] }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can race the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
