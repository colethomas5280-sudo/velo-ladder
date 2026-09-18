import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { RETEST_CADENCE, screenSummary } from "@/lib/screen";
import type { DeliveryOverviewRow, ScreenOverviewRow } from "@/lib/types";
import { withSwr } from "./testSwr";
import { daysAgo, deliveryRowOf, rowOf, screenOf, TODAY } from "./testRender";
import TestsView from "./TestsView";

/* ------------------------------------------------------------------ *
 * The Tests roster
 *
 * Four bugs have shipped from this component, and each is a test below: a
 * cadence caption still describing a policy replaced three commits earlier,
 * a "DUE · FULL SCREEN" badge on a row that also said the clock was paused,
 * a spot-check offering "16 tests" when the row knew only the count, and a
 * re-screen reason carried to a never-screened row and then dropped.
 * ------------------------------------------------------------------ */

const roster = (rows: ScreenOverviewRow[], deliveries: DeliveryOverviewRow[] = []) =>
  render(
    withSwr(
      {
        "/api/me": { role: "coach", athleteId: null },
        "/api/screens/overview": rows,
        "/api/delivery/overview": deliveries,
      },
      <TestsView />,
    ),
  );

beforeEach(cleanup);

test("the cadence caption comes from the config, not from beside it", () => {
  roster([rowOf()]);
  const sub = screen.getByText(/full screen every/i).textContent!;
  assert.match(sub, new RegExp(`every ${RETEST_CADENCE.full / 7} weeks`, "i"));
  assert.match(sub, new RegExp(`every ${RETEST_CADENCE.spot / 7}`, "i"));
});

test("an in-season row is not badged as due", () => {
  roster([
    rowOf({ name: "Kid", lastFull: daysAgo(100), last: daysAgo(100), phase: "In-season" }),
  ]);
  assert.ok(screen.getByText(/in-season · spot-checks only/i));
  assert.equal(screen.queryByText(/overdue|due ·/i), null, "nothing is being asked of him");
});

test("an athlete past the interval is badged overdue", () => {
  roster([rowOf({ lastFull: daysAgo(100), last: daysAgo(100) })]);
  assert.ok(screen.getByText(/overdue/i));
});

test("a row with work names the count and the clock it is on", () => {
  const results = screenOf({ "hip-45.45-degree-angle:R": "less" });
  roster([
    rowOf({
      last: daysAgo(40),
      lastFull: daysAgo(40),
      summary: screenSummary(results),
      spotSince: daysAgo(40),
      spotTests: 1,
    }),
  ]);
  // Scoped to the row: the page caption also says "spot-check".
  const badge = document.querySelector(".tr-due")!.textContent!;
  assert.match(badge, /spot-check/i, "the spot clock is the one that came round");
  assert.match(document.querySelector(".tr-row")!.textContent!, /1 to work on/);
});

test("a re-screen called on a never-screened athlete says why", () => {
  roster([
    rowOf({
      name: "Never Screened",
      last: null,
      lastFull: null,
      summary: null,
      called: { since: TODAY, reason: "New arm slot" },
    }),
  ]);
  assert.ok(screen.getByText(/not screened yet/i));
  assert.ok(screen.getByText(/new arm slot/i), "the reason was carried, so show it");
});

test("a called re-screen leads a row over its clocks", () => {
  roster([rowOf({ called: { since: TODAY, reason: "Moved to Build" } })]);
  assert.ok(screen.getByText(/re-screen called/i));
  assert.ok(screen.getByText(/moved to build/i));
});

test("an athlete with nothing due says so quietly", () => {
  roster([rowOf()]);
  assert.ok(screen.getByText(/nothing flagged/i));
  assert.equal(screen.queryByText(/overdue/i), null);
});

/*
 * Ordering is the page's whole job, and the two candidate rules disagree
 * here: "Flagged" is the worse athlete, "Late" is the one there is something
 * to do about. Sorting by severity would put Flagged first, and a coach would
 * be pulled towards a screen taken this morning.
 */
