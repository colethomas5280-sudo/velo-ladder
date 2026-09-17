import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { DashboardData } from "@/lib/dashboard";
import { RECENT_DAYS, STALE_DAYS } from "@/lib/types";
import { CNS_WINDOW_DAYS } from "@/lib/setback";
import { screenSummary } from "@/lib/screen";
import { withSwr } from "./testSwr";
import { daysAgo, rowOf, screenOf, TODAY } from "./testRender";
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
  setbacks: [],
  snapshot: { athletes: 0, sessionsThisWeek: 0, activeThisWeek: 0, prsThisWeek: 0 },
};

beforeEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* storage is optional */
  }
});

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

/* ------------------------------------------------------------------ *
 * Screening due
 *
 * Used to be a once-a-day popup over the whole dashboard; it's a standing
 * card now, in the Resources card's old spot, so there's no dismiss
 * behavior left to test — only the same due/overdue/spot-check/called
 * logic the popup used to carry.
 * ------------------------------------------------------------------ */

test("nobody due, the card says so quietly", () => {
  render(
    withSwr(
      { "/api/dashboard": EMPTY, "/api/screens/overview": [rowOf()] },
      <Dashboard />,
    ),
  );
  assert.ok(screen.getByText(/nobody.*due for a screen/i));
});

test("someone overdue is named on the card", () => {
  render(
    withSwr(
      {
        "/api/dashboard": EMPTY,
        "/api/screens/overview": [
          rowOf({ name: "Late Athlete", lastFull: daysAgo(100), last: daysAgo(100) }),
        ],
      },
      <Dashboard />,
    ),
  );
  assert.ok(screen.getByText("Late Athlete"));
  assert.ok(screen.getByText(/overdue/i));
});

/* The bug this suite is named for. */
test("a spot-check offers the failing count, not the whole sheet", () => {
  const results = screenOf({ "hip-45.45-degree-angle:R": "less" });
  render(
    withSwr(
      {
        "/api/dashboard": EMPTY,
        "/api/screens/overview": [
          rowOf({
            last: daysAgo(40),
            lastFull: daysAgo(40),
            summary: screenSummary(results),
            spotSince: daysAgo(40),
            spotTests: 1,
          }),
        ],
      },
      <Dashboard />,
    ),
  );
  const body = document.body.textContent!;
  assert.match(body, /spot-check · 1 test/i);
  assert.doesNotMatch(body, /16 tests/, "it cannot name tests it does not have");
});

test("a called re-screen shows its reason instead of a clock", () => {
  render(
    withSwr(
      {
        "/api/dashboard": EMPTY,
        "/api/screens/overview": [
          rowOf({ called: { since: TODAY, reason: "Back from an injury flag" } }),
        ],
      },
      <Dashboard />,
    ),
  );
  assert.match(document.body.textContent!, /back from an injury flag/i);
});
