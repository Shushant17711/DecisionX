"use client";

/**
 * Export menu — one button, three formats.
 *
 * CSV and HTML are generated in the browser from the stored evaluation and handed
 * straight to the download; PDF is delegated to the caller, because the honest way
 * to produce one is to print the report page itself rather than to re-typeset it
 * with a bundled PDF library.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon, type IconName } from "./Icon";
import type { HistoryEntry } from "@/lib/history";
import { buildReportCsv, buildReportHtml, downloadFile, reportFilename } from "@/lib/report";

type Choice = { id: "pdf" | "csv" | "html"; label: string; detail: string; icon: IconName };

const CHOICES: Choice[] = [
  { id: "pdf", label: "PDF", detail: "Print-ready, via your browser", icon: "file" },
  { id: "csv", label: "CSV", detail: "Every field as one flat table", icon: "grid" },
  { id: "html", label: "HTML", detail: "Self-contained page, works offline", icon: "terminal" },
];

export function DownloadMenu({
  entry,
  note = "",
  onPdf,
  align = "right",
}: {
  entry: HistoryEntry;
  note?: string;
  /** Print the report. The caller owns it: the printable surface is the report page. */
  onPdf: () => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    firstItemRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const run = (id: Choice["id"]) => {
    close(true);
    if (id === "pdf") {
      onPdf();
      return;
    }
    if (id === "csv") {
      downloadFile(reportFilename(entry, "csv"), "csv", buildReportCsv(entry, note));
      return;
    }
    downloadFile(reportFilename(entry, "html"), "html", buildReportHtml(entry, note));
  };

  return (
    <div ref={rootRef} className="relative print:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="btn-quiet flex items-center gap-2 px-3 py-1.5 text-[0.8125rem]"
      >
        <Icon name="download" size={15} />
        <span>Download</span>
        <Icon
          name="chevronDown"
          size={13}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.16s var(--ease-out)",
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Download format"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="panel-raised absolute z-40 mt-1.5 w-[15.5rem] origin-top overflow-hidden p-1"
            style={align === "right" ? { right: 0 } : { left: 0 }}
          >
            {CHOICES.map((choice, i) => (
              <button
                key={choice.id}
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                role="menuitem"
                onClick={() => run(choice.id)}
                className="flex w-full items-start gap-2.5 rounded-[2px] px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
              >
                <Icon name={choice.icon} size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] text-[var(--foreground)]">{choice.label}</span>
                  <span className="block text-[0.75rem] leading-snug text-[var(--text-muted)]">
                    {choice.detail}
                  </span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
