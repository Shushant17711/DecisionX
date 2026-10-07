import { clearDraft, type BriefSnapshot } from "./brief";
import { getEntry, saveEvaluation } from "./history";
import type { Attachment, EvalResult, Expert, PersonaResult, StreamEvent } from "./types";
import { parseStreamEvent } from "./validate";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8001")
  .trim()
  .replace(/\/+$/, "");

/** Abort a run that has sent nothing at all for this long. */
const IDLE_TIMEOUT_MS = 90_000;

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

export async function startEvaluation({ idea, context, panelSize, files, brief }: EvaluationRequest) {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  declinedHistoryId = null;

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

class StreamIdleError extends Error {
  constructor() {
    super(
      `The backend sent nothing for ${Math.round(IDLE_TIMEOUT_MS / 1000)} seconds, so the evaluation was stopped. Please try again.`,
    );
    this.name = "StreamIdleError";
  }
}

/** Pull a readable message out of an error body — FastAPI's `detail` in any of its shapes. */
function errorDetail(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const detail = record.detail ?? record.message ?? record.error;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) =>
        d && typeof d === "object" && typeof (d as Record<string, unknown>).msg === "string"
          ? String((d as Record<string, unknown>).msg)
          : JSON.stringify(d),
      )
      .join("; ");
  }
  return detail != null ? JSON.stringify(detail) : "";
}

async function httpErrorMessage(res: Response): Promise<string> {
  if (res.ok) return "The backend answered without a response stream. Please try again.";
  let detail = "";
  try {
    const text = await res.text();
    try {
      detail = errorDetail(JSON.parse(text) as unknown);
    } catch {
      detail = text.trim().slice(0, 300);
    }
  } catch {
    /* No readable body — the status alone will have to do. */
  }
  const status = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  return detail
    ? `The backend rejected the request (${status}): ${detail}`
    : `The backend rejected the request (${status}).`;
}

function fail(message: string) {
  set({ status: "error", error: message });
}

async function run(form: FormData, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/evaluate/stream`, {
      method: "POST",
      body: form,
      signal,
    });
  } catch {
    // fetch only rejects (rather than resolving with a status) on network
    // failure, CORS refusal, or abort.
    if (signal.aborted) return;
    fail(`Could not reach the backend at ${API_BASE} — is it running and is this origin allowed?`);
    return;
  }

  if (!res.ok || !res.body) {
    const message = await httpErrorMessage(res);
    if (!signal.aborted) fail(message);
    return;
  }

  try {
    for await (const event of readNdjson(res.body, signal)) {
      if (signal.aborted) return;
      applyEvent(event);
      // `done` and `error` are terminal; stop reading (the reader is cancelled).
      if (state.status !== "running") break;
    }

    if (signal.aborted) return;
    if (state.status === "running") {
      fail("The evaluation stream ended unexpectedly. Please try again.");
    }
  } catch (e) {
    if (signal.aborted) return;
    if (e instanceof StreamIdleError) {
      fail(e.message);
    } else if (e instanceof TypeError) {
      fail(`The connection to the backend at ${API_BASE} was lost mid-evaluation. Please try again.`);
    } else {
      fail(e instanceof Error && e.message ? e.message : "Something went wrong");
    }
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
      set({
        personas: [...state.personas.filter((p) => p.key !== event.persona.key), event.persona],
      });
      break;
    case "done": {
      const { entry } = saveEvaluation(event.result, state.brief ?? undefined);
      // The brief has done its job; the next visit to the form starts clean.
      clearDraft();
      set({
        status: "done",
        stage: "complete",
        result: event.result,
        personas: event.result.personas,
        attachments: event.result.attachments ?? state.attachments,
        historyId: entry.id,
      });
      break;
    }
    case "error":
      fail(event.message || "The evaluation failed on the backend.");
      break;
  }
}

/** Parse one NDJSON line. Malformed or unrecognised lines are skipped, not fatal. */
function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    console.warn("[DecisionX] Skipping malformed stream line:", trimmed.slice(0, 200));
    return null;
  }
  const event = parseStreamEvent(raw);
  if (!event) console.warn("[DecisionX] Skipping unrecognised stream event:", raw);
  return event;
}

function readWithTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new StreamIdleError()), ms);
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(handle));
}

async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    while (!signal.aborted) {
      const { done, value } = await readWithTimeout(reader.read(), IDLE_TIMEOUT_MS);
      if (done) {
        finished = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
    }

    if (finished) {
      // Flush any bytes the decoder held back, then the final unterminated line.
      buffer += decoder.decode();
      for (const line of buffer.split("\n")) {
        const event = parseLine(line);
        if (event) yield event;
      }
      buffer = "";
    }
  } finally {
    if (!finished) {
      // Ended early — error, idle timeout, abort, or the consumer stopped
      // reading. Cancel so the connection is released rather than left open.
      reader.cancel().catch(() => {});
    }
    try {
      reader.releaseLock();
    } catch {
      /* A read may still be settling after cancel; the stream is closed either way. */
    }
  }
}

/* ─── Opening a past evaluation ─── */

const ABANDON_PROMPT =
  "An evaluation is still running. Stop it and open this past evaluation instead?";

/** Remembers a "no" so a re-run effect (StrictMode) does not ask twice. */
let declinedHistoryId: string | null = null;

export function isEvaluationRunning(): boolean {
  return state.status === "running";
}

/**
 * Ask before abandoning a live run. True when nothing is running or the reader
 * agreed to stop it.
 */
export function confirmAbandonRun(): boolean {
  if (state.status !== "running") return true;
  if (typeof window === "undefined") return false;
  return window.confirm(ABANDON_PROMPT);
}

/**
 * Show a stored evaluation. If a run is live, the reader is asked first unless
 * `confirmed` says they already were. Returns false when the live run was kept
 * and nothing was loaded.
 */
export function loadFromHistory(id: string, options: { confirmed?: boolean } = {}): boolean {
  if (state.historyId === id && state.status === "done") return true;

  if (state.status === "running" && !options.confirmed) {
    if (declinedHistoryId === id) return false;
    if (!confirmAbandonRun()) {
      declinedHistoryId = id;
      return false;
    }
  }
  declinedHistoryId = null;

  const entry = getEntry(id);
  if (!entry) {
    controller?.abort();
    controller = null;
    state = { ...IDLE, status: "missing" };
    listeners.forEach((l) => l());
    return true;
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
  return true;
}
