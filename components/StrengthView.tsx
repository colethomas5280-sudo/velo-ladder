"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { Athlete, StrengthOverviewRow } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import {
  STRENGTH_WINDOW,
  fmtMetric,
  liftMenu,
  type Lift,
} from "@/lib/strength";
import { daysBetween, todayISO } from "@/lib/velo";
import StrengthPanel from "./StrengthPanel";
import LiftMenuManager from "./LiftMenuManager";

/* ------------------------------------------------------------------ *
 * Strength
 *
 * A coach lands on the whole roster, quietest first, because the question a
 * roster answers is "who has stopped". An athlete lands on their own log: the
 * cross-athlete read stops at the leaderboard, and a training log is not a
 * thing to compare.
 * ------------------------------------------------------------------ */

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

export default function StrengthView() {
  const { data: me, isLoading } = useSWR<Me>("/api/me", fetcher);

  if (isLoading || !me) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading…
      </div>
    );
  }

  if (me.role === "athlete" && me.athleteId) {
    return (
      <>
        <div className="tests-head">
          <div className="eyebrow">Training</div>
          <h2>My lifting</h2>
        </div>
        <StrengthPanel athleteId={me.athleteId} canEdit />
      </>
    );
  }

  if (me.role !== "coach") {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Training</div>
        <h3>No tracker for this account</h3>
        <p>Ask your coach to add your email to the roster.</p>
      </div>
    );
  }

  return <Roster />;
}

/** "today" / "yesterday" / "3 weeks ago" — plain elapsed time, no verdict. */
function since(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function Roster() {
  const { data, error, isLoading } = useSWR<StrengthOverviewRow[]>(
    "/api/strength/overview",
    fetcher,
  );
  const rows = useMemo(() => data ?? [], [data]);
  // Records come back as lift KEYS; the menu is what turns them into names.
  const { data: liftRows, mutate: mutateLifts } = useSWR<Lift[]>(
    "/api/lifts",
    fetcher,
  );
  const menu = useMemo(() => liftMenu(liftRows ?? []), [liftRows]);
  const today = todayISO();

  /*
   * Longest-idle first. The athlete who lifted this morning needs nothing
   * from a coach reading this list; the one who hasn't logged since August
   * is either hurt, busy, or has quietly stopped, and that is the row worth
   * the coach's attention. Never lifted sorts to the very top.
   *
   * Elapsed days are worked out here against the viewer's own today, not on
   * the server — the same reason the Tests roster does it in the browser.
   */
  const sorted = useMemo(
    () =>
      [...rows]
        .map((r) => ({
          row: r,
          idle: r.last === null ? null : daysBetween(r.last, today),
        }))
        .sort(
          (a, b) =>
            (b.idle ?? Number.MAX_SAFE_INTEGER) - (a.idle ?? Number.MAX_SAFE_INTEGER) ||
            a.row.name.localeCompare(b.row.name),
        ),
    [rows, today],
  );

  return (
    <section className="card pad tests-card">
      <div className="sec-h">
        <h3>Lifting</h3>
        <div className="sub sr-sub">
          <span>Personal bests and recent work, last {STRENGTH_WINDOW / 7} weeks</span>
        </div>
      </div>

      <LiftMenuManager lifts={liftRows ?? []} mutate={mutateLifts} />

      {isLoading && <p className="widget-empty">Loading…</p>}
      {error != null && (
        <p className="form-error" role="alert">
          Couldn&rsquo;t load the roster. Reload the page.
        </p>
      )}

      {!isLoading && rows.length === 0 && (
        <p className="widget-empty">
          No athletes on the roster yet. Add one and their lifting shows up here.
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="tr-list">
          {sorted.map(({ row: r, idle }) => (
            <li key={r.athleteId}>
              <Link href={`/strength/${r.athleteId}`} className="tr-row">
                <span className="tr-name">
                  {r.name}
                  {r.records.length > 0 && (
                    <em className="tr-due t-pr">
                      {r.records.length} PR{r.records.length === 1 ? "" : "s"}
                    </em>
                  )}
                </span>
                <span className="tr-work">
                  {r.last === null
                    ? "nothing logged yet"
                    : `${r.recentDays} session${r.recentDays === 1 ? "" : "s"} in ${STRENGTH_WINDOW / 7} weeks · ${r.lifts} lift${r.lifts === 1 ? "" : "s"}`}
                  {/*
                    * The newest record, named. "2 PRs" alone sends a coach
                    * digging for which lift moved; the answer is already here.
                    */}
                  {r.records[0] && (
                    <em>
                      {" · "}
                      {menu.name(r.records[0].key)}{" "}
                      {fmtMetric(r.records[0].value, menu.mode(r.records[0].key))}
                    </em>
                  )}
                </span>
                <span className="tr-when">
                  {idle === null ? "never" : since(idle)}
                  <em>{idle === null ? "no sessions on record" : "last lifted"}</em>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One athlete's lifting, reached from the roster or from their profile. */
export function AthleteStrength({ athleteId }: { athleteId: string }) {
  const { data: me } = useSWR<Me>("/api/me", fetcher);
  const { data: athlete } = useSWR<Athlete>(
    `/api/athletes/${athleteId}`,
    fetcher,
  );
  const isCoach = me?.role === "coach";

  return (
    <>
      <div className="tests-head">
        {isCoach && (
          <Link href="/strength" className="back-link">
            ← All athletes
          </Link>
        )}
        <div className="eyebrow">Training</div>
        <h2>{athlete?.name ?? "…"}</h2>
      </div>
      <StrengthPanel
        athleteId={athleteId}
        canEdit={isCoach || me?.athleteId === athleteId}
      />
    </>
  );
}
