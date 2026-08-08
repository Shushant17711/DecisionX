/**
 * The brief — everything captured about an idea before the panel is convened,
 * and the readiness checklist computed from it.
 *
 * A panel is only as good as what it was given. Rather than let a one-line idea
 * silently produce a confident-looking verdict, the brief names the sections a
 * complete submission has, shows which are still open, and travels with the
 * evaluation into history and the exported report.
 *
 * The draft is persisted so a half-written brief survives a reload. Attached
 * files cannot be serialised, so only their names are remembered — the checklist
 * treats the live File list as the source of truth and the stored names as a hint
 * about what was there before.
 */

const DRAFT_KEY = "decisionx.brief.v1";

export interface BriefDraft {
  idea: string;
  context: string;
  criteria: string;
  constraints: string;
  panelSize: number;
  /** Names only — a restored draft cannot re-attach the files themselves. */
  sourceNames: string[];
  updatedAt: number;
}

/** What is stored on a finished evaluation, so a report can quote its inputs. */
export interface BriefSnapshot {
  context: string;
  criteria: string;
  constraints: string;
  sourceNames: string[];
  /** Checklist completion at the moment the panel was convened. */
  completed: number;
  total: number;
  requiredMet: boolean;
}

export const EMPTY_DRAFT: BriefDraft = {
  idea: "",
  context: "",
  criteria: "",
  constraints: "",
  panelSize: 5,
  sourceNames: [],
  updatedAt: 0,
};

/* ─── Checklist ─── */

export type BriefField = "idea" | "context" | "criteria" | "constraints" | "sources";

export interface ChecklistItem {
  field: BriefField;
  label: string;
  /** Why this section changes the quality of the verdict. */
  hint: string;
  required: boolean;
  complete: boolean;
  /** Progress toward the minimum, 0–1. Drives the per-item meter. */
  fill: number;
}

interface TextRule {
  field: Exclude<BriefField, "sources">;
  label: string;
  hint: string;
  required: boolean;
  minChars: number;
}

const TEXT_RULES: TextRule[] = [
  {
    field: "idea",
    label: "Idea statement",
    hint: "What is being decided, in enough detail that an expert can argue with it.",
    required: true,
    minChars: 40,
  },
  {
    field: "context",
    label: "Decision context",
    hint: "Stage, budget, timeline, what has already been tried.",
    required: true,
    minChars: 25,
  },
  {
    field: "criteria",
    label: "Success criteria",
    hint: "The bar this has to clear. Without it every expert invents their own.",
    required: true,
    minChars: 15,
  },
  {
    field: "constraints",
    label: "Constraints",
    hint: "What cannot change — budget ceiling, regulation, headcount, deadline.",
    required: false,
    minChars: 15,
  },
];

export function buildChecklist(draft: BriefDraft, sourceCount: number): ChecklistItem[] {
  const items: ChecklistItem[] = TEXT_RULES.map((rule) => {
    const length = draft[rule.field].trim().length;
    return {
      field: rule.field,
      label: rule.label,
      hint: rule.hint,
      required: rule.required,
      complete: length >= rule.minChars,
      fill: Math.min(1, length / rule.minChars),
    };
  });

  items.push({
    field: "sources",
    label: "Supporting sources",
    hint: "Numbers, transcripts or research the panel should read rather than guess.",
    required: false,
    complete: sourceCount > 0,
    fill: sourceCount > 0 ? 1 : 0,
  });

  return items;
}

export interface ChecklistSummary {
  items: ChecklistItem[];
  completed: number;
  total: number;
  /** Required sections still open, by label — what the warning names. */
  missingRequired: string[];
  requiredMet: boolean;
}

export function summarise(items: ChecklistItem[]): ChecklistSummary {
  const missingRequired = items.filter((i) => i.required && !i.complete).map((i) => i.label);
  return {
    items,
    completed: items.filter((i) => i.complete).length,
    total: items.length,
    missingRequired,
    requiredMet: missingRequired.length === 0,
  };
}

export function snapshot(draft: BriefDraft, summary: ChecklistSummary, sourceNames: string[]): BriefSnapshot {
  return {
    context: draft.context.trim(),
    criteria: draft.criteria.trim(),
    constraints: draft.constraints.trim(),
    sourceNames,
    completed: summary.completed,
    total: summary.total,
    requiredMet: summary.requiredMet,
  };
}

