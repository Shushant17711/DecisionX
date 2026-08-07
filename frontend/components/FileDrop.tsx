"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useId, useRef, useState } from "react";

import { Icon } from "./Icon";

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ACCEPTED = [".pdf", ".csv", ".xlsx", ".xls", ".txt", ".md", ".json", ".yaml", ".yml", ".tsv"];
const ACCEPT_ATTR = ACCEPTED.join(",");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rejectionReason(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED.includes(ext)) {
    return `${file.name} — DecisionX reads PDFs, spreadsheets, and text files.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`;
  }
  return null;
}

// Attach documents. Text is appended to context for experts.
export function FileDrop({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const dragDepth = useRef(0);
  const describedBy = useId();

  const add = useCallback(
    (incoming: FileList | null) => {
      if (!incoming?.length) return;
      const problems: string[] = [];
      const accepted: File[] = [];

      for (const file of Array.from(incoming)) {
        const reason = rejectionReason(file);
        if (reason) {
          problems.push(reason);
          continue;
        }
        // Re-drops (same name and size) are ignored.
        const duplicate =
          files.some((f) => f.name === file.name && f.size === file.size) ||
          accepted.some((f) => f.name === file.name && f.size === file.size);
        if (!duplicate) accepted.push(file);
      }

      const room = MAX_FILES - files.length;
      if (accepted.length > room) {
        problems.push(`Only ${MAX_FILES} files can be attached at once.`);
      }

      setRejected(problems);
      if (accepted.length) onChange([...files, ...accepted.slice(0, Math.max(0, room))]);
    },
    [files, onChange],
  );

  const remove = (index: number) => {
    setRejected([]);
    onChange(files.filter((_, i) => i !== index));
  };

  const full = files.length >= MAX_FILES;

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!full) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!full) add(e.dataTransfer.files);
        }}
        className="relative rounded-[3px] border border-dashed p-4 transition-colors duration-150"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--border-subtle)",
          background: dragging ? "var(--accent-dim)" : "transparent",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          aria-describedby={describedBy}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = ""; // Allow re-selecting a file the user just removed
          }}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={full}
            className="btn-quiet flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="upload" size={15} />
            Attach documents
          </button>
          <p id={describedBy} className="text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
            {full
              ? `${MAX_FILES} of ${MAX_FILES} attached`
              : "PDF, CSV, Excel, or text — drop them here. The panel reads them as context."}
          </p>
        </div>

        <AnimatePresence initial={false}>
          {files.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="mt-3 space-y-1"
            >
              {files.map((file, i) => (
                <motion.li
                  key={`${file.name}-${file.size}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-2.5 rounded-[2px] bg-[var(--lacquer-deep)] px-2.5 py-1.5"
                >
                  <Icon name="file" size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="truncate text-[0.8125rem]">{file.name}</span>
                  <span className="tnum ml-auto shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${file.name}`}
                    className="shrink-0 text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--vermilion)]"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1">
          {rejected.map((message) => (
            <li
              key={message}
              className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-[oklch(72%_0.15_27)]"
            >
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
