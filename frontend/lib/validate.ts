/**
 * Runtime guards at the edges where untyped JSON enters the app: the NDJSON
 * stream from the backend, records read back from localStorage, and imported
 * sample files.
 *
 * The model behind the backend does not always honour its schema — a score
 * arrives as "8/10", a list arrives as one string, a field goes missing. Rather
 * than let one odd value crash the results page, everything is coerced here into
 * the shapes lib/types.ts promises. Hand-rolled on purpose: no schema dependency.
 */

import type { BriefSnapshot } from "./brief";
import type { HistoryEntry } from "./history";
import type {
  Attachment,
  Chart,
  ChartPoint,
  Disagreement,
  EvalResult,
  Expert,
  PersonaAnalysis,
  PersonaResult,
  StreamEvent,
  Synthesis,
} from "./types";

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Rec {
  return isRecord(value) ? value : {};
}

/** Strings pass through; numbers and booleans are stringified; anything else falls back. */
export function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return fallback;
}

function itemText(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (isRecord(item)) {
    const parts = Object.values(item).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    if (parts.length) return parts.join(" — ");
    try {
      return JSON.stringify(item);
    } catch {
      return "";
    }
  }
  return "";
}

/** Any list-ish value becomes string[]; a lone string becomes a one-item list. */
export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(itemText).filter((s) => s.trim() !== "");
  if (typeof value === "string") return value.trim() ? [value] : [];
  return [];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A score on the 1–10 scale, or null when none can be read. Accepts numbers,
 * numeric strings, and the forms models like to write: "8/10", "4 / 5",
 * "7 out of 10", "Score: 6.5".
 */
export function normalizeScore(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === "number") {
    n = Number.isFinite(value) ? value : null;
  } else if (typeof value === "string") {
    const ratio = /(-?\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i.exec(value);
    if (ratio) {
      const num = Number(ratio[1]);
      const den = Number(ratio[2]);
      n = den > 0 ? (num / den) * 10 : null;
    } else {
      const single = /-?\d+(?:\.\d+)?/.exec(value);
      n = single ? Number(single[0]) : null;
    }
    if (n != null && !Number.isFinite(n)) n = null;
  }
  if (n == null) return null;
  return round1(Math.min(10, Math.max(1, n)));
}

/** A 0–100 percentage, or null. Accepts "80%" and numeric strings. */
function normalizePercent(value: unknown): number | null {
  let n = finiteNumber(value);
  if (n == null && typeof value === "string") {
    const match = /-?\d+(?:\.\d+)?/.exec(value);
    n = match ? Number(match[0]) : null;
  }
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)));
}

function normalizeChart(value: unknown): Chart | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = value.type;
  const type: Chart["type"] | null =
    rawType === "bar" || rawType === "line" || rawType === "split" ? rawType : null;
  if (!type) return undefined;
  const data: ChartPoint[] = [];
  const rawData = value.data;
  if (Array.isArray(rawData)) {
    for (const point of rawData) {
      if (!isRecord(point)) continue;
      const n = finiteNumber(point.value);
      if (n == null) continue;
      data.push({ label: asString(point.label, String(data.length + 1)), value: n });
    }
  }
  if (data.length === 0) return undefined;
  const chart: Chart = {
    type,
    title: asString(value.title),
    unit: asString(value.unit),
    note: asString(value.note),
    data,
  };
  if (value.measured === true) chart.measured = true;
  return chart;
}

export function normalizeAnalysis(value: unknown): PersonaAnalysis {
  if (!isRecord(value)) {
    return {
      verdict: "Unreachable",
      score: null,
      headline: "No analysis was returned for this expert.",
      strengths: [],
      concerns: [],
      recommendation: "",
      _failed: true,
    };
  }
  const failed = value._failed === true;
  const analysis: PersonaAnalysis = {
    verdict: asString(value.verdict, failed ? "Unreachable" : "—"),
    score: normalizeScore(value.score),
    headline: asString(value.headline),
    strengths: asStringList(value.strengths),
    concerns: asStringList(value.concerns),
    recommendation: asString(value.recommendation),
  };
  const chart = normalizeChart(value.chart);
  if (chart) analysis.chart = chart;
  if (failed) analysis._failed = true;
  return analysis;
}

