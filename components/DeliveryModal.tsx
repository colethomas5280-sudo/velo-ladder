"use client";

import { useEffect, useState } from "react";
import type { DeliveryScreen } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import { BIG_12 } from "@/lib/big12";
import { fmtDate, todayISO } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * Recording a delivery assessment
 *
 * The Big 12: OnBaseU's twelve delivery inefficiencies, offered as twelve
 * collapsible cards in Cole's own order, split off the movement screen into
 * its own record (v27). A saved row IS the assessment now — an EMPTY flaws
 * object still means "I looked and found nothing", so there is no separate
 * flag asking whether anyone looked.
 * ------------------------------------------------------------------ */

export default function DeliveryModal({
  athleteId,
  date: openingDate,
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
  const [date, setDate] = useState(initial?.date ?? openingDate);
  const [flaws, setFlaws] = useState<Record<string, boolean>>(initial?.flaws ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /*
   * The POST upserts on (athlete_id, date): landing a new assessment on a
   * date that already has one replaces it, with whatever is on screen right
   * now. Editing is disabled below and never hits this, so it's new-only,
   * same as the screen modal's warning.
   */
  const clash = !initial && takenDates.includes(date);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleFlaw = (key: string) =>
    setFlaws((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/delivery`, "POST", {
        date,
        flaws,
        notes: notes.trim(),
      });
      onSaved(initial ? "Assessment updated" : "Assessment saved");
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
    }
  }

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

        <div className="ms">
          <div className="ms-top">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={date}
                max={todayISO()}
                disabled={!!initial}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>

          {clash && (
            <p className="ms-note warn" role="status">
              An assessment already exists for {fmtDate(date)}. Saving will
              replace it.
            </p>
          )}

          <div className="ms-group">
            {BIG_12.map((flaw) => {
              const key = `flaw:${flaw.key}`;
              const isOpen = open.has(key);
              return (
                <section className={`ms-flaw-card${isOpen ? " open" : ""}`} key={flaw.key}>
                  <div className="ms-flaw-toggle-row">
                    <input
                      type="checkbox"
                      name={key}
                      aria-label={flaw.label}
                      checked={!!flaws[flaw.key]}
                      onChange={() => toggleFlaw(flaw.key)}
                    />
                    <button
                      type="button"
                      className="ms-test-toggle"
                      aria-expanded={isOpen}
                      onClick={() => toggle(key)}
                    >
                      <span className="ms-test-name">{flaw.label}</span>
                      <span className="caret">{isOpen ? "▾" : "▸"}</span>
                    </button>
                  </div>
                  {isOpen && (
                    <div className="ms-test-body">
                      <p className="ms-help">{flaw.description}</p>
                      <div className="ms-flaw-spot">
                        <div className="eyebrow">How to spot it</div>
                        <p className="ms-help">{flaw.howToSpot}</p>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <label className="field">
            <span>Notes (coach only, never shown to the athlete)</span>
            <textarea
              placeholder="Filmed from the side, arm path looked steep…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {err != null && (
            <p className="form-error" role="alert">
              {err || "Couldn't save that."}
            </p>
          )}

          <div className="ms-actions">
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : initial ? "Update assessment" : "Save assessment"}
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
