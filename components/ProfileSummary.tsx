"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { fmtDate, fmt, todayISO } from "@/lib/velo";
import { ageOn } from "@/lib/leaderboard";
import {
  PROFILE_FIELDS,
  isBlankValue,
  missingProfileFields,
  editableKeys,
  type ProfileField,
} from "@/lib/profile";

type Row = Record<string, unknown>;

/**
 * The profile at rest: a scannable panel rather than a wall of inputs.
 * Edit swaps each value for its input in place — same grid, same card,
 * same field order as at rest, so the card never changes shape going in
 * or out of edit.
 *
 * Editing opens by itself for an athlete while anything required is
 * still blank.
 *
 * The grid is deliberately the short factual fields only. The two free-text
 * ones read as paragraphs, not label/value pairs, so they sit underneath.
 */
const LONG_TEXT = new Set(["injuryNotes", "coachNotes"]);

export default function ProfileSummary({
  athleteId,
  isCoach,
}: {
  athleteId: string;
  isCoach: boolean;
}) {
  const { data, mutate, isLoading } = useSWR<Row>(
    `/api/athletes/${athleteId}`,
    fetcher,
  );
  const [editing, setEditing] = useState(false);
  /*
   * Auto-open is derived from what is still blank, so without this edit mode
   * would reopen the instant it closed — "Not now" would do nothing. Dismissal
   * is component state on purpose: it lasts this visit, and the prompt is back
   * next time he signs in, which is the nudge the feature is for.
   */
  const [dismissed, setDismissed] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isLoading) return <p className="widget-empty">Loading…</p>;
  if (!data)
    return <p className="widget-empty">Couldn&apos;t load this profile.</p>;

  const missing = missingProfileFields(data);
  const needs = new Set(missing);

  /*
   * Opens on its own only for the athlete, and only while something required
   * is blank. A coach opening an athlete with gaps gets the summary and an
   * Edit button — a popup every time he opened a half-filled profile would be
   * an interruption, not a prompt.
   */
  const autoOpen = !isCoach && missing.length > 0 && !dismissed;
  const open = editing || autoOpen;

  const grid = PROFILE_FIELDS.filter(
    (f) => f.key in data && !LONG_TEXT.has(f.key),
  );
  // At rest: only the ones with something in them. Editing: every long-text
  // field the role can see, blank or not, so there's somewhere to type.
  const blocks = PROFILE_FIELDS.filter(
    (f) =>
      f.key in data &&
      LONG_TEXT.has(f.key) &&
      (open || !isBlankValue(data[f.key])),
  );

  const display = (f: ProfileField): string => {
    const v = data[f.key];
    if (isBlankValue(v)) return "";
    if (f.kind === "date") return fmtDate(String(v));
    if (f.key === "weightLb" || f.key === "heightIn")
      return `${fmt(Number(v))}${f.unit ? ` ${f.unit}` : ""}`;
    return String(v);
  };

  const birthDate = data.birthDate as string | null;
  const age = birthDate ? ageOn(birthDate, todayISO()) : null;

  /*
   * The SAME function the API uses to decide what this role may write — not a
   * copy of its logic. A hand-rolled copy is what produced the bug this
   * replaces: it consulted the half-typed value as well as the stored one, so
   * a set-once field locked the instant you typed into it and a fat-fingered
   * birthday couldn't be corrected in the sitting that produced it.
   *
   * `data` is the stored row. Nothing is committed until Save, so nothing
   * locks until then.
   */
  const allowed = new Set(editableKeys(isCoach, data));
  const editable = (f: ProfileField) => allowed.has(f.key);
  const value = (f: ProfileField) =>
    edits[f.key] ?? (data[f.key] == null ? "" : String(data[f.key]));
  const setValue = (f: ProfileField, v: string) =>
    setEdits((p) => ({ ...p, [f.key]: v }));

  // What is still blank if he saved right now — drives the button's copy.
  const wouldRemain = missingProfileFields({
    ...data,
    ...Object.fromEntries(
      Object.entries(edits).map(([k, v]) => [k, v === "" ? null : v]),
    ),
  }).length;

  function startEdit() {
    setEdits({});
    setErr(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEdits({});
    setErr(null);
    setEditing(false);
    setDismissed(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      /*
       * Send only what changed, and send "" as null — an emptied box is a
       * deliberate clear, which the API treats differently from a field that
       * was never mentioned.
       */
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(edits)) patch[k] = v === "" ? null : v;
      await api(`/api/athletes/${athleteId}`, "PATCH", patch);
      await mutate();
      setEdits({});
      setEditing(false);
    } catch (e) {
      // The API returns one specific message per bad field, and that message
      // is the whole point of refusing the write rather than clearing it.
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <section className="card pad">
      <div className="sec-h">
        <h3>{isCoach ? "Profile" : "My profile"}</h3>
        <span className="sec-actions">
          {!open && missing.length > 0 && (
            <span className="pf-missing">{missing.length} missing</span>
          )}
          {!open && (
            <button className="btn sm ghost" onClick={startEdit}>
              Edit
            </button>
          )}
        </span>
      </div>

      {open && !isCoach && (
        <p className="cz-note">
          Your coach needs these once. You can close this and come back to it.
          It&apos;ll be here next time until it&apos;s done.
        </p>
      )}

      <dl className="pf-grid">
        {grid.map((f) => {
          const text = display(f);
          const canEdit = open && editable(f);
          return (
            <div className="pf-cell" key={f.key}>
              <dt>{f.label}</dt>
              <dd>
                {!canEdit ? (
                  text || <span className="pf-blank">not set</span>
                ) : f.kind === "select" ? (
                  <select
                    aria-label={f.label}
                    value={value(f)}
                    onChange={(e) => setValue(f, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={f.label}
                    type={f.kind === "date" ? "date" : "text"}
                    inputMode={f.kind === "number" ? "numeric" : undefined}
                    value={value(f)}
                    onChange={(e) => setValue(f, e.target.value)}
                  />
                )}
                {canEdit && f.unit && <span className="pf-unit">{f.unit}</span>}
                {canEdit && f.help && (
                  <span className="pf-derived">{f.help}</span>
                )}
                {/* Age is derived, never stored — one less thing to go stale. */}
                {f.key === "birthDate" && age != null && (
                  <span className="pf-derived">age {age}</span>
                )}
                {f.key === "weightLb" && text && data.weightAt != null && (
                  <span className="pf-derived">
                    {data.weightSource === "checkin"
                      ? `from check-in, ${fmtDate(String(data.weightAt))}`
                      : `entered ${fmtDate(String(data.weightAt))}`}
                  </span>
                )}
                {!text && needs.has(f.key) && (
                  <span className="pf-needed">needed</span>
                )}
                {open && !editable(f) && (
                  <span className="pf-derived">
                    {f.athleteSetOnce
                      ? "ask your coach to change this"
                      : "your coach sets this"}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {blocks.map((f) => {
        const canEdit = open && editable(f);
        return (
          <div className="pf-block" key={f.key}>
            <div className="eyebrow">{f.label}</div>
            {canEdit && f.help && <span className="pf-derived">{f.help}</span>}
            {canEdit ? (
              <textarea
                aria-label={f.label}
                value={value(f)}
                onChange={(e) => setValue(f, e.target.value)}
              />
            ) : (
              <p>
                {String(data[f.key] ?? "") || (
                  <span className="pf-blank">not set</span>
                )}
              </p>
            )}
          </div>
        );
      })}

      {open && (
        <>
          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}

          <div className="pf-actions">
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : isCoach ? "Save" : "Complete"}
            </button>
            <button className="btn ghost" onClick={cancelEdit}>
              {isCoach ? "Cancel" : "Not now"}
            </button>
            {!isCoach && wouldRemain > 0 && (
              <span className="cz-note">{wouldRemain} still to fill in</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
