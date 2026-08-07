/** Shapes returned by the DecisionX API. Mirrors backend/agents/orchestrator.py. */

export interface ChartPoint {
  label: string;
  value: number;
}

/** Attached by an expert only when its point is genuinely quantitative.
 *  Validated server-side by backend/agents/charts.py before it reaches here. */
export interface Chart {
  type: "bar" | "line" | "split";
  title: string;
  unit: string;
  note: string;
  data: ChartPoint[];
  /** True only for charts built from real panel data, not model estimates. */
  measured?: boolean;
}

export interface PersonaAnalysis {
  verdict: string;
  score: number;
  headline: string;
  strengths: string[];
  concerns: string[];
  recommendation: string;
  /** Present only when this expert chose to attach a chart. */
  chart?: Chart;
  /** Set by the backend when the provider call failed for this agent. */
  _failed?: boolean;
}

export interface Expert {
  key: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  custom: boolean;
}

export interface PersonaResult extends Expert {
  analysis: PersonaAnalysis;
}

export interface Disagreement {
  topic: string;
  /** The model sometimes returns a prose string, sometimes a per-expert map. */
  sides: string | Record<string, string>;
  resolution: string;
}

export interface Synthesis {
  overall_score: number;
  verdict: string;
  executive_summary: string;
  consensus_points: string[];
  disagreements: Disagreement[];
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  action_plan_7_days: string[];
  action_plan_30_days: string[];
  final_recommendation: string;
  consensus_percentage: number;
  agent_scores: Record<string, number>;
  failed_agents?: string[];
  /** True when no expert could be reached — the score is a fallback, not a verdict. */
  panel_unreachable?: boolean;
  /** Board-level charts the synthesizer chose to draw. Often empty. */
  charts?: Chart[];
  /** Built server-side from the panel's real scores, not estimated. */
  score_chart?: Chart;
}

export interface Attachment {
  name: string;
  bytes: number;
  included: boolean;
  truncated?: boolean;
  error?: string;
}

export interface EvalResult {
  idea: string;
  detected_domains: string[];
  selected_experts: { name: string; icon: string; role: string; color: string }[];
  personas: PersonaResult[];
  synthesis: Synthesis;
  elapsed_seconds?: number;
  attachments?: Attachment[];
}

/** One line of the NDJSON stream from POST /api/evaluate/stream. */
export type StreamEvent =
  | { type: "stage"; stage: "assembling" | "synthesizing" }
  | { type: "attachments"; attachments: Attachment[] }
  | { type: "panel"; domains: string[]; experts: Expert[] }
  | { type: "persona"; persona: PersonaResult }
  | { type: "done"; result: EvalResult }
  | { type: "error"; message: string };
