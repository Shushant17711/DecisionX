const KEY = "decisionx.notes.v1";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, text] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof text === "string") out[id] = text;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, string>) {
  try {
    if (Object.keys(all).length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Notes are a convenience; a full quota must not break the report. */
  }
}

export function getNote(id: string): string {
  return readAll()[id] ?? "";
}

export function setNote(id: string, text: string) {
  if (typeof window === "undefined") return;
  const all = readAll();
  if (text.trim()) all[id] = text;
  else delete all[id];
  writeAll(all);
}

/** Drop the notes attached to evaluations that no longer exist. */
export function deleteNotes(ids: string[]) {
  if (typeof window === "undefined" || ids.length === 0) return;
  const all = readAll();
  let changed = false;
  for (const id of ids) {
    if (id in all) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

export function deleteNote(id: string) {
  deleteNotes([id]);
}
