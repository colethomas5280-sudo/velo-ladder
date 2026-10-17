"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TRACKER_IDS, TRACKERS } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";
import ConfirmDialog from "./ConfirmDialog";

export interface Tab {
  id: string;
  name: string;
  status: "saved" | "data" | "empty";
}

/**
 * The group's velocity pop-up. Every way of closing it (the X, a click outside,
 * Escape) asks first, every time: unlike the single-athlete pop-up there is no
 * empty "pick" step, so it is never safe to assume nothing is at stake.
 * `onClose` still means "really close".
 *
 * `overlay` is a second confirm the caller owns (the save summary), rendered
 * as a sibling after the backdrop and never inside it. While it is up this
 * pop-up's Escape does nothing.
 */
export default function GroupEntryModal({
  tabs,
  activeId,
  onPick,
  onClose,
  tracker,
  setTracker,
  overlay,
  children,
}: {
  tabs: Tab[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  tracker: TrackerId;
  setTracker: (t: TrackerId) => void;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const confirmOpen = leaving || !!overlay;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmOpen) setLeaving(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  return (
    <>
      <div className="modal-backdrop" onClick={() => setLeaving(true)}>
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
            <button
              className="modal-x"
              onClick={() => setLeaving(true)}
              aria-label="Close"
            >
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
