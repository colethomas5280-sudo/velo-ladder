"use client";

import { useEffect, type ReactNode } from "react";
import { TRACKER_IDS, TRACKERS } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";

export interface Tab {
  id: string;
  name: string;
  status: "saved" | "data" | "empty";
}

export default function GroupEntryModal({
  tabs,
  activeId,
  onPick,
  onClose,
  tracker,
  setTracker,
  children,
}: {
  tabs: Tab[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  tracker: TrackerId;
  setTracker: (t: TrackerId) => void;
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
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Log session</span>
          <div className="seg" role="group" aria-label="Tracker">
            {TRACKER_IDS.map((t) => (
              <button
                key={t}
                aria-pressed={tracker === t}
                onClick={() => setTracker(t)}
              >
                {TRACKERS[t].label}
              </button>
            ))}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tabstrip modal-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`atab ${t.status}${t.id === activeId ? " on" : ""}`}
              onClick={() => onPick(t.id)}
            >
              {t.name}
              {t.status === "saved" ? " ✓" : t.status === "data" ? " ●" : ""}
            </button>
          ))}
        </div>

        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
