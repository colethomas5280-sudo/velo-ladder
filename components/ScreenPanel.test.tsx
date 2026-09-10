import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import type { MovementScreen } from "@/lib/types";
import { withSwr } from "./testSwr";
import { daysAgo, screenOf, TODAY } from "./testRender";
import { fmtDate } from "@/lib/velo";
import ScreenPanel from "./ScreenPanel";
import type { Results } from "@/lib/screen";

/* ------------------------------------------------------------------ *
 * The athlete's work list
 *
 * The bug this suite exists for: paging back through history recomputed the
 * athlete's retest schedule from the screen being READ, so opening August on
 * someone screened two days ago said "Overdue: full screen".
 * ------------------------------------------------------------------ */

const ID = "a1";
const scr = (date: string, results: Results, notes = ""): MovementScreen => ({
  id: date,
  athleteId: ID,
  date,
  results,
  notes,
});

function panel(screens: MovementScreen[], props: Partial<Parameters<typeof ScreenPanel>[0]> = {}) {
  return render(
    withSwr(
      { [`/api/athletes/${ID}/screens`]: screens },
      <ScreenPanel
        athleteId={ID}
        athleteName="Test Athlete"
        hand="R"
        call={null}
        phase={null}
        isCoach
        {...props}
      />,
    ),
  );
}

beforeEach(cleanup);

test("with no screens it says so rather than looking clean", () => {
  panel([]);
  assert.match(document.body.textContent!, /no screen recorded yet/i);
});

/* The reason this file exists. */
test("paging back to an old screen does not restate the schedule from it", () => {
  panel([scr(daysAgo(100), screenOf()), scr(daysAgo(2), screenOf())]);
  const meta = document.querySelector(".sc-meta")!.textContent!;
  assert.match(meta, /next full screen in/i, "screened two days ago");

  // Select the older screen.
  const pick = document.querySelector(".sc-pick") as HTMLSelectElement;
  const set = Object.getOwnPropertyDescriptor(
    pick.constructor.prototype,
    "value",
  )!.set!;
  set.call(pick, daysAgo(100));
  pick.dispatchEvent(new Event("change", { bubbles: true }));

  const after = document.querySelector(".sc-meta")!.textContent!;
  // Prove the view actually moved before asserting anything about it — a
  // select that didn't change would make the next assertion pass for free.
  assert.match(after, new RegExp(fmtDate(daysAgo(100))), `still showing: ${after}`);
  assert.doesNotMatch(after, /overdue/i, "the schedule belongs to the athlete, not the screen");
});

/* A spot-check covers three tests; the other thirteen are still true. */
test("a spot-check leaves the tests it didn't touch standing", () => {
  panel([
    scr(daysAgo(40), screenOf()),
    scr(TODAY, { "hip-45.45-degree-angle:L": "greater", "hip-45.45-degree-angle:R": "less" }),
  ]);
  const body = document.body.textContent!;
  assert.match(body, /spot-check · 1 test/i, "labelled as the partial screen it is");
  assert.match(body, /15 clean/, "the other fifteen still stand");
});

test("a full screen is labelled as one", () => {
  panel([scr(TODAY, screenOf())]);
  assert.match(document.body.textContent!, /full screen ·/i);
});

test("a gap on the non-throwing arm is shown but waived", () => {
  panel([
    scr(TODAY, screenOf({
      "shoulder-90-90.external-rotation:L": "less",
      "shoulder-90-90.external-rotation:R": "greater",
    })),
  ]);
  assert.match(document.body.textContent!, /side to side/i);
  assert.match(document.body.textContent!, /not a prerequisite for performance/i);
  assert.ok(document.querySelector(".sc-gap.optional"), "and marked as the lesser kind");
});

test("a gap on the throwing arm is not waived", () => {
  panel([
    scr(TODAY, screenOf({
      "shoulder-90-90.external-rotation:L": "greater",
      "shoulder-90-90.external-rotation:R": "less",
    })),
  ]);
  assert.equal(document.querySelector(".sc-gap.optional"), null, "that is the throwing shoulder");
});

/* A cleared deviation drops off the work list, so it needs its own line. */
test("a deviation that cleared is reported, not silently dropped", () => {
  panel([
    scr(daysAgo(40), screenOf({ "hip-45.45-degree-angle:R": "less" })),
    scr(TODAY, screenOf()),
  ]);
  const body = document.body.textContent!;
  assert.match(body, /cleared since the last check/i);
  assert.match(body, /hip 45/i);
});

test("an athlete never sees the coach's note", () => {
  panel([scr(TODAY, screenOf(), "guarding, suspect the shoulder")], { isCoach: false });
  assert.doesNotMatch(document.body.textContent!, /guarding/i);
  assert.equal(screen.queryByText(/record a screen/i), null, "nor the record button");
});

test("a coach does see it", () => {
  panel([scr(TODAY, screenOf(), "guarding, suspect the shoulder")]);
  assert.match(document.body.textContent!, /guarding/i);
});

test("a standing re-screen call is shown with its reason", () => {
  panel([scr(daysAgo(10), screenOf())], {
    call: { since: TODAY, reason: "New arm slot with Cole" },
  });
  assert.match(document.body.textContent!, /re-screen called/i);
  assert.match(document.body.textContent!, /new arm slot with cole/i);
});
