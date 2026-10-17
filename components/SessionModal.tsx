"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { TrackerId } from "@/lib/types";
import { TRACKERS, TRACKER_IDS } from "@/lib/velo";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Single-athlete session entry, in a pop-up.
 *
 * Two steps: first pick what kind of session this is (mound or pull-down),
 * then the weight grid for that tracker. Keeps the profile page clean —
 * nothing about entering data is on the page until you ask for it.
 *
 * Closing from the entry step (the X, a click outside, Escape) asks first, so
 * an accidental tap cannot throw away a screen of half-typed numbers. The pick
 * step is exempt: nothing has been entered yet. `onClose` still means "really
 * close"; the question is internal.
 *
 * `overlay` is for a second confirm the caller owns (the save summary). It is
 * rendered as a sibling AFTER the backdrop, never inside it, and while it is
 * up this pop-up's Escape does nothing, so one key press cannot dismiss it and
 * also open the leave prompt.
 */
export default function SessionModal({
  step,
  athleteName,
  tracker,
  onPick,
  onBack,
  onClose,
  overlay,
  children,
}: {
  step: "pick" | "entry";
  athleteName: string;
  tracker: TrackerId;
  onPick: (t: TrackerId) => void;
  onBack: () => void;
  onClose: () => void;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const confirmOpen = leaving || !!overlay;
  /** Entering nothing yet (the pick step) closes at once; anything else asks. */
  const requestClose = () => (step === "pick" ? onClose() : setLeaving(true));

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmOpen) return;
      if (step === "pick") onClose();
      else setLeaving(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, confirmOpen, onClose]);

  return (
    <>
      <div className="modal-backdrop" onClick={requestClose}>
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
            <button
              className="modal-x"
              onClick={requestClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {step === "pick" ? (
            <div className="type-pick">
              <p className="type-pick-q">What are we tracking today?</p>
              {TRACKER_IDS.map((t) => {
                const cfg = TRACKERS[t];
                return (
                  <button
                    key={t}
                    className="type-card"
                    onClick={() => onPick(t)}
                  >
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
      {leaving && (
        <ConfirmDialog
          title="Leave this session?"
          confirmLabel="Leave"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setLeaving(false);
            onClose();
          }}
          onCancel={() => setLeaving(false)}
        >
          <p>
            Your numbers are kept as a draft, so they&apos;ll be here when you
            come back.
          </p>
        </ConfirmDialog>
      )}
      {overlay}
    </>
  );
}
