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

  const { data, error, isLoading } = useSWR<Board[]>(
    `/api/leaderboard?tracker=${tracker}&oz=${oz}`,
    fetcher,
  );

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

      {data?.map((board) => (
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
