"use client";

import { useEffect, useState } from "react";
import type { RecoveryEntry } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import { RATINGS, recoveryScore, scoreBand } from "@/lib/recovery";
import { todayISO, fmtDate } from "@/lib/velo";

type Draft = {
  date: string;
  sleepHours: string;
  sleepQuality: number | null;
  soreness: number | null;
  energy: number | null;
  stress: number | null;
  mood: number | null;
  restingHr: string;
  hrv: string;
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
    restingHr: e?.restingHr != null ? String(e.restingHr) : "",
    hrv: e?.hrv != null ? String(e.hrv) : "",
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
        restingHr: num(d.restingHr),
        hrv: num(d.hrv),
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

          {RATINGS.map((r) => (
            <div className="ci-row" key={r.key}>
              <div className="ci-label">
                <b>{r.label}</b>
                <span>
                  {r.low} → {r.high}
                </span>
              </div>
              <div className="ci-scale" role="group" aria-label={r.label}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className="ci-dot"
                    aria-pressed={d[r.key] === v}
                    onClick={() =>
                      setD((p) => ({ ...p, [r.key]: p[r.key] === v ? null : v }))
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
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
