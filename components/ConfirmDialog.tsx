"use client";

import { useEffect, useRef, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * A small "are you sure?" box that sits on top of another pop-up
 *
 * The safe choice is the focused one: the cancel button gets focus when this
 * opens, so Enter or a stray tap on the spot where a button just appeared can
 * only ever dismiss the prompt, never go through with it.
 *
 * RENDER IT AS A SIBLING of the pop-up's own `.modal-backdrop`, never inside
 * it. React events bubble through the React tree, not the DOM, so a prompt
 * rendered inside the pop-up's backdrop would hand its clicks to that
 * backdrop's onClick, which is the very handler that opens this prompt.
 *
 * Escape is handled here, and the pop-up underneath must ignore Escape while
 * this is open (see SessionModal and GroupEntryModal).
 * ------------------------------------------------------------------ */

export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Keep editing",
  onConfirm,
  onCancel,
  busy = false,
  destructive = false,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** A save is in flight: both buttons are disabled and nothing can dismiss it. */
  busy?: boolean;
  destructive?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      // Put focus back where the coach was, unless that element is gone.
      if (before && before.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
        </div>
        <div className="type-pick">
          {children && <div className="confirm-body">{children}</div>}
          <div className="row-actions">
            <button
              className={`btn ${destructive ? "danger" : "primary"}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {confirmLabel}
            </button>
            <button
              ref={cancelRef}
              className="btn ghost"
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
