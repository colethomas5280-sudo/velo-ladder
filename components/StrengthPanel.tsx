"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { LiftSession } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  METRIC_LABEL,
  dayTotals,
  fmtMetric,
  fmtSet,
  fmtVolume,
  liftBest,
  liftLast,
  liftMode,
  liftName,
  liftSeries,
  liftStats,
  liftsDone,
  liftsEverDone,
  defaultLift,
} from "@/lib/strength";
import { fmtDate, todayISO } from "@/lib/velo";
import LiftChart from "./LiftChart";
import LiftModal from "./LiftModal";

/* ------------------------------------------------------------------ *
 * One athlete's lifting
 *
 * The question this page answers is "am I getting stronger", so the best
 * numbers lead and the log sits underneath. Everything is derived from the
 * stored sets — nothing here stores a total or a record, because a number
 * kept in two places is a number free to disagree with itself.
 * ------------------------------------------------------------------ */

/** How many days back the history list shows before it stops. */
const HISTORY_SHOWN = 10;

export default function StrengthPanel({
  athleteId,
  canEdit,
}: {
  athleteId: string;
  /** The coach, or the athlete themselves. False makes this read-only. */
  canEdit: boolean;
}) {
  const { data, mutate, isLoading, error } = useSWR<LiftSession[]>(
    `/api/athletes/${athleteId}/lifts`,
    fetcher,
  );
  const days = useMemo(() => data ?? [], [data]);
  const [editing, setEditing] = useState<LiftSession | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const today = todayISO();
  const todayDay = days.find((d) => d.date === today) ?? null;
  const keys = useMemo(() => liftsEverDone(days), [days]);
  const [picked, setPicked] = useState<string | null>(null);
  // Their main movement, until they pick something else.
  const fallback = useMemo(() => defaultLift(days), [days]);
  const chartKey = picked && keys.includes(picked) ? picked : fallback;
  const chartMode = chartKey ? liftMode(chartKey) : "load";
  const series = useMemo(
    () => (chartKey ? liftSeries(days, chartKey) : []),
    [days, chartKey],
  );

  const recent = useMemo(() => [...days].reverse().slice(0, HISTORY_SHOWN), [days]);

  async function remove(d: LiftSession) {
    if (!confirm(`Delete the lifting logged for ${fmtDate(d.date)}?`)) return;
    try {
      await api(`/api/athletes/${athleteId}/lifts?date=${d.date}`, "DELETE");
      await mutate();
      show("Deleted");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Couldn't delete that");
    }
  }

  return (
    <section className="card pad st">
      <div className="sec-h">
        <h3>Lifting</h3>
        {canEdit && (
          <button
            className="btn primary"
            onClick={() => setEditing(todayDay ?? "new")}
          >
            {todayDay ? "Edit today's lifting" : "+ Log today's lifting"}
          </button>
        )}
      </div>

      {isLoading && <p className="widget-empty">Loading…</p>}
      {error != null && (
        <p className="form-error" role="alert">
          Couldn&rsquo;t load the lifting log. Reload the page.
        </p>
      )}

      {!isLoading && days.length === 0 && (
        <p className="widget-empty">
          Nothing logged yet. Put in a session and this starts tracking your
          best lifts the way the tracker follows your velocity.
        </p>
      )}

      {keys.length > 0 && (
        <>
          <div className="eyebrow">Bests</div>
          <ul className="st-bests">
            {keys.map((key) => {
              const mode = liftMode(key);
              const best = liftBest(days, key, mode);
              const last = liftLast(days, key);
              const lastSet = last
                ? mode === "reps"
                  ? last.stats.longest
                  : last.stats.top
                : null;
              return (
                <li key={key}>
                  <button
                    className="st-best"
                    aria-pressed={key === chartKey}
                    onClick={() => setPicked(key)}
                  >
                    <span className="st-lift">{liftName(key)}</span>
                    <span className="st-value">
                      {fmtMetric(best?.value ?? null, mode)}
                      <em>{METRIC_LABEL[mode]}</em>
                    </span>
                    <span className="st-when">
                      {lastSet
                        ? `last ${fmtSet(lastSet, mode)} · ${fmtDate(last!.date)}`
                        : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {chartKey && (
        <div className="st-chart">
          <LiftChart series={series} mode={chartMode} label={liftName(chartKey)} />
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="eyebrow">Recent sessions</div>
          <ul className="st-list">
            {recent.map((d) => {
              const totals = dayTotals(d);
              return (
                <li key={d.date}>
                  <div className="feed-main">
                    <b>{fmtDate(d.date)}</b>
                    <span className="feed-sub">
                      {liftsDone(d)
                        .map((k) => {
                          const mode = liftMode(k);
                          const s = liftStats(d.lifts[k]);
                          const top = mode === "reps" ? s.longest : s.top;
                          return `${liftName(k)} ${top ? fmtSet(top, mode) : ""}`.trim();
                        })
                        .join(" · ") || (d.notes ? "note only" : "—")}
                    </span>
                    {d.notes && <span className="st-note">{d.notes}</span>}
                  </div>
                  <span className="st-totals">
                    {totals.sets} set{totals.sets === 1 ? "" : "s"}
                    {totals.volume > 0 && <em>{fmtVolume(totals.volume)}</em>}
                  </span>
                  {canEdit && (
                    <span className="rec-actions">
                      <button className="btn sm ghost" onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      <button className="btn sm danger" onClick={() => remove(d)}>
                        Del
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {days.length > HISTORY_SHOWN && (
            <p className="cz-note">
              Showing the last {HISTORY_SHOWN} of {days.length} sessions.
            </p>
          )}
        </>
      )}

      {editing && (
        <LiftModal
          athleteId={athleteId}
          existing={editing === "new" ? null : editing}
          date={editing === "new" ? today : editing.date}
          history={days}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            await mutate();
            setEditing(null);
            show(msg);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
