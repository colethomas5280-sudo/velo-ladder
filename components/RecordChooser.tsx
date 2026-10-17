"use client";

import { useEffect } from "react";

/* ------------------------------------------------------------------ *
 * The fork before "Record a screen" opens anything
 *
 * A movement screen and a Pitching Inhibitors assessment are two separate
 * records now, so the button that used to open the physical screen directly
 * has to ask which one first. An athlete with neither assessment on file
 * still sees this same chooser rather than a different flow depending on
 * what's already recorded.
 * ------------------------------------------------------------------ */

export default function RecordChooser({
  title = "Record a screen",
  onPick,
  onClose,
}: {
  title?: string;
  onPick: (kind: "screen" | "delivery") => void;
  onClose: () => void;
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
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title === "Record a screen" ? "Record an assessment" : title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="type-pick">
          <p className="type-pick-q">What are we recording?</p>
          <button className="type-card" onClick={() => onPick("screen")}>
            <span className="tc-name">Movement screen</span>
            <span className="tc-tag">The sixteen physical tests.</span>
          </button>
          <button className="type-card" onClick={() => onPick("delivery")}>
            <span className="tc-name">Pitching Inhibitors</span>
            <span className="tc-tag">
              The twelve things you watch for in the delivery.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
