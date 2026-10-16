"use client";

import { useEffect } from "react";
import type { MovementScreen } from "@/lib/types";
import ScreenForm from "./ScreenForm";

/*
 * The modal around the movement screen form. The form itself lives in
 * ScreenForm so the group test screen can show several at once; this frame
 * keeps the one-athlete flow exactly as it was: same props, same chrome, same
 * Escape and scroll-lock behaviour.
 */
export default function ScreenModal({
  athleteId,
  athleteName,
  initial,
  takenDates,
  onClose,
  onSaved,
}: {
  athleteId: string;
  athleteName: string;
  /** The screen this opens on, today's if one was already recorded. */
  initial: MovementScreen | null;
  /** Dates that already hold a screen, so a new one can warn before it lands on one. */
  takenDates: string[];
  /** Kept for callers still passing it; the physical screen has no coach-only section any more. */
  isCoach: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Movement screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Movement screen</span>
          <span className="modal-sub">{athleteName}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ScreenForm
          athleteId={athleteId}
          initial={initial}
          takenDates={takenDates}
          onSaved={onSaved}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
