import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RECENT_DAYS, STALE_DAYS, type DashboardData } from "@/lib/dashboard";
import { CNS_WINDOW_DAYS } from "@/lib/setback";
import { withSwr } from "./testSwr";
import Dashboard from "./Dashboard";
import GuidanceCard from "./GuidanceCard";

/* ------------------------------------------------------------------ *
 * Numbers on screen that also live in config
 *
 * The Tests page once described a retest cadence that had been replaced three
 * commits earlier, because the caption was typed beside the config instead of
 * read from it. Four more places had the same arrangement — "last 7 days",
 * "14+ days", "30-day average" — all correct at the time and all one edit
 * from not being. These pin them to their source.
 * ------------------------------------------------------------------ */

const EMPTY: DashboardData = {
  leaderboard: { date: null, rows: [] },
  recentPrs: [],
  stale: [],
  pendingInvites: [],
  activity: [],
  resources: [],
  setbacks: [],
  snapshot: { athletes: 0, sessionsThisWeek: 0, activeThisWeek: 0, prsThisWeek: 0 },
};

beforeEach(cleanup);

test("the recent-PRs window is read from the config that computes it", () => {
  render(withSwr({ "/api/dashboard": EMPTY }, <Dashboard />));
  assert.ok(
    screen.getByText(new RegExp(`last ${RECENT_DAYS} days`, "i")),
    "the caption should follow RECENT_DAYS",
  );
});

test("the needs-attention window is read from the config too", () => {
  render(withSwr({ "/api/dashboard": EMPTY }, <Dashboard />));
  assert.ok(screen.getByText(new RegExp(`${STALE_DAYS}\\+ days`, "i")));
});

test("the CNS explainer quotes the window the engine actually uses", () => {
  render(
    withSwr(
      {
        "/api/athletes/a1/status": {
          guidance: { level: "clear", kind: null, title: "Green light", body: "Nothing flagged." },
          open: [],
          history: [],
          cnsThresholdPct: 5,
          cnsIsDefault: true,
        },
      },
      <GuidanceCard athleteId="a1" isCoach />,
    ),
  );
  // The band control is collapsed until a coach opens it.
  fireEvent.click(screen.getByText(/tune/i));
  assert.ok(
    screen.getByText(new RegExp(`${CNS_WINDOW_DAYS}-day average`, "i")),
    "the label should follow CNS_WINDOW_DAYS",
  );
});
