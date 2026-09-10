"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { Athlete, ScreenOverviewRow } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import {
  RETEST_CADENCE,
  clocksFor,
  dueRank,
  retestState,
  statusRank,
  type ReportStatus,
  type RetestKind,
} from "@/lib/screen";
import { todayISO } from "@/lib/velo";
import ScreenPanel from "./ScreenPanel";
import { handOf, callOf } from "./AthleteTests";

/* ------------------------------------------------------------------ *
 * Tests
 *
 * The home for anything we measure that isn't a throw. One test lives here so
 * far — the OnBaseU movement screen — and the page is built as a list of
 * tests rather than as the screen, so the second one is an entry rather than
 * a rewrite.
 *
 * A coach lands on the whole roster, worst first, because the question a
 * roster answers is "who needs me". An athlete lands on their own tests: the
 * cross-athlete read stops at the leaderboard, and a work list is not a
 * thing to compare.
 * ------------------------------------------------------------------ */

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

export default function TestsView() {
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
          <div className="eyebrow">Testing</div>
          <h2>My tests</h2>
        </div>
        <MyTests athleteId={me.athleteId} />
      </>
    );
  }

  if (me.role !== "coach") {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Testing</div>
        <h3>No tracker for this account</h3>
        <p>Ask your coach to add your email to the roster.</p>
      </div>
    );
  }

  return <Roster />;
}

const DOT: Record<ReportStatus, string> = {
  alert: "alert",
  red: "red",
  yellow: "yellow",
  ungraded: "none",
  clean: "green",
  skipped: "none",
};

