import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import type { LiftSession } from "@/lib/types";
import { e1rm } from "@/lib/strength";
import { withSwr } from "./testSwr";
import { daysAgo, LIFT_ROWS, TODAY } from "./testRender";
import StrengthPanel from "./StrengthPanel";

/* ------------------------------------------------------------------ *
 * One athlete's lifting
 *
 * The panel derives every number it shows. These tests are mostly about it
 * deriving the RIGHT one — the estimated max off the best set rather than the
 * heaviest, reps rather than pounds on a chin-up — and about the read-only
 * case, where a coach's page must not offer an athlete's buttons.
 * ------------------------------------------------------------------ */

let n = 0;
const day = (date: string, lifts: LiftSession["lifts"], notes = ""): LiftSession => ({
  id: `d${n++}`,
  athleteId: "a1",
  date,
  lifts,
  notes,
  level: null,
});

const panel = (days: LiftSession[], canEdit = true) =>
  render(
    withSwr(
      { "/api/athletes/a1/lifts": days, "/api/lifts": LIFT_ROWS },
      <StrengthPanel athleteId="a1" canEdit={canEdit} />,
    ),
  );

beforeEach(cleanup);

test("nothing logged yet says so instead of showing an empty board", () => {
  panel([]);
  assert.ok(screen.getByText(/nothing logged yet/i));
  assert.equal(document.querySelector(".st-bests"), null);
});

test("a lift's best is the estimated max, taken off the best set", () => {
  panel([
    day(daysAgo(7), { "back-squat": [{ w: 245, r: 1 }, { w: 225, r: 8 }] }),
  ]);
  const tile = document.querySelector(".st-best")!.textContent!;
  assert.match(tile, /Back squat/);
  assert.match(
    tile,
    new RegExp(`${Math.round(e1rm(225, 8)!)} lb`),
    "the back-off set says more than the grinding single",
  );
  assert.match(tile, /Est\. 1RM/i);
});

test("a bodyweight lift is read in reps, not in pounds", () => {
  panel([day(daysAgo(3), { "chin-up": [{ w: 45, r: 3 }, { w: 0, r: 12 }] })]);
  const tile = document.querySelector(".st-best")!.textContent!;
  assert.match(tile, /12 reps/, "the longest set, not the heaviest");
  assert.match(tile, /Top set reps/i);
  assert.match(tile, /last BW × 12/);
});

test("added load on a bodyweight lift reads as added", () => {
  panel([day(daysAgo(3), { "chin-up": [{ w: 25, r: 10 }] })]);
  assert.match(document.querySelector(".st-best")!.textContent!, /BW\+25 × 10/);
});

test("the session list totals the day's work", () => {
  panel([
    day(daysAgo(1), {
      "back-squat": [{ w: 225, r: 5 }, { w: 225, r: 5 }],
      "bench-press": [{ w: 185, r: 5 }],
    }),
  ]);
  const row = document.querySelector(".st-list li")!.textContent!;
  assert.match(row, /3 sets/);
  assert.match(row, /3,175 lb/, "volume, grouped");
  assert.match(row, /Back squat 225 × 5/);
});

test("a session with only a note still shows the note", () => {
  panel([day(daysAgo(1), {}, "Deload week — no lifting")]);
  assert.ok(screen.getByText(/deload week/i));
  assert.match(document.querySelector(".st-list li")!.textContent!, /note only/);
});

/*
 * A coach looking at an athlete's page can edit; anyone who can only read
 * must not be offered a button that would 403. The panel is the only thing
 * that knows which it is.
 */
test("a read-only panel offers no way to write", () => {
  panel([day(daysAgo(1), { "back-squat": [{ w: 225, r: 5 }] })], false);
  assert.equal(screen.queryByText(/log today's lifting/i), null);
  assert.equal(screen.queryByText(/^Edit$/), null);
  assert.equal(screen.queryByText(/^Del$/), null);
});

test("an editable panel offers to log today, or to edit today once it exists", () => {
  panel([day(daysAgo(1), { "back-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/\+ Log today's lifting/i));

  cleanup();
  panel([day(TODAY, { "back-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/edit today's lifting/i));
});

test("the chart needs two sessions before it draws a line", () => {
  panel([day(daysAgo(9), { "back-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/the line starts at two/i));
  assert.equal(document.querySelector(".lc-line"), null);

  cleanup();
  panel([
    day(daysAgo(9), { "back-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(2), { "back-squat": [{ w: 245, r: 5 }] }),
  ]);
  assert.ok(document.querySelector(".lc-line"), "two points is a line");
  assert.equal(
    document.querySelectorAll(".lc-dot").length,
    2,
    "one dot per session",
  );
  assert.equal(
    document.querySelectorAll(".lc-dot.lc-rec").length,
    1,
    "and the second is the record, the first is not",
  );
});

/*
 * Found by using the page, not by reading it. Config order put a trap-bar
 * deadlift done once above a back squat with five sessions, so the chart
 * opened on "the line starts at two" while the athlete's main lift sat
 * unshown behind the picker.
 */
test("the chart opens on the lift with the most behind it, not the first on the menu", () => {
  panel([
    day(daysAgo(60), { "trap-bar-deadlift": [{ w: 315, r: 5 }], "back-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(30), { "back-squat": [{ w: 245, r: 5 }] }),
    day(daysAgo(5), { "back-squat": [{ w: 255, r: 5 }] }),
  ]);
  assert.match(document.querySelector(".lc-foot")!.textContent!, /Back squat/);
  assert.equal(screen.queryByText(/the line starts at two/i), null);
  // The trap bar is still on the board, just not leading the chart.
  assert.ok(screen.getByText("Trap bar deadlift"));
});

test("a session the chart can't plot is still counted as a session done", () => {
  panel([
    day(daysAgo(20), { "back-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(10), { "back-squat": [{ w: 135, r: 20 }] }), // too long to estimate from
    day(daysAgo(2), { "back-squat": [{ w: 245, r: 5 }] }),
  ]);
  assert.match(
    document.querySelector(".lc-foot")!.textContent!,
    /2 of 3 sessions plotted/,
    "not '2 sessions' — he squatted three times",
  );
});
