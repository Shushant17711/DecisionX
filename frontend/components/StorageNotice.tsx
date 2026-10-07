"use client";

import { useSyncExternalStore } from "react";

import { Icon } from "./Icon";
import {
  dismissHistoryNotice,
  getHistoryNotice,
  getHistoryNoticeServerSnapshot,
  subscribeHistoryNotice,
} from "@/lib/history";

/**
 * Tells the reader when browser storage pushed back on saving history — older
 * records trimmed to make room, or a change that could not be written at all.
 * The live region is always mounted so the message is announced when it appears.
 */
export function StorageNotice() {
  const notice = useSyncExternalStore(
    subscribeHistoryNotice,
    getHistoryNotice,
    getHistoryNoticeServerSnapshot,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 print:hidden"
    >
      {notice && (
        <div className="panel pointer-events-auto flex max-w-[34rem] items-start gap-3 p-4 shadow-[var(--shadow-lifted)]">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-[oklch(72%_0.15_27)]" />
          <p className="text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]">{notice.message}</p>
          <button
            type="button"
            onClick={dismissHistoryNotice}
            className="btn-quiet grid h-7 w-7 shrink-0 place-items-center"
            aria-label="Dismiss storage notice"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
