"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ScreenOverviewRow } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import {
  dueRank,
  retestStatus,
  statusRank,
  type DueState,
  type ReportStatus,
} from "@/lib/screen";
import { daysBetween, todayISO } from "@/lib/velo";
import ScreenPanel from "./ScreenPanel";

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
        <ScreenPanel athleteId={me.athleteId} athleteName="" isCoach={false} />
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

const DUE_LABEL: Record<DueState, string> = {
  overdue: "Overdue",
  due: "Due now",
  "not-due": "",
};

/**
 * A row's place in the queue.
 *
 * Elapsed days are computed against today in the browser rather than on the
 * server, so a coach travelling doesn't see yesterday's answer.
 */
function schedule(row: ScreenOverviewRow, today: string) {
  const days = daysBetween(row.date!, today);
  return { days, ...retestStatus(row.summary!.worst, days) };
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
        .filter((r) => r.summary && r.date)
        .map((r) => ({ row: r, due: schedule(r, today) }))
        .sort(
          (a, b) =>
            dueRank(b.due.state) - dueRank(a.due.state) ||
            statusRank(b.row.summary!.worst) - statusRank(a.row.summary!.worst) ||
            // Then longest since screening, so the stalest sits above the fresh.
            b.due.days - a.due.days,
        ),
    [rows, today],
  );
  const never = useMemo(() => rows.filter((r) => !r.summary), [rows]);

  return (
    <section className="card pad tests-card">
      <div className="sec-h">
        <h3>Movement screen</h3>
        <span className="sub">Retest 4–6 weeks correcting · 8–12 weeks clean</span>
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
                  {due.state !== "not-due" && (
                    <em className={`tr-due t-${due.state}`}>
                      {DUE_LABEL[due.state]}
                    </em>
                  )}
                </span>
                <span className="tr-work">
                  {r.summary!.work > 0
                    ? `${r.summary!.work} to work on`
                    : "nothing flagged"}
                  {r.summary!.painful > 0 && (
                    <em>
                      {" · "}
                      {r.summary!.painful} painful
                    </em>
                  )}
                </span>
                <span className="tr-when">
                  {since(due.days)}
                  <em>
                    {due.state === "not-due"
                      ? `retest in ${Math.max(1, due.from - due.days)}–${due.to - due.days} days`
                      : `${due.band === "correcting" ? "4–6" : "8–12"} week retest`}
                  </em>
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
                  <span className="tr-work dim">no screen on record</span>
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
