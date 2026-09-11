"use client";

import { useState } from "react";
import {
  CYCLES,
  TRACK_LABEL,
  daysOf,
  fmtRx,
  fmtRxLoad,
  rxFor,
  tracksOf,
  type ProgramCycle,
  type Track,
} from "@/lib/program";
import { liftMenu, type Lift } from "@/lib/strength";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

/* ------------------------------------------------------------------ *
 * The program, as written
 *
 * Laid out the way the sheet is — days across, tiers down, one column per
 * week — so it can be read against the original line by line. That is the
 * whole point of the page while the transcription is unchecked, and it is
 * what caught two config errors on the movement screen's reference page.
 *
 * It is also what an athlete opens to see what today asks of them, so it has
 * to survive being useful after it has been checked.
 * ------------------------------------------------------------------ */

export default function ProgramView({ cycleId }: { cycleId?: string }) {
  const cycle = CYCLES.find((c) => c.id === cycleId) ?? CYCLES[0];
  const tracks = tracksOf(cycle);
  const [track, setTrack] = useState<Track>(tracks[0]);
  // Names come from the live menu, so a lift Cole renames follows here too.
  const { data: liftRows } = useSWR<Lift[]>("/api/lifts", fetcher);
  const menu = liftMenu(liftRows ?? []);

  return (
    <>
      <div className="tests-head">
        <div className="eyebrow">{cycle.level} program</div>
        <h2>{cycle.name}</h2>
      </div>

      {!cycle.checked && <UncheckedNotice />}

      <section className="card pad pg">
        <p className="pg-notes">{cycle.notes}</p>

        {tracks.length > 1 && (
          <div className="chips" role="group" aria-label="Part of the cycle">
            {tracks.map((t) => (
              <button
                key={t}
                className="chip"
                aria-pressed={t === track}
                onClick={() => setTrack(t)}
              >
                {TRACK_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {daysOf(cycle, track).map((day) => (
          <div className="pg-day" key={`${day.track}-${day.day}`}>
            <div className="pg-day-head">
              <h3>Day {day.day}</h3>
              <span className="pg-day-sub">Total body</span>
            </div>

            {day.tiers.map((tier) => (
              <div className="pg-tier" key={tier.tier}>
                <div className="pg-tier-head">
                  <span className="eyebrow">Tier {tier.tier}</span>
                  {tier.slots.length > 1 && (
                    <span className="pg-superset">
                      superset — one set of each, in order
                    </span>
                  )}
                </div>

                <div className="scroll-x">
                  <table className="pg-table">
                    <thead>
                      <tr>
                        <th>Exercise</th>
                        {Array.from({ length: cycle.weeks }, (_, i) => i + 1).map(
                          (w) => (
                            <th key={w}>
                              Week {w}
                              {w === cycle.deloadWeek && <em>deload</em>}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {tier.slots.map((s) => (
                        <tr
                          key={s.liftKey}
                          className={s.position === 0 ? "pg-main" : undefined}
                        >
                          <th scope="row">{menu.name(s.liftKey)}</th>
                          {Array.from({ length: cycle.weeks }, (_, i) => i + 1).map(
                            (w) => {
                              const p = rxFor(s, w);
                              const load = p && fmtRxLoad(p);
                              return (
                                <td key={w}>
                                  {p ? fmtRx(p) : "–"}
                                  {load && <em>{load}</em>}
                                </td>
                              );
                            },
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

/**
 * Says plainly that nobody has checked this yet.
 *
 * Not decoration. An unchecked training program that LOOKS finished is worse
 * than one that admits it isn't — an athlete who follows a mistyped set count
 * does the wrong work for four weeks and nobody finds out until the cycle
 * ends.
 */
function UncheckedNotice() {
  return (
    <div className="card pad pg-unchecked" role="note">
      <div className="eyebrow">Not checked yet</div>
      <p>
        This was transcribed from the spreadsheet and nobody has read it back
        against the original. Check the sets and reps below line by line before
        anyone trains off it.
      </p>
    </div>
  );
}

/** Every cycle currently written down — the index, for when there are several. */
export function ProgramIndex({ cycles = CYCLES }: { cycles?: ProgramCycle[] }) {
  return (
    <ul className="tr-list">
      {cycles.map((c) => (
        <li key={c.id}>
          <a href={`/strength/program?cycle=${c.id}`} className="tr-row">
            <span className="tr-name">
              {c.level} · {c.name}
            </span>
            <span className="tr-work">
              {c.weeks} weeks
              {c.deloadWeek && ` · week ${c.deloadWeek} deload`}
            </span>
            <span className="tr-when">{c.slots.length} slots</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
