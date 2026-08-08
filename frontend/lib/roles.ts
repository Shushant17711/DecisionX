/**
 * Role lenses and verdict statuses — the two axes an evaluation can be filtered on.
 *
 * A DecisionX panel is a crowd of experts, and different readers only care about
 * part of it: the person who has to live with the decision, the body that has to
 * approve it, the one paid to attack it. A lens groups the panel by whose interest
 * an expert represents, so a reader can scope both a panel and their history of
 * past evaluations to the seat they are sitting in.
 *
 * Built-in personas map by key (see backend/agents/personas.py). Bespoke experts
 * designed by the Panel Architect have no stable key, so they are classified by
 * matching their name and job title — most specific lens first.
 */

import type { PersonaResult, Synthesis } from "./types";

export type RoleId =
  | "user"
  | "admin"
  | "authority"
  | "hospital"
  | "investigator"
  | "reviewer"
  | "specialist";

export interface RoleLens {
  id: RoleId;
  label: string;
  /** What this lens means in this product — shown as the tab's title text. */
  blurb: string;
}

/** Ordered most specific first: classification stops at the first match. */
export const ROLE_LENSES: RoleLens[] = [
  { id: "hospital", label: "Hospital", blurb: "Clinical, patient-safety and care-delivery experts" },
  { id: "authority", label: "Authority", blurb: "Legal, compliance, policy and public-impact experts" },
  { id: "investigator", label: "Investigator", blurb: "The adversarial and evidence-checking seats" },
  { id: "reviewer", label: "Reviewer", blurb: "Capital, economics and strategy — the approving board" },
  { id: "admin", label: "Admin", blurb: "Operations, engineering and day-to-day execution" },
  { id: "user", label: "User", blurb: "The people who actually live with the outcome" },
  { id: "specialist", label: "Specialist", blurb: "Bespoke experts designed for this idea alone" },
];

const LENS_BY_ID: Record<RoleId, RoleLens> = ROLE_LENSES.reduce(
  (acc, lens) => {
    acc[lens.id] = lens;
    return acc;
  },
  {} as Record<RoleId, RoleLens>,
);

export function roleLens(id: RoleId): RoleLens {
  return LENS_BY_ID[id];
}

/** Built-in roster keys → lens. Mirrors PERSONAS in backend/agents/personas.py. */
const BUILTIN_ROLE: Record<string, RoleId> = {
  user: "user",
  designer: "user",
  marketer: "user",
  operator: "admin",
  engineer: "admin",
  regulator: "authority",
  impact: "authority",
  critic: "investigator",
  researcher: "investigator",
  investor: "reviewer",
  economist: "reviewer",
  strategist: "reviewer",
};

/** Keyword probes for bespoke experts, in the same precedence as ROLE_LENSES. */
const ROLE_KEYWORDS: [RoleId, string[]][] = [
  // "health" is deliberately absent: a public health officer is an authority,
  // not a clinician, and would otherwise be captured here first.
  ["hospital", ["hospital", "clinic", "clinician", "patient", "nurse", "doctor", "physician", "medical", "surgeon", "pharma", "triage", "inpatient"]],
  ["authority", ["regulat", "complian", "legal", "lawyer", "counsel", "policy", "govern", "municipal", "audit", "ethic", "privacy", "licens", "inspector", "ombuds"]],
  ["investigator", ["critic", "adversar", "red team", "skeptic", "fraud", "investigat", "forensic", "research", "scientist", "statistic", "evidence"]],
  ["reviewer", ["invest", "capital", "venture", "cfo", "financ", "econom", "strateg", "board", "analyst", "underwrit", "procure", "budget"]],
  ["admin", ["operat", "logistic", "supply", "engineer", "architect", "admin", "warden", "manager", "technic", "devops", "infrastructur", "vendor", "staff"]],
  ["user", ["user", "customer", "consumer", "student", "resident", "parent", "citizen", "rider", "driver", "tenant", "design", "ux", "market", "growth", "community", "worker"]],
];

/** Which lens an expert answers to. Never returns undefined — "specialist" catches the rest. */
export function personaRole(persona: { key: string; role: string; name: string }): RoleId {
  const builtin = BUILTIN_ROLE[persona.key];
  if (builtin) return builtin;

  const haystack = `${persona.name} ${persona.role}`.toLowerCase();
  for (const [id, keywords] of ROLE_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return id;
  }
  return "specialist";
}

/* ─── Verdict status ─── */

export type StatusId = "favour" | "mixed" | "against" | "unreachable";

export interface StatusFilter {
  id: StatusId;
  label: string;
}

export const STATUS_FILTERS: StatusFilter[] = [
  { id: "favour", label: "In favour" },
  { id: "mixed", label: "Mixed" },
  { id: "against", label: "Against" },
  { id: "unreachable", label: "Unreachable" },
];

/**
 * Collapse the two verdict vocabularies the system produces — an expert's
 * Bullish/Cautious/Bearish and the board's Go/Caution/No-Go — onto one axis.
 */
export function verdictStatus(verdict: string | undefined, failed = false): StatusId {
  if (failed) return "unreachable";
  const v = (verdict ?? "").toLowerCase();
  if (v === "bullish" || v === "go") return "favour";
  if (v === "bearish" || v === "no-go" || v === "nogo") return "against";
  return "mixed";
}

export function personaStatus(persona: PersonaResult): StatusId {
  return verdictStatus(persona.analysis?.verdict, persona.analysis?._failed === true);
}

export function synthesisStatus(synthesis: Synthesis | undefined): StatusId {
  if (!synthesis || synthesis.panel_unreachable) return "unreachable";
  return verdictStatus(synthesis.verdict);
}

/* ─── Tallying ─── */

/** How many experts sit behind each lens. Keys with no experts are omitted. */
export function tallyRoles(personas: { key: string; role: string; name: string }[]): Map<RoleId, number> {
  const counts = new Map<RoleId, number>();
  for (const persona of personas) {
    const id = personaRole(persona);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The lenses actually represented on a panel, in canonical order. */
export function presentLenses(counts: Map<RoleId, number>): RoleLens[] {
  return ROLE_LENSES.filter((lens) => (counts.get(lens.id) ?? 0) > 0);
}
