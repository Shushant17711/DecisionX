import type { BriefSnapshot } from "./brief";
import type { EvalResult } from "./types";

const KEY = "decisionx.history.v1";
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  idea: string;
  verdict: string;
  score: number;
  panelSize: number;
  domains: string[];
  attachmentCount: number;
  result: EvalResult;
  brief?: BriefSnapshot;
}

const listeners = new Set<() => void>();

const EMPTY: HistoryEntry[] = [];
let cache: HistoryEntry[] | null = null;

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = Array.isArray(parsed) ? (parsed as HistoryEntry[]) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
}

function write(entries: HistoryEntry[]) {
  if (typeof window === "undefined") return;
  let candidate = entries.slice(0, MAX_ENTRIES);
  while (candidate.length > 0) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(candidate));
      break;
    } catch {
      candidate = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.75)));
      if (candidate.length === 1) {
        try {
          window.localStorage.setItem(KEY, JSON.stringify(candidate));
        } catch {
          window.localStorage.removeItem(KEY);
        }
        break;
      }
    }
  }
  cache = candidate;
  emit();
}

export function getHistory(): HistoryEntry[] {
  return read();
}

export function getHistoryServerSnapshot(): HistoryEntry[] {
  return EMPTY;
}

export function getEntry(id: string): HistoryEntry | undefined {
  return read().find((e) => e.id === id);
}

export function saveEvaluation(result: EvalResult, brief?: BriefSnapshot): HistoryEntry {
  const entry: HistoryEntry = {
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    idea: result.idea,
    verdict: result.synthesis?.verdict ?? "Caution",
    score: result.synthesis?.overall_score ?? 0,
    panelSize: result.personas?.length ?? 0,
    domains: result.detected_domains ?? [],
    attachmentCount: result.attachments?.filter((a) => a.included).length ?? 0,
    result,
    brief,
  };
  write([entry, ...read()]);
  return entry;
}

export function importEntries(incoming: HistoryEntry[]): number {
  const existing = read();
  const known = new Set(existing.map((e) => e.id));
  const fresh = incoming.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return 0;
  write([...fresh, ...existing].sort((a, b) => b.createdAt - a.createdAt));
  return fresh.length;
}

export function deleteEntry(id: string) {
  write(read().filter((e) => e.id !== id));
}

export function clearHistory() {
  write([]);
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function relativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