/** "today" / "yesterday" / "3 weeks ago" — plain elapsed time, no verdict. */
function since(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** A cadence in whole weeks, from the config that enforces it. */
function weeks(kind: "full" | "spot"): number {
  return RETEST_CADENCE[kind] / 7;
}

const KIND_LABEL: Record<RetestKind, string> = {
  full: "Full screen",
  spot: "Spot-check",
  trigger: "Re-screen",
};

/**
 * A row's place in the queue.
 *
 * Two clocks, and whichever is more pressing speaks for the row. An athlete
 * mid-quarter with a spot-check three weeks late is a spot-check three weeks
 * late — reporting the quarterly clock because it is the bigger job would
 * bury the thing there is actually something to do about.
 *
 * Elapsed days are computed against today in the browser rather than on the
 * server, so a coach travelling doesn't see yesterday's answer.
 */
const schedule = (row: ScreenOverviewRow, today: string) =>
  clocksFor(row, today);

/** "due in 12 days" / "4-week spot-check" — the clock in words. */
function describe(due: ReturnType<typeof retestState>): string {
  if (due.kind === "trigger") return "called, regardless of the clock";
  if (due.state === "paused") return "in-season · spot-checks only";
  if (due.days === null) return "no full screen on record";
  if (due.state === "not-due")
    return `due in ${due.every - due.days} days`;
  return due.kind === "spot"
    ? `${RETEST_CADENCE.spot / 7}-week spot-check`
    : `${RETEST_CADENCE.full / 7}-week full screen`;
}

/** An athlete's own tests. Fetches their row for the throwing hand. */
function MyTests({ athleteId }: { athleteId: string }) {
  const { data } = useSWR<Athlete>(`/api/athletes/${athleteId}`, fetcher);
  return (
    <ScreenPanel
      athleteId={athleteId}
      athleteName={data?.name ?? ""}
      hand={handOf(data?.hand)}
      call={callOf(data)}
      phase={data?.phase ?? null}
      isCoach={false}
    />
  );
}

function Roster() {
  const { data, error, isLoading } = useSWR<ScreenOverviewRow[]>(
    "/api/screens/overview",
    fetcher,
  );
  const rows = useMemo(() => data ?? [], [data]);

  /*
   * Sorted by when they're needed, then by how bad it is.
   *
   * Severity alone put a red athlete screened yesterday above a clean one
   * nobody has seen in four months, which reads as urgent and isn't — there
   * is nothing to do about that red today. The dot still carries severity, so
   * nothing is hidden by ordering on the schedule instead.
   */
  const today = todayISO();
  const screened = useMemo(
    () =>
      rows
        .filter((r) => r.summary && r.last)
        .map((r) => ({ row: r, due: schedule(r, today) }))
        .sort(
          (a, b) =>
            dueRank(b.due.lead.state) - dueRank(a.due.lead.state) ||
            statusRank(b.row.summary!.worst) - statusRank(a.row.summary!.worst) ||
            // Then longest since screening, so the stalest sits above the fresh.
            (a.row.last ?? "").localeCompare(b.row.last ?? ""),
        ),
    [rows, today],
  );
  const never = useMemo(() => rows.filter((r) => !r.summary), [rows]);

  return (
    <section className="card pad tests-card">
      <div className="sec-h">
        <h3>Movement screen</h3>
        <div className="sub sr-sub">
          {/*
            * Read off RETEST_CADENCE rather than typed. The line that used to
            * sit here was typed, and went on describing the first cadence for
            * three commits after that cadence was replaced.
            */}
          <span>
            Full screen every {weeks("full")} weeks · spot-check every{" "}
            {weeks("spot")}
          </span>
          <Link href="/tests/reference">What each test grades →</Link>
        </div>
      </div>

      {isLoading && <p className="widget-empty">Loading…</p>}
      {error != null && (
        <p className="form-error" role="alert">
          Couldn&rsquo;t load the roster. Reload the page.
        </p>
      )}

      {!isLoading && rows.length === 0 && (
        <p className="widget-empty">
          No athletes on the roster yet. Add one and their screen shows up here.
        </p>
      )}

      {screened.length > 0 && (
        <ul className="tr-list">
          {screened.map(({ row: r, due }) => (
            <li key={r.athleteId}>
              <Link href={`/tests/${r.athleteId}`} className="tr-row">
                <span className={`ms-dot ${DOT[r.summary!.worst]}`} />
                <span className="tr-name">
                  {r.name}
                  {/*
                    * Nothing to badge when the clock is not-due or paused:
                    * "Due · Full screen" beside "in-season, spot-checks only"
                    * is the page arguing with itself.
                    */}
                  {due.lead.state !== "not-due" && due.lead.state !== "paused" && (
                    <em
                      className={`tr-due t-${
                        due.lead.kind === "trigger" ? "called" : due.lead.state
                      }`}
                    >
                      {due.lead.kind === "trigger"
                        ? "Re-screen called"
                        : `${due.lead.state === "overdue" ? "Overdue" : "Due"} · ${KIND_LABEL[due.lead.kind]}`}
                    </em>
                  )}
                </span>
                <span className="tr-work">
                  {r.summary!.work > 0
                    ? `${r.summary!.work} to work on`
                    : "nothing flagged"}
                  {r.summary!.asymmetries > 0 &&
                    ` · ${r.summary!.asymmetries} side gap${r.summary!.asymmetries === 1 ? "" : "s"}`}
                  {r.summary!.optionalAsymmetries > 0 &&
                    ` · ${r.summary!.optionalAsymmetries} arm gap${r.summary!.optionalAsymmetries === 1 ? "" : "s"} (fyi)`}
                  {r.summary!.painful > 0 && (
                    <em>
                      {" · "}
                      {r.summary!.painful} painful
                    </em>
                  )}
                </span>
                <span className="tr-when">
                  {due.lead.days === null
                    ? "never"
                    : since(due.lead.days)}
                  <em>{r.called ? r.called.reason : describe(due.lead)}</em>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {never.length > 0 && (
        <div className="tests-never">
          <div className="eyebrow">Not screened yet</div>
          <ul className="tr-list">
            {never.map((r) => (
              <li key={r.athleteId}>
                <Link href={`/tests/${r.athleteId}`} className="tr-row">
                  <span className="ms-dot none" />
                  <span className="tr-name">{r.name}</span>
                  {/*
                    * A re-screen can be called on someone never screened —
                    * moving them to In-season, say. The row carried it and
                    * threw it away, which lost the only reason attached to
                    * an otherwise anonymous "record one".
                    */}
                  <span className="tr-work dim">
                    {r.called ? r.called.reason : "no screen on record"}
                  </span>
                  <span className="tr-when dim">Record one →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
