"use client";

import { useEffect, type ReactNode } from "react";
import type { TrackerId } from "@/lib/types";
import { TRACKERS, TRACKER_IDS } from "@/lib/velo";

/**
 * Single-athlete session entry, in a pop-up.
 *
 * Two steps: first pick what kind of session this is (mound or pull-down),
 * then the weight grid for that tracker. Keeps the profile page clean —
 * nothing about entering data is on the page until you ask for it.
 */
export default function SessionModal({
  step,
  athleteName,
  tracker,
  onPick,
  onBack,
  onClose,
  children,
}: {
  step: "pick" | "entry";
  athleteName: string;
  tracker: TrackerId;
  onPick: (t: TrackerId) => void;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
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
        className={`modal-panel${step === "pick" ? " narrow" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Track a new session for ${athleteName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          {step === "entry" && (
            <button className="modal-back" onClick={onBack}>
              ←
            </button>
          )}
          <span className="modal-title">
            {step === "pick"
              ? "New session"
              : `${TRACKERS[tracker].label} session`}
          </span>
          <span className="modal-sub">{athleteName}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {step === "pick" ? (
          <div className="type-pick">
            <p className="type-pick-q">What are we tracking today?</p>
            {TRACKER_IDS.map((t) => {
              const cfg = TRACKERS[t];
              return (
                <button key={t} className="type-card" onClick={() => onPick(t)}>
                  <span className="tc-name">{cfg.label}</span>
                  <span className="tc-tag">{cfg.tag}</span>
                  <span className="tc-weights">
                    {cfg.slots.map((s) => s.oz).join(" · ")} oz
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="modal-body">{children}</div>
        )}
      </div>
    </div>
  );
}