export function normalizeExpert(value: unknown, index = 0): Expert | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name, "").trim() || `Expert ${index + 1}`;
  const key = asString(value.key, "").trim() || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${index}`;
  return {
    key,
    name,
    role: asString(value.role),
    icon: asString(value.icon),
    color: asString(value.color, "").trim() || "var(--accent)",
    custom: value.custom === true,
  };
}

export function normalizePersona(value: unknown, index = 0): PersonaResult | null {
  const expert = normalizeExpert(value, index);
  if (!expert) return null;
  return { ...expert, analysis: normalizeAnalysis(asRecord(value).analysis) };
}

function normalizeDisagreement(value: unknown): Disagreement | null {
  if (typeof value === "string") return value.trim() ? { topic: value, sides: "", resolution: "" } : null;
  if (!isRecord(value)) return null;
  const rawSides = value.sides;
  let sides: Disagreement["sides"] = "";
  if (typeof rawSides === "string") {
    sides = rawSides;
  } else if (Array.isArray(rawSides)) {
    sides = asStringList(rawSides).join(" · ");
  } else if (isRecord(rawSides)) {
    const map: Record<string, string> = {};
    for (const [expert, view] of Object.entries(rawSides)) {
      const text = Array.isArray(view) ? asStringList(view).join(" · ") : itemText(view);
      if (text.trim()) map[expert] = text;
    }
    sides = map;
  }
  return {
    topic: asString(value.topic, "Disagreement"),
    sides,
    resolution: asString(value.resolution),
  };
}

export function normalizeSynthesis(value: unknown): Synthesis | undefined {
  if (!isRecord(value)) return undefined;

  const agentScores: Record<string, number> = {};
  for (const [name, raw] of Object.entries(asRecord(value.agent_scores))) {
    const score = normalizeScore(raw);
    if (score != null) agentScores[name] = score;
  }

  const disagreements: Disagreement[] = [];
  const rawDisagreements = value.disagreements;
  if (Array.isArray(rawDisagreements)) {
    for (const d of rawDisagreements) {
      const parsed = normalizeDisagreement(d);
      if (parsed) disagreements.push(parsed);
    }
  }

  const synthesis: Synthesis = {
    overall_score: normalizeScore(value.overall_score),
    verdict: asString(value.verdict, "Caution"),
    executive_summary: asString(value.executive_summary),
    consensus_points: asStringList(value.consensus_points),
    disagreements,
    strengths: asStringList(value.strengths),
    weaknesses: asStringList(value.weaknesses),
    opportunities: asStringList(value.opportunities),
    threats: asStringList(value.threats),
    action_plan_7_days: asStringList(value.action_plan_7_days),
    action_plan_30_days: asStringList(value.action_plan_30_days),
    final_recommendation: asString(value.final_recommendation),
    consensus_percentage: normalizePercent(value.consensus_percentage),
    agent_scores: agentScores,
  };

  if (value.failed_agents !== undefined) synthesis.failed_agents = asStringList(value.failed_agents);
  if (value.panel_unreachable === true) synthesis.panel_unreachable = true;
  const rawCharts = value.charts;
  if (Array.isArray(rawCharts)) {
    synthesis.charts = rawCharts
      .map((c) => normalizeChart(c))
      .filter((c): c is Chart => c !== undefined);
  }
  const scoreChart = normalizeChart(value.score_chart);
  if (scoreChart) synthesis.score_chart = scoreChart;
  return synthesis;
}

export function normalizeAttachment(value: unknown): Attachment | null {
  if (!isRecord(value)) return null;
  const attachment: Attachment = {
    name: asString(value.name, "").trim() || "Untitled file",
    bytes: finiteNumber(value.bytes) ?? 0,
    included: value.included === true,
  };
  const truncated = value.truncated;
  if (typeof truncated === "boolean") attachment.truncated = truncated;
  const error = value.error;
  if (typeof error === "string" && error.trim()) attachment.error = error;
  const chars = finiteNumber(value.chars_included);
  if (chars != null) attachment.chars_included = chars;
  return attachment;
}

export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAttachment).filter((a): a is Attachment => a !== null);
}

function normalizeExperts(value: unknown): Expert[] {
  if (!Array.isArray(value)) return [];
  return value.map((v, i) => normalizeExpert(v, i)).filter((e): e is Expert => e !== null);
}

function normalizePersonas(value: unknown): PersonaResult[] {
  if (!Array.isArray(value)) return [];
  return value.map((v, i) => normalizePersona(v, i)).filter((p): p is PersonaResult => p !== null);
}

export function normalizeResult(value: unknown): EvalResult | null {
  if (!isRecord(value)) return null;
  const rawExperts = value.selected_experts;
  const result: EvalResult = {
    idea: asString(value.idea),
    detected_domains: asStringList(value.detected_domains),
    selected_experts: Array.isArray(rawExperts)
      ? rawExperts.filter(isRecord).map((e) => ({
          name: asString(e.name),
          icon: asString(e.icon),
          role: asString(e.role),
          color: asString(e.color),
        }))
      : [],
    personas: normalizePersonas(value.personas),
    synthesis: normalizeSynthesis(value.synthesis),
  };
  const elapsed = finiteNumber(value.elapsed_seconds);
  if (elapsed != null) result.elapsed_seconds = round1(elapsed);
  if (value.attachments !== undefined) result.attachments = normalizeAttachments(value.attachments);
  return result;
}

/** One parsed NDJSON line → a well-formed event, or null when it is not one we understand. */
export function parseStreamEvent(value: unknown): StreamEvent | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "stage":
      return { type: "stage", stage: value.stage === "synthesizing" ? "synthesizing" : "assembling" };
    case "attachments":
      return { type: "attachments", attachments: normalizeAttachments(value.attachments) };
    case "panel":
      return {
        type: "panel",
        domains: asStringList(value.domains),
        experts: normalizeExperts(value.experts),
      };
    case "persona": {
      const persona = normalizePersona(value.persona);
      return persona ? { type: "persona", persona } : null;
    }
    case "done": {
      const result = normalizeResult(value.result);
      return result
        ? { type: "done", result }
        : { type: "error", message: "The backend finished but returned a result this page cannot read." };
    }
    case "error":
      return {
        type: "error",
        message:
          asString(value.message, "").trim() ||
          asString(value.detail, "").trim() ||
          "The evaluation failed on the backend.",
      };
    default:
      return null;
  }
}

function normalizeBrief(value: unknown): BriefSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  return {
    context: asString(value.context),
    criteria: asString(value.criteria),
    constraints: asString(value.constraints),
    sourceNames: asStringList(value.sourceNames),
    completed: finiteNumber(value.completed) ?? 0,
    total: finiteNumber(value.total) ?? 0,
    requiredMet: value.requiredMet === true,
  };
}

/** A stored or imported history record, or null when it cannot be salvaged. */
export function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id, "").trim();
  if (!id) return null;
  const result = normalizeResult(value.result);
  if (!result) return null;

  const entry: HistoryEntry = {
    id,
    createdAt: finiteNumber(value.createdAt) ?? 0,
    idea: asString(value.idea, "") || result.idea,
    verdict: asString(value.verdict, "") || result.synthesis?.verdict || "Caution",
    score: value.score !== undefined ? normalizeScore(value.score) : result.synthesis?.overall_score ?? null,
    panelSize: finiteNumber(value.panelSize) ?? result.personas.length,
    domains: value.domains !== undefined ? asStringList(value.domains) : result.detected_domains,
    attachmentCount:
      finiteNumber(value.attachmentCount) ?? (result.attachments ?? []).filter((a) => a.included).length,
    result,
  };
  const brief = normalizeBrief(value.brief);
  if (brief) entry.brief = brief;
  return entry;
}

/** Normalise a list of records, dropping unreadable ones and duplicate ids. */
export function normalizeHistoryEntries(values: unknown[]): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const value of values) {
    const entry = normalizeHistoryEntry(value);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
