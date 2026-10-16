"use client";

import { useEffect } from "react";
import type { DeliveryScreen } from "@/lib/types";
import DeliveryForm from "./DeliveryForm";

/*
 * The modal around the Pitching Inhibitors form. The form itself lives in
 * DeliveryForm so the group test screen can show several at once; this frame
 * keeps the one-athlete flow exactly as it was: same props, same chrome, same
 * Escape and scroll-lock behaviour.
 */
export default function DeliveryModal({
  athleteId,
  date,
  initial,
  takenDates,
  onClose,
  onSaved,
}: {
  athleteId: string;
  /** The date this opens on — today's, unless editing an existing assessment. */
  date: string;
  initial: DeliveryScreen | null;
  /** Dates that already hold an assessment, so a new one can warn before it lands on one. */
  takenDates: string[];
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
        aria-label="Pitching inhibitors"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Pitching Inhibitors</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <DeliveryForm
          athleteId={athleteId}
          date={date}
          initial={initial}
          takenDates={takenDates}
          onSaved={onSaved}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
