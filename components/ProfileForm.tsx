"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { fmtDate } from "@/lib/velo";
import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  type ProfileField,
} from "@/lib/profile";

type Row = Record<string, unknown>;

export default function ProfileForm({
  athleteId,
  isCoach,
  welcome = false,
}: {
  athleteId: string;
  isCoach: boolean;
  /*
   * Passed in rather than read from the URL here. This component renders in
   * two places, and useSearchParams would drag a Suspense requirement onto
   * the coach's athlete page — a build error, not a runtime one.
   */
  welcome?: boolean;
}) {
  const { data, mutate, isLoading } = useSWR<Row>(
    `/api/athletes/${athleteId}`,
    fetcher,
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (isLoading) return <p className="widget-empty">Loading…</p>;
  if (!data) return <p className="widget-empty">Couldn&apos;t load this profile.</p>;

  const shown = (f: ProfileField) => f.key in data;
  const editable = (f: ProfileField) => isCoach || f.athleteCanEdit;
  const value = (f: ProfileField) =>
    edits[f.key] ?? (data[f.key] == null ? "" : String(data[f.key]));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      /*
       * Send only what changed, and send "" as null — an emptied box is a
       * deliberate clear, which the API treats differently from a field
       * that was never mentioned.
       */
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(edits)) patch[k] = v === "" ? null : v;
      await api(`/api/athletes/${athleteId}`, "PATCH", patch);
      setEdits({});
      setSaved(true);
      await mutate();
      setTimeout(() => setSaved(false), 2600);
    } catch (e) {
      // The API returns one specific message per bad field, and that message
      // is the whole point of refusing the write instead of clearing it.
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
    }
    setBusy(false);
  }

  return (
    <section className="card pad pf">
      <div className="sec-h">
        <h3>{isCoach ? "Profile" : "My profile"}</h3>
        {Object.keys(edits).length > 0 && <span className="sub">unsaved changes</span>}
      </div>

      {welcome && (
        <p className="insight">
          Finish setting up your profile — your coach needs a few details, and it
          only takes a minute.
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
                    <span>your coach sets this</span>
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
                      <option key={o} value={o}>{o}</option>
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

                {f.unit && editable(f) && <span className="pf-unit">{f.unit}</span>}

                {f.key === "weightLb" && data.weightAt != null && (
                  <p className="pf-prov">
                    {data.weightSource === "checkin"
                      ? `from check-in, ${fmtDate(String(data.weightAt))}`
                      : `entered ${fmtDate(String(data.weightAt))}`}
                  </p>
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn primary"
          disabled={busy || !Object.keys(edits).length}
          onClick={save}
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="cz-note">Saved</span>}
      </div>
    </section>
  );
}
