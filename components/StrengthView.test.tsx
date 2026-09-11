import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import type { StrengthOverviewRow } from "@/lib/types";
import { STRENGTH_WINDOW } from "@/lib/strength";
import { withSwr } from "./testSwr";
import { daysAgo, LIFT_ROWS, TODAY } from "./testRender";
import StrengthView from "./StrengthView";

/* ------------------------------------------------------------------ *
 * The strength roster
 *
 * The ordering is the page's whole job, and it is the opposite of the Tests
 * roster's: there, the worst athlete is the one to look at; here, it is the
 * quiet one. An athlete who lifted this morning needs nothing from a coach
 * reading this list.
 * ------------------------------------------------------------------ */

const rowOf = (over: Partial<StrengthOverviewRow> = {}): StrengthOverviewRow => ({
  athleteId: "a1",
  name: "Test Athlete",
  last: TODAY,
  recentDays: 8,
  lifts: 4,
  records: [],
  ...over,
});

const roster = (rows: StrengthOverviewRow[]) =>
  render(
    withSwr(
      {
        "/api/me": { role: "coach", athleteId: null },
        "/api/strength/overview": rows,
        "/api/lifts": LIFT_ROWS,
      },
      <StrengthView />,
    ),
  );

beforeEach(cleanup);

test("the roster leads with whoever has been quietest", () => {
  roster([
    rowOf({ athleteId: "fresh", name: "Fresh", last: TODAY }),
    rowOf({ athleteId: "quiet", name: "Quiet", last: daysAgo(40) }),
    rowOf({ athleteId: "never", name: "Never", last: null, recentDays: 0, lifts: 0 }),
  ]);
  const names = [...document.querySelectorAll(".tr-name")].map((n) => n.textContent);
  assert.deepEqual(names, ["Never", "Quiet", "Fresh"], `got ${JSON.stringify(names)}`);
});

test("an athlete who has never lifted says so rather than showing a count", () => {
  roster([rowOf({ last: null, recentDays: 0, lifts: 0 })]);
  assert.ok(screen.getByText(/nothing logged yet/i));
  assert.ok(screen.getByText(/^never$/i));
});

/*
 * "2 PRs" on its own sends a coach digging through the athlete's page for
 * which lift moved. The answer is already in the row.
 */
test("a recent record names the lift and the number", () => {
  roster([
    rowOf({
      records: [
        { key: "front-squat", date: TODAY, value: 263.2 },
        { key: "bench", date: daysAgo(3), value: 210 },
      ],
    }),
  ]);
  assert.ok(screen.getByText(/2 PRs/));
  const row = document.querySelector(".tr-row")!.textContent!;
  assert.match(row, /Front squat 263 lb/, "the newest one, spelled out");
});

test("a single record is not pluralised", () => {
  roster([rowOf({ records: [{ key: "push-up", date: TODAY, value: 12 }] })]);
  assert.ok(screen.getByText(/1 PR$/));
  assert.match(document.querySelector(".tr-row")!.textContent!, /Push-up 12 reps/);
});

test("the window in the caption comes from the config, not from beside it", () => {
  roster([rowOf()]);
  assert.match(
    screen.getByText(/last \d+ weeks/i).textContent!,
    new RegExp(`last ${STRENGTH_WINDOW / 7} weeks`, "i"),
  );
});

test("an athlete sees their own lifting and never the roster", () => {
  render(
    withSwr(
      {
        "/api/me": { role: "athlete", athleteId: "a1" },
        "/api/athletes/a1/lifts": [],
        "/api/lifts": LIFT_ROWS,
      },
      <StrengthView />,
    ),
  );
  assert.ok(screen.getByText(/my lifting/i));
  assert.equal(screen.queryByText(/personal bests and recent work/i), null);
});

test("an account with no athlete row is told what to do about it", () => {
  render(
    withSwr({ "/api/me": { role: "none", athleteId: null } }, <StrengthView />),
  );
  assert.ok(screen.getByText(/ask your coach/i));
});
