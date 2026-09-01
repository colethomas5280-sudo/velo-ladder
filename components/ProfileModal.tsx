"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/fetcher";
import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  editableKeys,
  missingProfileFields,
  type ProfileField,
} from "@/lib/profile";

type Row = Record<string, unknown>;

/**
 * The intake questionnaire. Built on the same modal shell as the recovery
 * check-in rather than a second one of its own.
 *
 * It opens by itself while anything required is still blank, so the copy
 * changes with the situation: an athlete meeting it for the first time is
 * being asked to finish something, while a coach who clicked Edit is not.
 */
export default function ProfileModal({
  athleteId,
  isCoach,
  data,
  onClose,
  onSaved,
}: {
  athleteId: string;
  isCoach: boolean;
  data: Row;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
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

  const shown = (f: ProfileField) => f.key in data;
  /*
   * The SAME function the API uses to decide what this role may write — not a
   * copy of its logic. A hand-rolled copy is what produced the bug this
   * replaces: it consulted the half-typed value as well as the stored one, so
   * a set-once field locked the instant you typed into it and a fat-fingered
   * birthday couldn't be corrected in the sitting that produced it.
   *
   * `data` is the stored row. Nothing is committed until Complete, so nothing
   * locks until then.
   */
  const allowed = new Set(editableKeys(isCoach, data));
  const editable = (f: ProfileField) => allowed.has(f.key);
  const value = (f: ProfileField) =>
    edits[f.key] ?? (data[f.key] == null ? "" : String(data[f.key]));

  // What is still blank if he saved right now — drives the button's copy.
  const wouldRemain = missingProfileFields({
    ...data,
    ...Object.fromEntries(
      Object.entries(edits).map(([k, v]) => [k, v === "" ? null : v]),
    ),
  }).length;

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
      await onSaved();
      onClose();
    } catch (e) {
      // The API returns one specific message per bad field, and that message
      // is the whole point of refusing the write rather than clearing it.
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Athlete profile"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">
            {isCoach ? "Edit profile" : "Your details"}
          </span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="checkin pf">
          {!isCoach && (
            <p className="cz-note">
              Your coach needs these once. You can close this and come back to
              it — it&apos;ll be here next time until it&apos;s done.
            </p>
          )}

          {PROFILE_SECTIONS.map((section) => {
            const fields = PROFILE_FIELDS.filter(
              (f) => f.section === section.id && shown(f),
            );
            if (!fields.length) return null;

            return (
              <div className="pf-section" key={section.id}>
                <div className="eyebrow">{section.title}</div>

                {fields.map((f) => (
                  <div className="ci-row pf-row" key={f.key}>
                    <div className="ci-label">
                      <b>{f.label}</b>
                      {f.help && <span className="wl-help">{f.help}</span>}
                    </div>

                    {!editable(f) ? (
                      <div className="pf-locked">
                        {value(f) || "—"}
                        <span>
                          {f.athleteSetOnce
                            ? "ask your coach to change this"
                            : "your coach sets this"}
                        </span>
                      </div>
                    ) : f.kind === "select" ? (
                      <select
                        aria-label={f.label}
                        value={value(f)}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                        }
                      >
                        <option value="">Choose…</option>
                        {f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.kind === "textarea" ? (
                      <textarea
                        aria-label={f.label}
                        value={value(f)}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                        }
                      />
                    ) : (
                      <input
                        aria-label={f.label}
                        type={f.kind === "date" ? "date" : "text"}
                        inputMode={f.kind === "number" ? "numeric" : undefined}
                        value={value(f)}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                        }
                      />
                    )}

                    {f.unit && editable(f) && (
                      <span className="pf-unit">{f.unit}</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : isCoach ? "Save" : "Complete"}
            </button>
            <button className="btn ghost" onClick={onClose}>
              {isCoach ? "Cancel" : "Not now"}
            </button>
            {!isCoach && wouldRemain > 0 && (
              <span className="cz-note">{wouldRemain} still to fill in</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
