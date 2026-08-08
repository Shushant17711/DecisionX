const KEY = "decisionx.notes.v1";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
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
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Notes are a convenience; a full quota must not break the report. */
  }
}
