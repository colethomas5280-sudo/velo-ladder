"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { LiftSession } from "@/lib/types";
import type { Lift } from "@/lib/strength";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  METRIC_LABEL,
  dayTotals,
  defaultLift,
  fmtMetric,
  fmtSet,
  fmtVolume,
  liftBest,
  liftLast,
  liftMenu,
  liftSeries,
  liftStats,
  liftsDone,
  liftsEverDone,
  topSet,
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
  /*
   * The menu is the coach's now, so a logged day is unreadable without it —
   * it holds keys and nothing else. Fetched alongside the log rather than
   * passed down, because every page that shows lifting needs it.
   */
  const { data: liftRows } = useSWR<Lift[]>("/api/lifts", fetcher);
  const menu = useMemo(() => liftMenu(liftRows ?? []), [liftRows]);
  const [editing, setEditing] = useState<LiftSession | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const today = todayISO();
  const todayDay = days.find((d) => d.date === today) ?? null;
  const keys = useMemo(() => liftsEverDone(menu, days), [menu, days]);
  const [picked, setPicked] = useState<string | null>(null);
  // Their main movement, until they pick something else.
  const fallback = useMemo(() => defaultLift(menu, days), [menu, days]);
  const chartKey = picked && keys.includes(picked) ? picked : fallback;
  const chartMode = chartKey ? menu.mode(chartKey) : "load";
  const series = useMemo(
    () => (chartKey ? liftSeries(menu, days, chartKey) : []),
    [menu, days, chartKey],
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
              const mode = menu.mode(key);
              const best = liftBest(menu, days, key, mode);
              const last = liftLast(menu, days, key);
              const lastSet = last ? topSet(last.stats, mode) : null;
              return (
                <li key={key}>
                  <button
                    className="st-best"
                    aria-pressed={key === chartKey}
                    onClick={() => setPicked(key)}
                  >
                    <span className="st-lift">{menu.name(key)}</span>
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
          <LiftChart series={series} mode={chartMode} label={menu.name(chartKey)} />
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="eyebrow">Recent sessions</div>
          <ul className="st-list">
            {recent.map((d) => {
              const totals = dayTotals(menu, d);
              return (
                <li key={d.date}>
                  <div className="feed-main">
                    <b>{fmtDate(d.date)}</b>
                    <span className="feed-sub">
                      {liftsDone(menu, d)
                        .map((k) => {
                          const mode = menu.mode(k);
                          const top = topSet(liftStats(d.lifts[k]), mode);
                          return `${menu.name(k)} ${top ? fmtSet(top, mode) : ""}`.trim();
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
          menu={menu}
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
