"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ScreenOverviewRow } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { statusRank, type ReportStatus } from "@/lib/screen";
import { daysBetween, fmtDate, todayISO } from "@/lib/velo";
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
function since(date: string): string {
  const days = daysBetween(date, todayISO());
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function Roster() {
  const { data, error, isLoading } = useSWR<ScreenOverviewRow[]>(
    "/api/screens/overview",
    fetcher,
  );
  const rows = useMemo(() => data ?? [], [data]);

  const screened = useMemo(
    () =>
      rows
        .filter((r) => r.summary)
        .sort(
          (a, b) =>
            statusRank(b.summary!.worst) - statusRank(a.summary!.worst) ||
            // Then longest since screening, so the stalest sits above the fresh.
            (a.date ?? "").localeCompare(b.date ?? ""),
        ),
    [rows],
  );
  const never = useMemo(() => rows.filter((r) => !r.summary), [rows]);

  return (
    <section className="card pad tests-card">
      <div className="sec-h">
        <h3>Movement screen</h3>
        <span className="sub">OnBaseU · 17 tests</span>
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
          {screened.map((r) => (
            <li key={r.athleteId}>
              <Link href={`/tests/${r.athleteId}`} className="tr-row">
                <span className={`ms-dot ${DOT[r.summary!.worst]}`} />
                <span className="tr-name">{r.name}</span>
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
                  {fmtDate(r.date!)}
                  <em>{since(r.date!)}</em>
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
