"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiftSession } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import {
  LIFTS,
  LIFT_GROUPS,
  MAX_SETS,
  fmtMetric,
  fmtSet,
  liftBest,
  liftLast,
  liftMode,
  liftName,
  type DatedLifts,
  type Lift,
} from "@/lib/strength";
import { fmtDate, todayISO } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * Logging a lifting day
 *
 * Built around what an athlete actually does between sets: open it, pick the
 * lift, type two numbers, put the phone down. So the form starts EMPTY and
 * grows — showing all twelve lifts at once would mean scrolling past nine
 * they didn't do to reach the one they did.
 *
 * Every row carries what they hit last time and their best, for the same
 * reason the throwing form carries "last / PR": the number to beat is the
 * whole point, and looking it up in the history first is a step nobody takes.
 * ------------------------------------------------------------------ */

/** A set as the form holds it — strings, because a half-typed number is text. */
interface DraftSet {
  w: string;
  r: string;
}
type Draft = Record<string, DraftSet[]>;

const blankSet = (): DraftSet => ({ w: "", r: "" });

/** Digits, and at most one decimal point. */
const cleanW = (s: string) => s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const cleanR = (s: string) => s.replace(/[^0-9]/g, "");

function draftFrom(day: LiftSession | null): Draft {
  const out: Draft = {};
  if (!day) return out;
  for (const [key, sets] of Object.entries(day.lifts))
    if (sets?.length)
      out[key] = sets.map((s) => ({
        w: liftMode(key) === "reps" && s.w === 0 ? "" : String(s.w),
        r: String(s.r),
      }));
  return out;
}

/** Config order, so the form reads the same way twice. */
function orderedKeys(draft: Draft): string[] {
  const rank = new Map(LIFTS.map((l, i) => [l.key, i]));
  return Object.keys(draft).sort(
    (a, b) => (rank.get(a) ?? LIFTS.length) - (rank.get(b) ?? LIFTS.length),
  );
}

