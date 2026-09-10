"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { Athlete, MovementScreen, ScreenOverviewRow } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import {
  clocksFor,
  dueRank,
  needsScreening,
  screenSummary,
  standingScreen,
  type RetestDue,
} from "@/lib/screen";
import { todayISO } from "@/lib/velo";
import { useDailyPrompt } from "./useDailyPrompt";
import { callOf } from "./AthleteTests";

/* ------------------------------------------------------------------ *
 * "Who needs screening" on the way in
 *
 * Opens on the first visit of the day and stays shut once answered — see
 * `useDailyPrompt` for why it isn't every page load.
 *
 * It renders nothing at all when nothing is due, which is the property that
 * matters: a prompt that appears on a quiet morning is a prompt that gets
 * clicked through on a busy one.
 * ------------------------------------------------------------------ */

const WHAT: Record<string, string> = {
  full: "full screen",
  spot: "spot-check",
  trigger: "re-screen",
};

/**
 * `count` comes from the caller, not from `due.tests`: a clock built from a
 * roster row knows how many tests are failing, not which ones.
 */
function label(due: RetestDue, count?: number): string {
  const what = WHAT[due.kind] ?? "screen";
  if (due.kind === "spot" && count)
    return `${what} · ${count} ${count === 1 ? "test" : "tests"}`;
  return what;
}

export function CoachRetestPrompt() {
  const { data } = useSWR<ScreenOverviewRow[]>("/api/screens/overview", fetcher);
  const [open, dismiss] = useDailyPrompt("coach");
  const today = todayISO();

  const due = useMemo(() => {
    return (data ?? [])
      .map((row) => ({ row, clocks: clocksFor(row, today) }))
      .filter((x) => needsScreening(x.clocks.lead))
      .sort((a, b) => dueRank(b.clocks.lead.state) - dueRank(a.clocks.lead.state));
  }, [data, today]);

  if (!open || !due.length) return null;

  return (
    <Prompt
      title={`${due.length} ${due.length === 1 ? "athlete needs" : "athletes need"} screening`}
      onClose={dismiss}
      href="/tests"
      cta="Open Tests"
    >
      <ul className="rp-list">
        {due.slice(0, 6).map(({ row, clocks }) => (
          <li key={row.athleteId}>
            <b>{row.name}</b>
            <span>
              {row.called
                ? row.called.reason
                : `${clocks.lead.state === "overdue" ? "Overdue" : "Due"} · ${label(clocks.lead, row.spotTests)}`}
            </span>
          </li>
        ))}
      </ul>
      {due.length > 6 && (
        <p className="cz-note">and {due.length - 6} more on the Tests page.</p>
      )}
    </Prompt>
  );
}

export function AthleteRetestPrompt({ athleteId }: { athleteId: string }) {
  const { data: athlete } = useSWR<Athlete>(`/api/athletes/${athleteId}`, fetcher);
  const { data: screens } = useSWR<MovementScreen[]>(
    `/api/athletes/${athleteId}/screens`,
    fetcher,
  );
  const [open, dismiss] = useDailyPrompt(`athlete:${athleteId}`);
  const today = todayISO();

  const mine = useMemo(() => {
    if (!athlete || !screens) return null;
    const standing = standingScreen(screens);
    const summary = standing.last ? screenSummary(standing.results) : null;
    const failing = Object.entries(standing.from)
      .filter(([key]) => summary?.failing.includes(key))
      .map(([, date]) => date)
      .sort();
    const spotTests = summary?.failing.length ?? 0;
    return {
      spotTests,
      lead: clocksFor(
        {
          lastFull: standing.lastFull,
          spotSince: failing[0] ?? null,
          spotTests,
          called: callOf(athlete),
          phase: athlete.phase,
        },
        today,
      ).lead,
    };
  }, [athlete, screens, today]);

  if (!open || !mine || !needsScreening(mine.lead)) return null;

  return (
    <Prompt title="You're due a movement screen" onClose={dismiss} href="/tests" cta="See my tests">
      {/*
        * An athlete cannot run their own screen, so this is a heads-up and a
        * nudge rather than a task. Framed as what's coming, not as something
        * they have failed to do — the clock is the coach's to keep.
        */}
      <p>
        Your next <b>{label(mine.lead, mine.spotTests)}</b> is due. Mention it at
        your next session
        and your coach will run it.
      </p>
    </Prompt>
  );
}

function Prompt({
  title,
  children,
  onClose,
  href,
  cta,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  href: string;
  cta: string;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Screening due</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rp">
          <h3>{title}</h3>
          {children}
          <div className="rp-actions">
            <Link className="btn primary" href={href} onClick={onClose}>
              {cta}
            </Link>
            <button className="btn ghost" onClick={onClose}>
              Not now
            </button>
          </div>
          <span className="cz-note">Shown once a day.</span>
        </div>
      </div>
    </div>
  );
}
