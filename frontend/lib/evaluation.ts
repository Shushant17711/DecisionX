// Module-level singleton store for live evaluation state.

import type { BriefSnapshot } from "./brief";
import { getEntry, saveEvaluation } from "./history";
import type { Attachment, EvalResult, Expert, PersonaResult, StreamEvent } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8001";

export type EvalStage = "idle" | "assembling" | "evaluating" | "synthesizing" | "complete";

export interface EvalState {
  status: "idle" | "running" | "done" | "error" | "missing";
  stage: EvalStage;
  idea: string;
  panelSize: number;
  domains: string[];
  experts: Expert[];
  personas: PersonaResult[];
  attachments: Attachment[];
  result: EvalResult | null;
  historyId: string | null;
  error: string | null;
  startedAt: number;
  /** The brief this run was given, carried through so it lands in history. */
  brief: BriefSnapshot | null;
}

const IDLE: EvalState = {
  status: "idle",
  stage: "idle",
  idea: "",
  panelSize: 0,
  domains: [],
  experts: [],
  personas: [],
  attachments: [],
  result: null,
  historyId: null,
  error: null,
  startedAt: 0,
  brief: null,
};

let state: EvalState = IDLE;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<EvalState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): EvalState {
  return state;
}

export function getServerSnapshot(): EvalState {
  return IDLE;
}

export function resetEvaluation() {
  controller?.abort();
  controller = null;
  state = IDLE;
  listeners.forEach((l) => l());
}

export interface EvaluationRequest {
  idea: string;
  context: string;
  panelSize: number;
  files: File[];
  brief?: BriefSnapshot;
}

// Kick off a streamed evaluation.
export function startEvaluation({ idea, context, panelSize, files, brief }: EvaluationRequest) {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;

  state = {
    ...IDLE,
    status: "running",
    stage: "assembling",
    idea,
    panelSize,
    startedAt: Date.now(),
    brief: brief ?? null,
  };
  listeners.forEach((l) => l());

  const form = new FormData();
  form.append("idea", idea);
  if (context) form.append("context", context);
  form.append("num_personas", String(panelSize));
  files.forEach((f) => form.append("files", f));

  void run(form, signal);
}

async function run(form: FormData, signal: AbortSignal) {
  try {
    const res = await fetch(`${API_BASE}/api/evaluate/stream`, {
      method: "POST",
      body: form,
      signal,
    });

    if (!res.ok || !res.body) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.detail) detail = String(body.detail);
      } catch {
        /* non-JSON error body — keep the status message */
      }
      throw new Error(detail);
    }

    for await (const event of readNdjson(res.body, signal)) {
      applyEvent(event);
    }

    // The stream closed without a `done` event — the server died mid-run.
    if (state.status === "running") {
      set({ status: "error", error: "The evaluation stream ended unexpectedly. Please try again." });
    }
  } catch (e) {
    if (signal.aborted) return; // A new run or an explicit reset superseded this one.
    const message =
      e instanceof TypeError
        ? `Cannot reach the DecisionX API at ${API_BASE}. Is the backend running?`
        : e instanceof Error
          ? e.message
          : "Something went wrong";
    set({ status: "error", error: message });
  }
}

function applyEvent(event: StreamEvent) {
  switch (event.type) {
    case "attachments":
      set({ attachments: event.attachments });
      break;
    case "stage":
      set({ stage: event.stage === "synthesizing" ? "synthesizing" : "assembling" });
      break;
    case "panel":
      set({ stage: "evaluating", domains: event.domains, experts: event.experts });
      break;
    case "persona":
      set({ personas: [...state.personas, event.persona] });
      break;
    case "done": {
      const entry = saveEvaluation(event.result, state.brief ?? undefined);
      set({
        status: "done",
        stage: "complete",
        result: event.result,
        personas: event.result.personas,
        historyId: entry.id,
      });
      break;
    }
    case "error":
      set({ status: "error", error: event.message });
      break;
  }
}

/** Decode a newline-delimited JSON body into events as they arrive. */
async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Trailing fragment: wait for the rest.

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield JSON.parse(trimmed) as StreamEvent;
      }
    }

    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as StreamEvent;
  } finally {
    reader.releaseLock();
  }
}

// Load stored evaluation into the store.
export function loadFromHistory(historyId: string) {
  if (state.historyId === historyId && state.status === "done") return;

  const entry = getEntry(historyId);
  if (!entry) {
    controller?.abort();
    controller = null;
    state = { ...IDLE, status: "missing" };
    listeners.forEach((l) => l());
    return;
  }

  const result = entry.result;
  controller?.abort();
  controller = null;
  state = {
    ...IDLE,
    status: "done",
    stage: "complete",
    idea: result.idea,
    panelSize: result.personas?.length ?? 0,
    domains: result.detected_domains ?? [],
    experts: result.personas ?? [],
    personas: result.personas ?? [],
    attachments: result.attachments ?? [],
    result,
    historyId: entry.id,
    brief: entry.brief ?? null,
  };
  listeners.forEach((l) => l());
}
