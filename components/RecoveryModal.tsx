"use client";

import { useEffect, useState } from "react";
import type { RecoveryEntry, ArmStatus } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import {
  WELLNESS_SECTIONS,
  recoveryScore,
  scoreBand,
  sleepBand,
  type RatingKey,
} from "@/lib/recovery";
import { ARM_STATUS_OPTIONS } from "@/lib/setback";
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
  armStatus: ArmStatus | null;
  notes: string;
};

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
    armStatus: e?.armStatus ?? null,
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
        armStatus: d.armStatus,
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
                    sleepHours: e.target.value
                      .replace(/[^0-9.]/g, "")
                      .replace(/(\..*)\./g, "$1"),
                  }))
                }
              />
            </label>
            <div className={`ci-score ${preview == null ? "" : scoreBand(preview)}`}>
              <span className="n">{preview ?? "–"}</span>
              <span className="l">Score</span>
            </div>
          </div>

          <div className="arm-q">
            <div className="ci-label">
              <b>How&rsquo;s the arm?</b>
              <span>Sore and hurt are not the same thing</span>
            </div>
            <div className="arm-opts">
              {ARM_STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`arm-opt ${o.value}`}
                  aria-pressed={d.armStatus === o.value}
                  onClick={() =>
                    setD((p) => ({
                      ...p,
                      armStatus: p.armStatus === o.value ? null : o.value,
                    }))
                  }
                >
                  <b>{o.label}</b>
                  <span>{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {WELLNESS_SECTIONS.map((section) => (
            <div className="wl-section" key={section.id}>
              <div className="eyebrow">{section.title}</div>

              {section.items.map((item) => {
                // Sleep is answered by typing hours above; show the band it lands in.
                const derivedValue =
                  item.derived && d.sleepHours
                    ? sleepBand(Number(d.sleepHours))
                    : null;
                const value = item.derived
                  ? derivedValue
                  : d[item.key as RatingKey];

                return (
                  <div className="ci-row wl-row" key={item.key}>
                    <div className="ci-label">
                      <b>{item.label}</b>
                      <span>
                        {value
                          ? item.anchors[value - 1]
                          : item.derived
                            ? "From the hours you enter above"
                            : `1 ${item.anchors[0]} \u2192 5 ${item.anchors[4]}`}
                      </span>
                    </div>
                    <div
                      className={`ci-scale${item.derived ? " derived" : ""}`}
                      role="group"
                      aria-label={item.label}
                    >
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button
                          key={v}
                          className="ci-dot"
                          aria-pressed={value === v}
                          disabled={item.derived}
                          title={item.anchors[v - 1]}
                          onClick={() =>
                            setD((p) => ({
                              ...p,
                              [item.key]:
                                p[item.key as RatingKey] === v ? null : v,
                            }))
                          }
                        >
                          {v}
                        </button>
                      ))}
                    </div>
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
