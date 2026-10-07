import type { BriefSnapshot } from "./brief";
import { deleteNotes, getNote, setNote } from "./notes";
import type { EvalResult } from "./types";
import { normalizeHistoryEntries } from "./validate";

const KEY = "decisionx.history.v1";
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  idea: string;
  verdict: string;
  /** 1–10, or null when the run produced no readable score. */
  score: number | null;
  panelSize: number;
  domains: string[];
  attachmentCount: number;
  result: EvalResult;
  brief?: BriefSnapshot;
}

const listeners = new Set<() => void>();

const EMPTY: HistoryEntry[] = [];
let cache: HistoryEntry[] | null = null;

/* ─── Storage notices ───
   Quota trouble is surfaced to the reader instead of being swallowed: either
   older entries were dropped to make room, or nothing could be written at all. */

export interface HistoryNotice {
  kind: "trimmed" | "unsaved";
  message: string;
}

let notice: HistoryNotice | null = null;
const noticeListeners = new Set<() => void>();

function setNotice(next: HistoryNotice | null) {
  notice = next;
  noticeListeners.forEach((l) => l());
}

export function getHistoryNotice(): HistoryNotice | null {
  return notice;
}

export function getHistoryNoticeServerSnapshot(): HistoryNotice | null {
  return null;
}

export function subscribeHistoryNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

export function dismissHistoryNotice() {
  setNotice(null);
}

/* ─── Store ─── */

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cache = Array.isArray(parsed) ? normalizeHistoryEntries(parsed) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
}

interface WriteOutcome {
  /** The entries now in history, newest first. */
  kept: HistoryEntry[];
  /** False when storage refused even a single entry; `kept` then lives in memory only. */
  persisted: boolean;
}

/**
 * Persist `entries` (newest first). On a quota failure the oldest entries are
 * trimmed until the rest fit. If not even one entry fits, whatever was stored
 * before is left untouched — a full disk never wipes history.
 */
function write(entries: HistoryEntry[]): WriteOutcome {
  const previous = read();
  const capped = entries.slice(0, MAX_ENTRIES);
  if (typeof window === "undefined") return { kept: capped, persisted: false };

  let candidate = capped;
  let stored = false;
  if (candidate.length === 0) {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    stored = true;
  } else {
    while (!stored) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(candidate));
        stored = true;
      } catch {
        if (candidate.length === 1) break;
        candidate = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.75)));
      }
    }
  }

  if (!stored) {
    // Keep the change for this session so the app stays coherent, but leave
    // the stored copy exactly as it was.
    cache = capped;
    setNotice({
      kind: "unsaved",
      message:
        "Browser storage is full, so the latest change to your history could not be saved. It will be lost when this page is reloaded.",
    });
    emit();
    return { kept: capped, persisted: false };
  }

  const trimmed = capped.length - candidate.length;
  if (trimmed > 0) {
    setNotice({
      kind: "trimmed",
      message: `Older history entries were removed to free space (${trimmed} removed).`,
    });
  }

  // Notes belong to their evaluation; drop the ones whose evaluation is gone.
  const keptIds = new Set(candidate.map((e) => e.id));
  deleteNotes(previous.concat(entries).map((e) => e.id).filter((id) => !keptIds.has(id)));

  cache = candidate.length ? candidate : EMPTY;
  emit();
  return { kept: cache, persisted: true };
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

export function saveEvaluation(
  result: EvalResult,
  brief?: BriefSnapshot,
): { entry: HistoryEntry; persisted: boolean } {
  const entry: HistoryEntry = {
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    idea: result.idea,
    verdict: result.synthesis?.verdict ?? "Caution",
    score: result.synthesis?.overall_score ?? null,
    panelSize: result.personas?.length ?? 0,
    domains: result.detected_domains ?? [],
    attachmentCount: result.attachments?.filter((a) => a.included).length ?? 0,
    result,
    brief,
  };
  const { persisted } = write([entry, ...read()]);
  return { entry, persisted };
}

/**
 * Merge records from outside (sample files, imports). Incoming data is
 * validated first. Returns how many new records are actually in history
 * afterwards — after the cap and any quota trimming — not how many were offered.
 */
export function importEntries(incoming: unknown[]): number {
  const existing = read();
  const known = new Set(existing.map((e) => e.id));
  const fresh = normalizeHistoryEntries(incoming).filter((e) => !known.has(e.id));
  if (fresh.length === 0) return 0;
  const { kept } = write([...fresh, ...existing].sort((a, b) => b.createdAt - a.createdAt));
  const keptIds = new Set(kept.map((e) => e.id));
  return fresh.filter((e) => keptIds.has(e.id)).length;
}

/** What a deletion removed, so it can be undone. */
export interface RemovedEntry {
  entry: HistoryEntry;
  note: string;
}

/** Delete one record and its notes. Returns what was removed, for undo. */
export function deleteEntry(id: string): RemovedEntry | null {
  const current = read();
  const entry = current.find((e) => e.id === id);
  if (!entry) return null;
  const note = getNote(id);
  write(current.filter((e) => e.id !== id));
  return { entry, note };
}

/** Put back a record removed by `deleteEntry`, with its note. */
export function restoreEntry(removed: RemovedEntry) {
  const current = read();
  if (current.some((e) => e.id === removed.entry.id)) return;
  const { kept, persisted } = write(
    [removed.entry, ...current].sort((a, b) => b.createdAt - a.createdAt),
  );
  if (persisted && removed.note && kept.some((e) => e.id === removed.entry.id)) {
    setNote(removed.entry.id, removed.note);
  }
}

export function clearHistory() {
  write([]);
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
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
