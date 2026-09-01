"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { fmtDate, fmt, todayISO } from "@/lib/velo";
import { ageOn } from "@/lib/leaderboard";
import {
  PROFILE_FIELDS,
  isBlankValue,
  missingProfileFields,
  type ProfileField,
} from "@/lib/profile";
import ProfileModal from "./ProfileModal";

type Row = Record<string, unknown>;

/**
 * The profile at rest: a scannable panel rather than a wall of inputs.
 * Editing happens in a modal, which opens by itself for an athlete while
 * anything required is still blank.
 *
 * The grid is deliberately the short factual fields only. The two free-text
 * ones read as paragraphs, not label/value pairs, so they sit underneath and
 * only when they have something in them.
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
   * Auto-open is derived from what is still blank, so without this the modal
   * would reopen the instant it closed — "Not now" would do nothing. Dismissal
   * is component state on purpose: it lasts this visit, and the prompt is back
   * next time he signs in, which is the nudge the feature is for.
   */
  const [dismissed, setDismissed] = useState(false);

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
  const blocks = PROFILE_FIELDS.filter(
    (f) => f.key in data && LONG_TEXT.has(f.key) && !isBlankValue(data[f.key]),
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

  return (
    <section className="card pad pf">
      <div className="sec-h">
        <h3>{isCoach ? "Profile" : "My profile"}</h3>
        <span className="sec-actions">
          {missing.length > 0 && (
            <span className="pf-missing">{missing.length} missing</span>
          )}
          <button className="btn sm ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
        </span>
      </div>

      <dl className="pf-grid">
        {grid.map((f) => {
          const text = display(f);
          return (
            <div className="pf-cell" key={f.key}>
              <dt>{f.label}</dt>
              <dd>
                {text || <span className="pf-blank">not set</span>}
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
              </dd>
            </div>
          );
        })}
      </dl>

      {blocks.map((f) => (
        <div className="pf-block" key={f.key}>
          <div className="eyebrow">{f.label}</div>
          <p>{String(data[f.key])}</p>
        </div>
      ))}

      {open && (
        <ProfileModal
          athleteId={athleteId}
          isCoach={isCoach}
          data={data}
          onClose={() => {
            setEditing(false);
            setDismissed(true);
          }}
          onSaved={mutate}
        />
      )}
    </section>
  );
}
