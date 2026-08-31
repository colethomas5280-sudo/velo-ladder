"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { RecoveryEntry, TrainingSession } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { recoveryScore, scoreBand, buildInsight } from "@/lib/recovery";
import { fmt, fmtDate, todayISO } from "@/lib/velo";
import RecoveryModal from "./RecoveryModal";

export default function RecoveryPanel({
  athleteId,
  sessions,
  onChanged,
}: {
  athleteId: string;
  sessions: TrainingSession[];
  onChanged?: () => void;
}) {
  const { data, mutate, isLoading } = useSWR<RecoveryEntry[]>(
    `/api/athletes/${athleteId}/recovery`,
    fetcher,
  );
  const entries = useMemo(() => data ?? [], [data]);
  const [editing, setEditing] = useState<RecoveryEntry | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const today = todayISO();
  const todayEntry = entries.find((e) => e.date === today) ?? null;
  const recent = [...entries].reverse().slice(0, 7);
  const insight = useMemo(
    () => buildInsight(sessions, entries),
    [sessions, entries],
  );

  const last7 = entries
    .slice(-7)
    .map(recoveryScore)
    .filter((s): s is number => s != null);
  const avg7 = last7.length
    ? Math.round(last7.reduce((a, b) => a + b, 0) / last7.length)
    : null;

  async function remove(e: RecoveryEntry) {
    if (!confirm(`Delete the check-in for ${fmtDate(e.date)}?`)) return;
    try {
      await api(
        `/api/athletes/${athleteId}/recovery?date=${e.date}`,
        "DELETE",
      );
      await mutate();
      onChanged?.();
      show("Deleted");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Couldn't delete that");
    }
  }

  return (
    <section className="card pad recovery-card">
      <div className="sec-h">
        <h3>Recovery</h3>
        <span className="sub">
          {avg7 != null ? `7-day average ${avg7}` : "daily check-in"}
        </span>
      </div>

      <div className="rec-top">
        <div className={`ci-score big ${todayEntry ? scoreBand(recoveryScore(todayEntry) ?? 0) : ""}`}>
          <span className="n">
            {todayEntry ? (recoveryScore(todayEntry) ?? "–") : "–"}
          </span>
          <span className="l">Today</span>
        </div>
        <button
          className="btn primary"
          onClick={() => setEditing(todayEntry ?? "new")}
        >
          {todayEntry ? "Edit today's check-in" : "+ Log today's recovery"}
        </button>
      </div>

      {insight && <InsightBlock insight={insight} />}

      {!isLoading && entries.length === 0 && (
        <p className="widget-empty">
          No check-ins yet. Log a few and this will start showing how sleep and
          soreness line up with your velocity.
        </p>
      )}

      {recent.length > 0 && (
        <ul className="rec-list">
          {recent.map((e) => {
            const sc = recoveryScore(e);
            return (
              <li key={e.date}>
                <span className={`chip-score ${sc == null ? "" : scoreBand(sc)}`}>
                  {sc ?? "–"}
                </span>
                <div className="feed-main">
                  <b>{fmtDate(e.date)}</b>
                  <span className="feed-sub">
                    {[
                      e.sleepHours != null ? `${fmt(e.sleepHours)}h sleep` : null,
                      e.energy != null ? `fatigue ${e.energy}/5` : null,
                      e.soreness != null ? `soreness ${e.soreness}/5` : null,
                      e.diet != null ? `diet ${e.diet}/5` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
                <span className="rec-actions">
                  <button className="btn sm ghost" onClick={() => setEditing(e)}>
                    Edit
                  </button>
                  <button className="btn sm danger" onClick={() => remove(e)}>
                    Del
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <RecoveryModal
          athleteId={athleteId}
          existing={editing === "new" ? null : editing}
          date={editing === "new" ? today : editing.date}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            await mutate();
            onChanged?.();
            setEditing(null);
            show(msg);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

function InsightBlock({
  insight,
}: {
  insight: NonNullable<ReturnType<typeof buildInsight>>;
}) {
  const i = insight;
  const scoreGap =
    i.topScore != null && i.bottomScore != null
      ? Math.round(i.topScore - i.bottomScore)
      : null;
  const sleepGap =
    i.topSleep != null && i.bottomSleep != null
      ? i.topSleep - i.bottomSleep
      : null;

  // Nothing meaningful to claim if both gaps are inside the noise.
  const meaningful =
    (scoreGap != null && Math.abs(scoreGap) >= 5) ||
    (sleepGap != null && Math.abs(sleepGap) >= 0.5);

  return (
    <div className="insight">
      <div className="eyebrow">What the numbers say</div>
      {meaningful ? (
        <p>
          Your <b>best throwing days</b> (avg {fmt(i.topVelo)}) came with{" "}
          {i.topSleep != null && (
            <>
              <b>{fmt(i.topSleep)}h sleep</b>
              {i.bottomSleep != null && <> vs {fmt(i.bottomSleep)}h</>}
            </>
          )}
          {i.topSleep != null && scoreGap != null && " and "}
          {scoreGap != null && (
            <>
              a recovery score of <b>{Math.round(i.topScore!)}</b> vs{" "}
              {Math.round(i.bottomScore!)}
            </>
          )}{" "}
          on your slowest days (avg {fmt(i.bottomVelo)}).
        </p>
      ) : (
        <p>
          Across {i.n} throwing days your recovery looked about the same whether
          you threw hard or not — no clear pattern yet.
        </p>
      )}
      <span className="cz-note">
        Based on {i.n} days where you logged both. Association, not proof.
      </span>
    </div>
  );
}
