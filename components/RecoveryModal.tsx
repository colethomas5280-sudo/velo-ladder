"use client";

import { useEffect, useState } from "react";
import type { RecoveryEntry } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import {
  WELLNESS_SECTIONS,
  recoveryScore,
  scoreBand,
  sleepBand,

} from "@/lib/recovery";
import { todayISO, fmtDate } from "@/lib/velo";

type Draft = {
  date: string;
  sleepHours: string;
  sleepQuality: number | null;
  soreness: number | null;
  energy: number | null;
  stress: number | null;
  mood: number | null;
  diet: number | null;
  restingHr: string;
  hrv: string;
  armReadiness: number | null;
  bodyWeight: string;
  notes: string;
};

/** Strip anything that isn't a number, keeping at most one decimal point. */
const clean = (s: string, decimal?: boolean) =>
  decimal
    ? s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")
    : s.replace(/[^0-9]/g, "");

function draftFrom(e: RecoveryEntry | null, date: string): Draft {
  return {
    date: e?.date ?? date,
    sleepHours: e?.sleepHours != null ? String(e.sleepHours) : "",
    sleepQuality: e?.sleepQuality ?? null,
    soreness: e?.soreness ?? null,
    energy: e?.energy ?? null,
    stress: e?.stress ?? null,
    mood: e?.mood ?? null,
    diet: e?.diet ?? null,
    restingHr: e?.restingHr != null ? String(e.restingHr) : "",
    hrv: e?.hrv != null ? String(e.hrv) : "",
    armReadiness: e?.armReadiness ?? null,
    bodyWeight: e?.bodyWeight != null ? String(e.bodyWeight) : "",
    notes: e?.notes ?? "",
  };
}

export default function RecoveryModal({
  athleteId,
  existing,
  date,
  onClose,
  onSaved,
}: {
  athleteId: string;
  existing: RecoveryEntry | null;
  date: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(existing, date || todayISO()));
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

  // Live score preview from whatever is filled in so far.
  const preview = recoveryScore({
    sleepHours: d.sleepHours ? Number(d.sleepHours) : null,
    sleepQuality: d.sleepQuality,
    soreness: d.soreness,
    energy: d.energy,
    stress: d.stress,
    mood: d.mood,
    diet: d.diet,
    armReadiness: d.armReadiness,
  } as RecoveryEntry);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/recovery`, "POST", {
        date: d.date,
        sleepHours: num(d.sleepHours),
        sleepQuality: d.sleepQuality,
        soreness: d.soreness,
        energy: d.energy,
        stress: d.stress,
        mood: d.mood,
        diet: d.diet,
        restingHr: num(d.restingHr),
        hrv: num(d.hrv),
        armReadiness: d.armReadiness,
        bodyWeight: num(d.bodyWeight),
        notes: d.notes.trim(),
      });
      onSaved(existing ? "Check-in updated" : "Check-in saved");
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
          <span className="modal-title">Recovery check-in</span>
          <span className="modal-sub">{fmtDate(d.date)}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="checkin">
          <div className="ci-top">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={d.date}
                onChange={(e) =>
                  setD((p) => ({ ...p, date: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Hours slept</span>
              <input
                className="tin"
                inputMode="decimal"
                placeholder="7.5"
                style={{ width: 92 }}
                value={d.sleepHours}
                onChange={(e) =>
                  setD((p) => ({
                    ...p,
                    sleepHours: clean(e.target.value, true),
                  }))
                }
              />
            </label>
            <div className={`ci-score ${preview == null ? "" : scoreBand(preview)}`}>
              <span className="n">{preview ?? "–"}</span>
              <span className="l">Score</span>
            </div>
          </div>

          {WELLNESS_SECTIONS.map((section) => (
            <div className="wl-section" key={section.id}>
              <div className="eyebrow">{section.title}</div>

              {section.items.map((item) => {
                if (item.kind === "numeric")
                  return (
                    <div className="ci-row wl-row" key={item.key}>
                      <div className="ci-label">
                        <b>{item.label}</b>
                        {item.help && <span className="wl-help">{item.help}</span>}
                      </div>
                      <div className="wl-num">
                        <input
                          className="tin"
                          inputMode={item.decimal ? "decimal" : "numeric"}
                          aria-label={`${item.label} in ${item.unit}`}
                          placeholder={item.placeholder}
                          value={d[item.key as keyof Draft] as string}
                          onChange={(e) =>
                            setD((p) => ({
                              ...p,
                              [item.key]: clean(e.target.value, item.decimal),
                            }))
                          }
                        />
                        <span className="wl-unit">{item.unit}</span>
                      </div>
                    </div>
                  );

                // Sleep is answered by typing hours above; show the band it lands in.
                const derivedValue =
                  item.derived && d.sleepHours
                    ? sleepBand(Number(d.sleepHours))
                    : null;
                const value = item.derived
                  ? derivedValue
                  : (d[item.key as keyof Draft] as number | null);

                return (
                  <div className="ci-row wl-row" key={item.key}>
                    <div className="ci-label">
                      <b>{item.label}</b>
                      {item.derived && (
                        <span>From the hours you enter above</span>
                      )}
                    </div>
                    <select
                      className={`wl-select${item.derived ? " derived" : ""}`}
                      aria-label={item.label}
                      disabled={item.derived}
                      value={value ?? ""}
                      onChange={(e) =>
                        setD((p) => ({
                          ...p,
                          [item.key]:
                            e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">
                        {item.derived ? "—" : "Choose…"}
                      </option>
                      {item.anchors.map((a, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1} — {a}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          ))}

          <details className="roster-d ci-extra">
            <summary>Wearable numbers (optional)</summary>
            <div className="ci-wearable">
              <label className="field">
                <span>Resting HR</span>
                <input
                  className="tin"
                  inputMode="numeric"
                  placeholder="52"
                  value={d.restingHr}
                  onChange={(e) =>
                    setD((p) => ({
                      ...p,
                      restingHr: e.target.value.replace(/[^0-9]/g, ""),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>HRV</span>
                <input
                  className="tin"
                  inputMode="numeric"
                  placeholder="68"
                  value={d.hrv}
                  onChange={(e) =>
                    setD((p) => ({
                      ...p,
                      hrv: e.target.value.replace(/[^0-9]/g, ""),
                    }))
                  }
                />
              </label>
            </div>
            <p className="cz-note">
              Tracked and charted, but kept out of the score — these are personal
              baselines, not something to compare between athletes.
            </p>
          </details>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              placeholder="Travel, exams, sick, big lift yesterday…"
              value={d.notes}
              onChange={(e) => setD((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>

          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : existing ? "Update check-in" : "Save check-in"}
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
