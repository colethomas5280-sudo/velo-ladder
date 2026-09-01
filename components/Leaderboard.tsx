"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, ApiError } from "@/lib/fetcher";
import { TRACKERS, TRACKER_IDS, fmt, fmtDate } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";
import type { Board } from "@/lib/leaderboard";

const OZ = [5, 6, 7, 4, 3]; // ladder order, not numeric

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export default function Leaderboard() {
  const [tracker, setTracker] = useState<TrackerId>("mound");
  const [oz, setOz] = useState(5);
  // null = the athlete has not chosen yet, so their own group is used
  const [group, setGroup] = useState<string | null>(null);

  const { data, error, isLoading } = useSWR<Board[]>(
    `/api/leaderboard?tracker=${tracker}&oz=${oz}`,
    fetcher,
  );

  /*
   * Filter client-side: the response already carries every board, so changing
   * group costs no round trip.
   *
   * The chosen group can vanish underneath you — filter to College, switch to a
   * weight nobody at College has thrown, and that board is simply absent from
   * the next response. Falling back to "all" here (rather than resetting state
   * in an effect) keeps the picker honest about what is on screen without a
   * cascading render.
   */
  const boards = data ?? [];

  /*
   * An athlete lands on his own group rather than the top of the building, so
   * the first thing he sees is the board he is actually competing on. Derived
   * rather than assigned in an effect: `group` stays null until he picks
   * something, and any explicit choice — including "all" — wins from then on.
   *
   * `you` covers the athlete ranked below the visible rows: he is still in that
   * band even with no row of his own. A coach matches nothing here and falls
   * through to all boards, which is what a coach wants.
   */
  const ownGroup = boards.find(
    (b) => b.key !== "facility" && (b.you != null || b.rows.some((r) => r.isYou)),
  )?.key;
  const chosen = group ?? ownGroup ?? "all";
  const shownGroup = boards.some((b) => b.key === chosen) ? chosen : "all";
  const visible =
    shownGroup === "all" ? boards : boards.filter((b) => b.key === shownGroup);

  return (
    <div className="lb">
      <div className="view-switch">
        <span className="eyebrow">Records</span>
        <div className="seg" role="group" aria-label="Tracker">
          {TRACKER_IDS.map((t) => (
            <button key={t} aria-pressed={tracker === t} onClick={() => setTracker(t)}>
              {TRACKERS[t].label}
            </button>
          ))}
        </div>

        {boards.length > 1 && (
          <select
            className="lb-filter"
            aria-label="Group"
            value={shownGroup}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">All boards</option>
            {boards.map((b) => (
              <option key={b.key} value={b.key}>
                {b.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="chips">
        {OZ.map((w) => (
          <button key={w} className="chip" aria-pressed={w === oz} onClick={() => setOz(w)}>
            {w} oz
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error instanceof ApiError ? error.message : "Couldn't load the leaderboard."}
        </p>
      )}

      {isLoading && <p className="widget-empty">Loading…</p>}

      {!isLoading && !error && !data?.length && (
        <p className="widget-empty">
          No 100% throws logged at this weight yet. Records show up here as soon as
          someone logs a session.
        </p>
      )}

      {visible.map((board) => (
        <section className="card pad lb-board" key={board.key}>
          <div className="sec-h">
            <h3>{board.title}</h3>
            <span className="sub">
              {TRACKERS[tracker].label} · {oz} oz
            </span>
          </div>

          <div className="lb-scroll">
            <table className="lb-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Athlete</th>
                  <th scope="col">Level</th>
                  <th scope="col">Hand</th>
                  <th scope="col">Velo</th>
                  <th scope="col">Set</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r) => (
                  <tr key={r.rank} className={r.isYou ? "is-you" : undefined}>
                    <td className="lb-rank">{r.rank}</td>
                    <td>
                      {r.name}
                      {r.isYou && <span className="lb-you">you</span>}
                    </td>
                    <td className="lb-dim">{r.band ?? "–"}</td>
                    <td className="lb-dim">{r.hand || "–"}</td>
                    <td className="lb-velo">{fmt(r.velocity)}</td>
                    <td className="lb-dim">{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {board.you && (
            <p className="lb-standing">
              You&apos;re {ordinal(board.you.rank)} — <b>{fmt(board.you.velocity)}</b>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