export default function LiftModal({
  athleteId,
  existing,
  date,
  history,
  onClose,
  onSaved,
}: {
  athleteId: string;
  existing: LiftSession | null;
  date: string;
  /** Every day this athlete has logged — what "last time" and "best" read. */
  history: DatedLifts[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [when, setWhen] = useState(existing?.date ?? date ?? todayISO());
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  /*
   * The day being edited is excluded from its own history. Otherwise the row
   * would show today's first set as "last time" the moment it was typed, and
   * an athlete would be chasing a number he had already hit this session.
   */
  const past = useMemo(
    () => history.filter((d) => d.date !== when),
    [history, when],
  );

  const shown = orderedKeys(draft);
  const available = LIFTS.filter((l) => !(l.key in draft));

  const addLift = (key: string) => {
    if (!key) return;
    setDraft((p) => ({ ...p, [key]: [blankSet()] }));
  };
  const dropLift = (key: string) =>
    setDraft((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  const addSet = (key: string) =>
    setDraft((p) => {
      const sets = p[key] ?? [];
      // Carrying the weight down is what a lifter does: same bar, next set.
      const last = sets[sets.length - 1];
      return {
        ...p,
        [key]: [...sets, last ? { w: last.w, r: "" } : blankSet()],
      };
    });
  const dropSet = (key: string, i: number) =>
    setDraft((p) => ({ ...p, [key]: p[key].filter((_, n) => n !== i) }));
  const edit = (key: string, i: number, field: "w" | "r", value: string) =>
    setDraft((p) => ({
      ...p,
      [key]: p[key].map((s, n) => (n === i ? { ...s, [field]: value } : s)),
    }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const lifts: Record<string, { w: string; r: string }[]> = {};
      for (const key of shown) lifts[key] = draft[key];
      await api(`/api/athletes/${athleteId}/lifts`, "POST", {
        date: when,
        lifts,
        notes: notes.trim(),
      });
      onSaved(existing ? "Lifting updated" : "Lifting saved");
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? e.message
          : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Lifting</span>
          <span className="modal-sub">{fmtDate(when)}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="lm">
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>

          {shown.length === 0 && (
            <p className="widget-empty">
              Pick a lift below and put in what you did — weight and reps, one
              row per working set.
            </p>
          )}

          {shown.map((key) => (
            <LiftBlock
              key={key}
              lift={LIFTS.find((l) => l.key === key) ?? null}
              liftKey={key}
              sets={draft[key]}
              past={past}
              onAdd={() => addSet(key)}
              onDrop={() => dropLift(key)}
              onDropSet={(i) => dropSet(key, i)}
              onEdit={(i, field, value) => edit(key, i, field, value)}
            />
          ))}

          {available.length > 0 && (
            <label className="field lm-add">
              <span>Add a lift</span>
              <select
                value=""
                onChange={(e) => {
                  addLift(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="">Choose…</option>
                {LIFT_GROUPS.map((g) => {
                  const inGroup = available.filter((l) => l.group === g);
                  if (!inGroup.length) return null;
                  return (
                    <optgroup key={g} label={g}>
                      {inGroup.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
          )}

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              placeholder="Felt heavy, cut it short, tweaked something…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {err != null && (
            <p className="form-error" role="alert">
              {err || "Couldn't save that."}
            </p>
          )}

          <div className="lm-actions">
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : existing ? "Update lifting" : "Save lifting"}
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

/** One lift in the form: what to beat, then a row per working set. */
function LiftBlock({
  lift,
  liftKey,
  sets,
  past,
  onAdd,
  onDrop,
  onDropSet,
  onEdit,
}: {
  lift: Lift | null;
  liftKey: string;
  sets: DraftSet[];
  past: DatedLifts[];
  onAdd: () => void;
  onDrop: () => void;
  onDropSet: (i: number) => void;
  onEdit: (i: number, field: "w" | "r", value: string) => void;
}) {
  const mode = lift?.mode ?? liftMode(liftKey);
  const last = liftLast(past, liftKey);
  const best = liftBest(past, liftKey, mode);
  const bw = mode === "reps";
  // The set worth beating: the longest on a bodyweight lift, the heaviest
  // otherwise — the same set the best and the chart are read from.
  const lastSet = last ? (bw ? last.stats.longest : last.stats.top) : null;

  return (
    <div className="lm-lift">
      <div className="lm-lift-head">
        <b>{lift?.name ?? liftName(liftKey)}</b>
        <button
          className="btn sm ghost"
          onClick={onDrop}
          aria-label={`Remove ${lift?.name ?? liftKey}`}
        >
          Remove
        </button>
      </div>
      {lift?.help && <span className="lm-help">{lift.help}</span>}

      <div className="lm-target">
        {last ? (
          <span>
            Last <b>{lastSet ? fmtSet(lastSet, mode) : "–"}</b> ·{" "}
            {fmtDate(last.date)}
          </span>
        ) : (
          <span>First time logging this one</span>
        )}
        {best && (
          <span>
            Best <b>{fmtMetric(best.value, mode)}</b>
            {best.set && ` (${fmtSet(best.set, mode)})`}
          </span>
        )}
      </div>

      <div className="lm-sets">
        {sets.map((s, i) => (
          <div className="lm-set" key={i}>
            <span className="lm-n">{i + 1}</span>
            <input
              className="tin"
              inputMode="decimal"
              aria-label={`Set ${i + 1} weight`}
              placeholder={bw ? "BW" : "225"}
              value={s.w}
              onChange={(e) => onEdit(i, "w", cleanW(e.target.value))}
            />
            <span className="lm-x">×</span>
            <input
              className="tin"
              inputMode="numeric"
              aria-label={`Set ${i + 1} reps`}
              placeholder="5"
              value={s.r}
              onChange={(e) => onEdit(i, "r", cleanR(e.target.value))}
            />
            {/*
              * A minus, not another ×. The row already reads "285 × 3", and a
              * second × at the end of it looks like part of the sum rather
              * than the button that deletes the set. Hidden on the last
              * remaining set: removing that is what "Remove" on the lift does.
              */}
            {sets.length > 1 && (
              <button
                className="btn sm ghost lm-drop"
                onClick={() => onDropSet(i)}
                aria-label={`Remove set ${i + 1}`}
              >
                −
              </button>
            )}
          </div>
        ))}
      </div>

      {sets.length < MAX_SETS && (
        <button className="btn sm" onClick={onAdd}>
          + Set
        </button>
      )}
    </div>
  );
}
