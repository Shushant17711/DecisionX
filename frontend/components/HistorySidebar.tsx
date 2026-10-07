"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Icon } from "./Icon";
import { RoleTabs, StatusChips } from "./RoleFilter";
import { confirmAbandonRun, loadFromHistory } from "@/lib/evaluation";
import {
  clearHistory,
  deleteEntry,
  getHistory,
  getHistoryServerSnapshot,
  relativeTime,
  restoreEntry,
  subscribeHistory,
  type HistoryEntry,
  type RemovedEntry,
} from "@/lib/history";
import { personaRole, verdictStatus, type RoleId, type StatusId } from "@/lib/roles";
import { seedSamples } from "@/lib/samples";

function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(
    subscribeHistory,
    getHistory,
    getHistoryServerSnapshot,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How long the "Undo" offer stays up after a delete. */
const UNDO_MS = 6000;

function verdictClass(verdict: string) {
  const v = verdict?.toLowerCase();
  if (v === "go" || v === "bullish") return "verdict-go";
  if (v === "no-go" || v === "bearish") return "verdict-nogo";
  return "verdict-caution";
}

export function HistorySidebar({
  open,
  onClose,
  activeId,
}: {
  open: boolean;
  onClose: () => void;
  activeId?: string | null;
}) {
  return (
    <AnimatePresence>
      {open && <HistoryPanel onClose={onClose} activeId={activeId} />}
    </AnimatePresence>
  );
}

function HistoryPanel({
  onClose,
  activeId,
}: {
  onClose: () => void;
  activeId?: string | null;
}) {
  const router = useRouter();
  const entries = useHistory();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleId | "all">("all");
  const [status, setStatus] = useState<StatusId | "all">("all");
  const [seeding, setSeeding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [removed, setRemoved] = useState<RemovedEntry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const undoTimer = useRef<number | null>(null);
  const titleId = useId();

  /* Callers often pass a fresh arrow each render. Reading it through a ref keeps
     the focus effect below from re-running — and stealing focus back to the
     search field — every time the parent re-renders. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => onCloseRef.current(), []);

  /* Runs once per opening (this panel mounts when `open` turns true): move
     focus in, keep Tab inside the dialog, close on Escape, and hand focus back
     to whatever opened it when the panel goes away. */
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(
      () => (searchRef.current ?? closeRef.current ?? panelRef.current)?.focus(),
      60,
    );
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current != null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  const remove = (entry: HistoryEntry) => {
    const outcome = deleteEntry(entry.id);
    if (!outcome) return;
    setRemoved(outcome);
    if (undoTimer.current != null) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      setRemoved(null);
    }, UNDO_MS);
    // The focused delete button has just disappeared; land on Undo instead.
    window.setTimeout(() => undoRef.current?.focus(), 0);
  };

  const undo = () => {
    if (!removed) return;
    restoreEntry(removed);
    setRemoved(null);
    if (undoTimer.current != null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  /* A record is relevant to a role when any expert on its panel answered to that
     role, so "Authority" surfaces every past evaluation a compliance reader
     should care about rather than only the ones about compliance. */
  const rolesByEntry = useMemo(() => {
    const map = new Map<string, Set<RoleId>>();
    for (const entry of entries) {
      const roles = new Set<RoleId>();
      for (const persona of entry.result?.personas ?? []) roles.add(personaRole(persona));
      map.set(entry.id, roles);
    }
    return map;
  }, [entries]);

  const roleCounts = useMemo(() => {
    const counts = new Map<RoleId, number>();
    for (const roles of rolesByEntry.values()) {
      for (const id of roles) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [rolesByEntry]);

  const statusOf = useCallback(
    (entry: HistoryEntry) => verdictStatus(entry.verdict, entry.result?.synthesis?.panel_unreachable),
    [],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<StatusId, number>();
    for (const entry of entries) {
      const id = statusOf(entry);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [entries, statusOf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (role !== "all" && !rolesByEntry.get(e.id)?.has(role)) return false;
      if (status !== "all" && statusOf(e) !== status) return false;
      if (!q) return true;
      return (
        e.idea.toLowerCase().includes(q) ||
        e.verdict.toLowerCase().includes(q) ||
        e.domains.some((d) => d.toLowerCase().includes(q))
      );
    });
  }, [entries, query, role, status, rolesByEntry, statusOf]);

  const scoped = role !== "all" || status !== "all" || query.trim().length > 0;

  const loadSamples = async () => {
    setSeeding(true);
    await seedSamples();
    setSeeding(false);
  };

  const open_ = useCallback(
    (id: string) => {
      // Opening a record stops a live run, so ask first — and stay put on "no".
      if (!confirmAbandonRun()) return;
      loadFromHistory(id, { confirmed: true });
      onCloseRef.current();
      router.push(`/results?id=${id}`);
    },
    [router],
  );

  return (
    <>
      {/* Pointer-only dismiss; keyboard users have Escape and the close button. */}
      <motion.button
        key="scrim"
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={close}
        tabIndex={-1}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-[oklch(2%_0_0/0.62)] backdrop-blur-[2px]"
      />

      <motion.aside
        key="panel"
        ref={panelRef}
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed inset-y-0 left-0 z-50 flex w-[min(23rem,90vw)] flex-col border-r border-[var(--border-subtle)] bg-[var(--surface)] shadow-[var(--shadow-lifted)] focus:outline-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[0.9375rem] font-medium tracking-tight">
              History
            </h2>
            <p className="label mt-0.5">
              {entries.length === 0
                ? "Nothing yet"
                : scoped
                  ? `Showing ${filtered.length} of ${entries.length}`
                  : `${entries.length} evaluation${entries.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="btn-quiet grid h-8 w-8 place-items-center"
            aria-label="Close history"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        {entries.length > 0 && (
          <div className="border-b border-[var(--border-subtle)]">
            <div className="relative px-5 py-3">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-8 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ideas"
                className="field py-2 pl-9 text-[0.8125rem]"
              />
            </div>

            {/* Records scoped to the seat the reader is sitting in. */}
            <div className="px-5">
              <RoleTabs
                counts={roleCounts}
                total={entries.length}
                value={role}
                onChange={setRole}
                everyoneLabel="All roles"
              />
            </div>
            {statusCounts.size > 1 && (
              <div className="px-5 py-3">
                <StatusChips counts={statusCounts} value={status} onChange={setStatus} />
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {entries.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Icon
                name="clock"
                size={26}
                className="mx-auto text-[var(--text-muted)]"
                strokeWidth={1.2}
              />
              <p className="mt-4 text-[0.875rem] text-[var(--text-secondary)]">
                Evaluations you run are kept here
              </p>
              <p className="mx-auto mt-2 max-w-[24ch] text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                Stored on this device only. Nothing is uploaded.
              </p>
              <button
                onClick={loadSamples}
                disabled={seeding}
                className="btn-quiet mx-auto mt-5 flex items-center gap-2 px-3.5 py-2 text-[0.8125rem]"
              >
                <Icon name="spark" size={15} />
                {seeding ? "Loading…" : "Load sample records"}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-12 text-center text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
              No evaluation matches this filter{query.trim() ? ` and “${query.trim()}”` : ""}.
            </p>
          ) : (
            <ul>
              {filtered.map((entry) => {
                const isActive = entry.id === activeId;
                return (
                  <li
                    key={entry.id}
                    className="group relative border-b border-[var(--border-subtle)]"
                  >
                    <button
                      onClick={() => open_(entry.id)}
                      aria-current={isActive ? "true" : undefined}
                      className="w-full px-5 py-3.5 pr-[4.75rem] text-left transition-colors duration-150 hover:bg-[var(--surface-elevated)]"
                      style={
                        isActive
                          ? {
                              background: "var(--surface-elevated)",
                              boxShadow: "inset 2px 0 0 var(--accent)",
                            }
                          : undefined
                      }
                    >
                      <p className="line-clamp-2 text-[0.8125rem] leading-snug text-[var(--foreground)]">
                        {entry.idea}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`verdict ${verdictClass(entry.verdict)} px-1.5 py-0`}
                        >
                          {entry.verdict}
                        </span>
                        <span className="tnum text-[0.6875rem] text-[var(--text-muted)]">
                          {entry.score ?? "—"}/10 · {entry.panelSize} experts
                        </span>
                        <time
                          dateTime={new Date(entry.createdAt).toISOString()}
                          className="ml-auto text-[0.6875rem] text-[var(--text-muted)]"
                        >
                          {relativeTime(entry.createdAt)}
                        </time>
                      </div>
                    </button>
                    <Link
                      href={`/report?id=${entry.id}`}
                      onClick={close}
                      aria-label={`Open report: ${entry.idea.slice(0, 40)}`}
                      title="Open the full report"
                      className="absolute right-10 top-3 grid h-7 w-7 place-items-center rounded-[2px] text-[var(--text-muted)] opacity-100 transition-[opacity,color] duration-150 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[var(--accent)]"
                    >
                      <Icon name="file" size={14} />
                    </Link>
                    {/* Always visible on touch screens (no hover to reveal it), and
                        whenever the row has keyboard focus. */}
                    <button
                      type="button"
                      onClick={() => remove(entry)}
                      aria-label={`Delete evaluation: ${entry.idea.slice(0, 40)}`}
                      title="Delete — you can undo for a few seconds"
                      className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-[2px] text-[var(--text-muted)] opacity-100 transition-[opacity,color] duration-150 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[var(--vermilion)]"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Polite live region: always mounted so the undo offer is announced. */}
        <div role="status" aria-live="polite">
          {removed && (
            <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-5 py-3">
              <span className="mr-auto min-w-0 truncate text-[0.8125rem] text-[var(--text-secondary)]">
                Deleted “{removed.entry.idea.slice(0, 48)}”
              </span>
              <button
                ref={undoRef}
                type="button"
                onClick={undo}
                className="btn-quiet shrink-0 px-2.5 py-1 text-[0.75rem]"
              >
                Undo
              </button>
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <footer className="border-t border-[var(--border-subtle)] px-5 py-3">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="mr-auto text-[0.8125rem] text-[var(--text-secondary)]">
                  Delete all {entries.length}?
                </span>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="btn-quiet px-2.5 py-1 text-[0.75rem]"
                >
                  Keep
                </button>
                <button
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  className="rounded-[3px] border border-[oklch(62%_0.17_27/0.4)] bg-[var(--vermilion-dim)] px-2.5 py-1 text-[0.75rem] text-[oklch(72%_0.15_27)] transition-colors duration-150 hover:bg-[oklch(62%_0.17_27/0.22)]"
                >
                  Delete all
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="text-[0.8125rem] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--vermilion)]"
              >
                Clear history
              </button>
            )}
          </footer>
        )}
      </motion.aside>
    </>
  );
}

export function HistoryToggle({ onClick }: { onClick: () => void }) {
  const count = useHistory().length;

  return (
    <button
      onClick={onClick}
      className="btn-quiet flex items-center gap-2 px-3 py-1.5 text-[0.8125rem]"
      aria-label="Open evaluation history"
    >
      <Icon name="panel" size={15} />
      <span className="hidden sm:inline">History</span>
      {count > 0 && (
        <span className="tnum text-[0.6875rem] text-[var(--text-muted)]">
          {count}
        </span>
      )}
    </button>
  );
}