/**
 * Fold the brief's own sections into the context string the backend receives, so
 * the criteria and constraints reach every expert instead of only the report.
 */
export function composeContext(draft: BriefDraft): string {
  const parts: string[] = [];
  if (draft.context.trim()) parts.push(draft.context.trim());
  if (draft.criteria.trim()) parts.push(`Success criteria:\n${draft.criteria.trim()}`);
  if (draft.constraints.trim()) parts.push(`Hard constraints:\n${draft.constraints.trim()}`);
  return parts.join("\n\n");
}

/* ─── Persistence ─── */

export function loadDraft(): BriefDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<BriefDraft>;
    return {
      idea: typeof parsed.idea === "string" ? parsed.idea : "",
      context: typeof parsed.context === "string" ? parsed.context : "",
      criteria: typeof parsed.criteria === "string" ? parsed.criteria : "",
      constraints: typeof parsed.constraints === "string" ? parsed.constraints : "",
      panelSize: typeof parsed.panelSize === "number" ? parsed.panelSize : 5,
      sourceNames: Array.isArray(parsed.sourceNames) ? parsed.sourceNames.map(String) : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: BriefDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    /* A brief too large for the quota is not worth failing the page over. */
  }
}

export function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/* ─── Draft store ───
   The draft lives outside React, like history and the live evaluation do, so the
   form can read the stored brief on its first client render without a hydration
   mismatch and without a setState-in-effect cascade. Writes are debounced: a
   brief is typed into, and localStorage does not need every keystroke. */

const listeners = new Set<() => void>();
let cache: BriefDraft | null = null;
let writeHandle: number | null = null;

export function getDraft(): BriefDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  if (!cache) cache = loadDraft();
  return cache;
}

/** Server render has no localStorage, so it always starts from empty. */
export function getDraftServerSnapshot(): BriefDraft {
  return EMPTY_DRAFT;
}

export function subscribeDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: BriefDraft) {
  cache = next;
  listeners.forEach((l) => l());

  if (typeof window === "undefined") return;
  if (writeHandle != null) window.clearTimeout(writeHandle);
  writeHandle = window.setTimeout(() => {
    writeHandle = null;
    saveDraft(next);
  }, 400);
}

export function updateDraft(patch: Partial<BriefDraft>) {
  commit({ ...getDraft(), ...patch });
}

export function replaceDraft(next: BriefDraft) {
  commit(next);
}

/* ─── The worked example ─── */

const SAMPLE_CSV = `month,subscribers,meals_served,gross_revenue_inr,food_cost_inr,delivery_cost_inr
2025-07,84,7392,443520,231000,68400
2025-08,131,11528,691680,357000,101200
2025-09,168,14784,887040,449000,132800
2025-10,204,17952,1077120,538000,168300
2025-11,229,20152,1209120,601000,193600
`;

/**
 * A fully completed brief, used by "Load a worked example" — every checklist
 * section satisfied, including a real attachment built in the browser so the
 * sources row is genuinely met rather than faked.
 */
export const SAMPLE_BRIEF: Omit<BriefDraft, "updatedAt" | "sourceNames"> = {
  idea: "A tiffin subscription for college students in Pune — home-style meals on monthly plans, with delivery routes decided by a demand model rather than a fixed weekly menu. Two central kitchens, hostel-gate handover, and a pause-anytime plan for students who travel home.",
  context:
    "Five months live in two hostel clusters. 229 active subscribers, ₹12.1L gross in November, run by two founders and four kitchen staff. ₹18L of runway left and no outside funding yet. We have already tried a fixed weekly menu and churned 30% of subscribers in month two.",
  criteria:
    "Hold contribution margin above 22% per meal while reaching 600 subscribers within nine months, with monthly churn under 8% and no food-safety incident.",
  constraints:
    "FSSAI licensing on both kitchens, a ₹40 ceiling on food cost per meal, no more than six staff before Series A, and delivery confined to a 6 km radius of each kitchen.",
  panelSize: 8,
};

export function sampleSourceFile(): File {
  return new File([SAMPLE_CSV], "unit-economics.csv", { type: "text/csv" });
}