test("the roster leads with what is due, not with who is worst", () => {
  const red = screenOf({ "hip-45.45-degree-angle:R": "less" });
  roster([
    rowOf({
      athleteId: "flagged",
      name: "Flagged",
      summary: screenSummary(red),
      spotSince: TODAY,
      spotTests: 1,
    }),
    rowOf({ athleteId: "late", name: "Late", lastFull: daysAgo(100), last: daysAgo(100) }),
  ]);
  const names = [...document.querySelectorAll(".tr-name")].map((n) => n.textContent);
  assert.equal(names[0]?.startsWith("Late"), true, `got ${JSON.stringify(names)}`);
});

test("an athlete sees their own tests and never the roster", () => {
  render(
    withSwr(
      {
        "/api/me": { role: "athlete", athleteId: "a1" },
        "/api/athletes/a1": { id: "a1", name: "Kid", hand: "R", phase: null },
        "/api/athletes/a1/screens": [],
      },
      <TestsView />,
    ),
  );
  assert.ok(screen.getByText(/my tests/i));
  assert.equal(screen.queryByText(/full screen every/i), null, "no roster caption");
});

test("the screen card no longer carries a delivery line", () => {
  /*
   * It lived there while the two shared a record. Saying it in two places is
   * how two views drift into disagreeing about the same athlete.
   */
  roster([rowOf()]);
  assert.doesNotMatch(document.body.textContent!, /delivery not assessed/i);
});

/* ------------------------------------------------------------------ *
 * Pitching Inhibitors
 *
 * Its own card, its own record (delivery_screens), and its own clock — see
 * the note above about why the movement screen's row no longer says this.
 * ------------------------------------------------------------------ */

test("an athlete never assessed is listed as not assessed yet, not as clean", () => {
  roster([rowOf()], [deliveryRowOf({ last: null, count: 0 })]);
  assert.match(document.body.textContent!, /not assessed yet/i);
  assert.doesNotMatch(document.body.textContent!, /no inhibitors/i);
});

test("an assessment with nothing found reads as a result", () => {
  roster([rowOf()], [deliveryRowOf({ last: TODAY, count: 0 })]);
  assert.match(document.body.textContent!, /no inhibitors/i);
});

test("marks are counted, and one is not called 1 inhibitors", () => {
  roster([rowOf()], [deliveryRowOf({ last: TODAY, count: 1 })]);
  assert.match(document.body.textContent!, /1 inhibitor(?!s)/i);
});

/*
 * Mutates the shared constant rather than just re-deriving the expected
 * number from it: RETEST_CADENCE.full / 7 is 8 today, so a caption that
 * merely typed "8" would pass a test that compared against that same
 * arithmetic. Changing the constant to a value that ISN'T 8 makes a typed
 * "8" and a genuinely computed one diverge, which is the only way to catch
 * the bug this guards against — see the movement screen's own cadence
 * caption note above about a typed number outliving the config it once
 * matched.
 */
test("the clock is the 8-week one, from the config", () => {
  const original = RETEST_CADENCE.full;
  try {
    RETEST_CADENCE.full = 70;
    roster([rowOf()], [deliveryRowOf({ last: TODAY, count: 0 })]);
    const sub = screen.getByText(/checked every/i).textContent!;
    assert.match(sub, new RegExp(`every ${RETEST_CADENCE.full / 7} weeks`, "i"));
  } finally {
    RETEST_CADENCE.full = original;
  }
});

test("an assessment older than the cadence is flagged", () => {
  roster(
    [rowOf()],
    [deliveryRowOf({ last: daysAgo(RETEST_CADENCE.full + 7), count: 0 })],
  );
  const badges = [...document.querySelectorAll(".tr-due")];
  assert.ok(
    badges.some((b) => /overdue/i.test(b.textContent ?? "")),
    "an overdue badge is shown",
  );
});
