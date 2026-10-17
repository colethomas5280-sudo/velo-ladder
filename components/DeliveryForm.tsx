"use client";

import { useEffect, useState } from "react";
import type { DeliveryScreen } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import { BIG_12 } from "@/lib/big12";
import { fmtDate, todayISO } from "@/lib/velo";
import { saveTestDraft, clearTestDraft, loadTestDraft, type TestDraft } from "@/lib/testDraft";

/* ------------------------------------------------------------------ *
 * Recording a delivery assessment
 *
 * The Big 12: OnBaseU's twelve delivery inefficiencies, offered as twelve
 * collapsible cards in Cole's own order, split off the movement screen into
 * its own record (v27). A saved row IS the assessment now — an EMPTY flaws
 * object still means "I looked and found nothing", so there is no separate
 * flag asking whether anyone looked.
 *
 * The form is the content only; DeliveryModal is the frame around it for the
 * one-athlete flow, and the group test screen shows several of these at once.
 * ------------------------------------------------------------------ */

/**
 * What "unchanged" is compared as. Key order must not matter: unticking a flaw
 * and ticking it again moves its key to the end of the object.
 */
function stable(flaws: Record<string, boolean>, notes: string): string {
  const sorted = Object.fromEntries(
    Object.entries(flaws).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify({ flaws: sorted, notes });
}

export default function DeliveryForm({
  athleteId,
  date: openingDate,
  initial,
  takenDates,
  onSaved,
  onCancel,
  group = false,
  draft = null,
  persist = false,
  onDirty,
  register,
}: {
  athleteId: string;
  /** The date this opens on — today's, unless editing an existing assessment. */
  date: string;
  initial: DeliveryScreen | null;
  /** Dates that already hold an assessment, so a new one can warn before it lands on one. */
  takenDates: string[];
  onSaved: (msg: string) => void;
  /** Renders a Cancel button when given (and not in group mode). */
  onCancel?: () => void;
  /** Group mode: no Cancel. */
  group?: boolean;
  /** Unsaved marks to start from, restored after a reload. */
  draft?: TestDraft | null;
  /** Keep a draft in the browser while there are unsaved marks. */
  persist?: boolean;
  /**
   * Told whenever "has unsaved changes" flips. Called from an effect, so keep
   * it cheap and idempotent.
   */
  onDirty?: (dirty: boolean) => void;
  /**
   * Gives a parent a way to trigger Save; resolves true on success. It is
   * called after EVERY render with the latest closure, so a parent must keep
   * the function in a ref, never in state (that would loop).
   */
  register?: (save: () => Promise<boolean>) => void;
}) {
  // The saved record is only the one being edited if the draft (when there is
  // one) is for the same date. A draft for another date is a new assessment.
  const [editing] = useState(() =>
    initial && initial.date === (draft?.date ?? initial.date) ? initial : null,
  );
  const [date, setDate] = useState(draft?.date ?? editing?.date ?? openingDate);
  const [flaws, setFlaws] = useState<Record<string, boolean>>(
    (draft?.data as Record<string, boolean> | undefined) ?? editing?.flaws ?? {},
  );
  const [notes, setNotes] = useState(draft ? draft.notes : (editing?.notes ?? ""));
  const [justSaved, setJustSaved] = useState(false);
  // What "unchanged" means: the saved record (or blank), moved forward after each save.
  const [baseline, setBaseline] = useState(() =>
    stable(editing?.flaws ?? {}, editing?.notes ?? ""),
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /*
   * The POST upserts on (athlete_id, date): landing a new assessment on a
   * date that already has one replaces it, with whatever is on screen right
   * now. Editing is disabled below and never hits this, so it's new-only,
   * same as the screen modal's warning.
   */
  const clash = !editing && !justSaved && takenDates.includes(date);

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

  const dirty = stable(flaws, notes) !== baseline;

  /*
   * What a parent is told is "has unsaved marks", not "differs from the
   * record": a note typed on a clean form is not something Save all should
   * sweep up as an assessment. (A clean assessment is still saved, by that
   * athlete's own Save button.)
   */
  const hasUnsavedAnswers = dirty && Object.keys(flaws).length > 0;
  useEffect(() => {
    onDirty?.(hasUnsavedAnswers);
  }, [hasUnsavedAnswers, onDirty]);

  // A draft exists only while there are unsaved marks, so an empty or
  // back-to-saved form leaves nothing behind to date a later test wrongly.
  useEffect(() => {
    if (!persist) return;
    if (dirty && Object.keys(flaws).length > 0) {
      saveTestDraft("delivery", athleteId, { date, notes, data: flaws });
    } else {
      clearTestDraft("delivery", athleteId);
    }
  }, [persist, dirty, flaws, notes, date, athleteId]);

  /*
   * A save on the athlete's own page (persist off) never reads or writes a
   * draft, but a group test may have left one behind for this same
   * assessment. It is stale the moment that assessment is saved, and would
   * come back over the complete record. Only a draft for the date just saved
   * is cleared; a draft for another date is a different assessment. With
   * persist on, the effect above clears the draft once the baseline moves,
   * and clearing here would lose marks made while the request is in flight.
   */
  function clearOwnPageDraft() {
    if (persist) return;
    if (loadTestDraft("delivery", athleteId)?.date === date) {
      clearTestDraft("delivery", athleteId);
    }
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/delivery`, "POST", {
        date,
        flaws,
        notes: notes.trim(),
      });
      const updating = !!editing || justSaved;
      setJustSaved(true);
      setBaseline(stable(flaws, notes));
      setBusy(false);
      clearOwnPageDraft();
      onSaved(updating ? "Assessment updated" : "Assessment saved");
      return true;
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
      return false;
    }
  }

  // Re-registered every render so a parent always calls the latest closure.
  useEffect(() => {
    register?.(save);
  });

  return (
    <div className="ms">
      <div className="ms-top">
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            max={todayISO()}
            disabled={!!editing || justSaved}
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
          {busy ? "Saving…" : editing || justSaved ? "Update assessment" : "Save assessment"}
        </button>
        {onCancel && !group && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
