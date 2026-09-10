import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { MovementScreen, ScreenOverviewRow } from "@/lib/types";
import { withSwr } from "./testSwr";
import { daysAgo, rowOf, screenOf, TODAY } from "./testRender";
import { screenSummary } from "@/lib/screen";
import { CoachRetestPrompt, AthleteRetestPrompt } from "./RetestPrompt";

/* ------------------------------------------------------------------ *
 * The daily prompt
 *
 * Two properties carry it. It must render NOTHING when nothing is due — a
 * prompt that appears on a quiet morning is one that gets clicked through on
 * a busy one. And it must not offer a "spot-check · 16 tests", which is the
 * whole battery under the name of the thing meant to avoid it; a roster row
 * knows how many tests are failing, never which.
 * ------------------------------------------------------------------ */

const coach = (rows: ScreenOverviewRow[]) =>
  render(withSwr({ "/api/screens/overview": rows }, <CoachRetestPrompt />));

beforeEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* storage is optional */
  }
});

test("nothing due, nothing shown", () => {
  coach([rowOf()]);
  assert.equal(document.querySelector(".rp"), null, "a quiet morning stays quiet");
});

test("an in-season athlete with nothing flagged raises no prompt", () => {
  coach([rowOf({ lastFull: daysAgo(100), last: daysAgo(100), phase: "In-season" })]);
  assert.equal(document.querySelector(".rp"), null);
});

test("someone overdue raises it, and is named", () => {
  coach([rowOf({ name: "Late Athlete", lastFull: daysAgo(100), last: daysAgo(100) })]);
  assert.ok(document.querySelector(".rp"));
  assert.ok(screen.getByText("Late Athlete"));
  assert.match(document.body.textContent!, /1 athlete needs screening/i);
});

/* The bug this suite is named for. */
test("a spot-check offers the failing count, not the whole sheet", () => {
  const results = screenOf({ "hip-45.45-degree-angle:R": "less" });
  coach([
    rowOf({
      last: daysAgo(40),
      lastFull: daysAgo(40),
      summary: screenSummary(results),
      spotSince: daysAgo(40),
      spotTests: 1,
    }),
  ]);
  const body = document.body.textContent!;
  assert.match(body, /spot-check · 1 test/i);
  assert.doesNotMatch(body, /16 tests/, "it cannot name tests it does not have");
});

test("a called re-screen shows its reason instead of a clock", () => {
  coach([rowOf({ called: { since: TODAY, reason: "Back from an injury flag" } })]);
  assert.match(document.body.textContent!, /back from an injury flag/i);
});

test("dismissing it keeps it shut for the rest of the day", () => {
  coach([rowOf({ lastFull: daysAgo(100), last: daysAgo(100) })]);
  assert.ok(document.querySelector(".rp"), "open to begin with");
  // fireEvent wraps the click in act(), so React's state update settles
  // before the assertion instead of warning about it afterwards.
  fireEvent.click(screen.getByText("Not now"));
  assert.equal(document.querySelector(".rp"), null, "and shut once answered");
});

/* An athlete cannot run their own screen, so this is a heads-up, not a task. */
test("the athlete's prompt asks them to mention it, not to do it", () => {
  const screens: MovementScreen[] = [
    { id: "s1", athleteId: "a1", date: daysAgo(100), results: screenOf(), notes: "" },
  ];
  render(
    withSwr(
      {
        "/api/athletes/a1": { id: "a1", name: "Kid", hand: "R", phase: null },
        "/api/athletes/a1/screens": screens,
      },
      <AthleteRetestPrompt athleteId="a1" />,
    ),
  );
  const body = document.body.textContent!;
  assert.match(body, /mention it at your next session/i);
  assert.doesNotMatch(body, /overdue/i, "not framed as their failure");
});

test("an athlete who isn't due sees nothing", () => {
  render(
    withSwr(
      {
        "/api/athletes/a1": { id: "a1", name: "Kid", hand: "R", phase: null },
        "/api/athletes/a1/screens": [
          { id: "s1", athleteId: "a1", date: TODAY, results: screenOf(), notes: "" },
        ],
      },
      <AthleteRetestPrompt athleteId="a1" />,
    ),
  );
  assert.equal(document.querySelector(".rp"), null);
});
