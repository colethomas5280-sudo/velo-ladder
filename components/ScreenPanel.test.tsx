import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { DeliveryScreen, MovementScreen } from "@/lib/types";
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

/** A delivery (Pitching Inhibitors) assessment fixture. */
const del = (
  date: string,
  flaws: Record<string, boolean> = {},
  notes = "",
): DeliveryScreen => ({
  id: date,
  athleteId: ID,
  date,
  flaws,
  notes,
});

function panel(
  screens: MovementScreen[],
  props: Partial<Parameters<typeof ScreenPanel>[0]> = {},
  deliveries: DeliveryScreen[] = [],
) {
  return render(
    withSwr(
      {
        [`/api/athletes/${ID}/screens`]: screens,
        [`/api/athletes/${ID}/delivery`]: deliveries,
        // The screen modal, opened from this panel's chooser, asks for the
        // athlete's sessions to warn about a screen taken after throwing.
        [`/api/athletes/${ID}/sessions`]: [],
      },
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

/* ------------------------------------------------------------------ *
 * The Pitching Inhibitors report: it now reads its own record.
 *
 * The Big 12 moved off the movement-screen row onto its own record with its
 * own date (v27). Explanations still come from the movement screen, but
 * resolved against the screen as it stood on the DELIVERY assessment's
 * date, never the picked screen's — a limitation recorded before the
 * assessment explains what was watched that day; one recorded after it
 * cannot.
 * ------------------------------------------------------------------ */

test("no assessment on record says so, rather than showing an empty list", () => {
  panel([], {}, []);
  assert.match(document.body.textContent!, /no delivery assessment/i);
});

test("an assessment with nothing found reads as a result", () => {
  panel([], {}, [del(TODAY)]);
  assert.match(document.body.textContent!, /nothing found/i);
  assert.doesNotMatch(document.body.textContent!, /no delivery assessment/i);
});

test("explanations come from the screen as it stood on the assessment's date", () => {
  /*
   * A limitation recorded AFTER the delivery was watched cannot explain what
   * was seen that day: a screen dated today marking hip-45 limited cannot
   * explain a Sway marked 60 days ago.
   */
  panel(
    [scr(TODAY, screenOf({ "hip-45.45-degree-angle:R": "less" }))],
    { hand: "R" },
    [del(daysAgo(60), { sway: true })],
  );
  assert.match(document.body.textContent!, /nothing on this screen/i);
});

test("a limitation recorded before the assessment does explain it", () => {
  panel(
    [scr(daysAgo(90), screenOf({ "hip-45.45-degree-angle:R": "less" }))],
    { hand: "R" },
    [del(daysAgo(60), { sway: true })],
  );
  assert.match(document.body.textContent!, /backside hip rotation/i);
});

test("an athlete with inhibitors and no screen at all gets them all unexplained", () => {
  // Correct, and must not render as an error or a crash.
  panel([], {}, [del(TODAY, { sway: true })]);
  assert.match(document.body.textContent!, /Sway/);
  assert.match(document.body.textContent!, /nothing on this screen/i);
});

test("a marked flaw leads with Cole's own wording for the cause", () => {
  panel(
    [scr(TODAY, { "pelvic-rotation.rotation": "limited-bilateral" })],
    { hand: "R" },
    [del(TODAY, { sway: true })],
  );
  assert.match(document.body.textContent!, /Sway/);
  assert.match(document.body.textContent!, /Spine disassociation/);
});

test("a flaw nothing explains says that, instead of going quiet", () => {
  panel([scr(TODAY, {})], { hand: "R" }, [del(TODAY, { sway: true })]);
  assert.match(document.body.textContent!, /Sway/);
  assert.match(document.body.textContent!, /nothing on this screen/i);
});

/*
 * The bug this once was: DeliverySection read the picked row's own
 * `results`, while every other reader on this panel reads `standing.results`
 * — each test's own last reading, carried forward across screens. A
 * spot-check covers a few tests; the other tests are still true. Cole's
 * cadence is quarterly full screens with spot-checks every 3-4 weeks, so
 * most delivery-bearing screens ARE spot-checks, and a hip-45 limitation
 * from June must still explain Sway on a spot-check today that never re-ran
 * hip-45.
 */
test("a spot-check that skips a test still explains a flaw from its last recorded finding", () => {
  panel(
    [
      scr(daysAgo(60), screenOf({ "hip-45.45-degree-angle:R": "less" })),
      // A spot-check: only shoulder-90-90 re-run today, hip-45 not touched.
      scr(TODAY, { "shoulder-90-90.external-rotation:L": "greater" }),
    ],
    { hand: "R" },
    [del(TODAY, { sway: true })],
  );
  assert.match(document.body.textContent!, /Sway/);
  assert.match(
    document.body.textContent!,
    /Backside hip rotation/i,
    "hip 45 has been limited since the full screen and this spot-check never re-ran it",
  );
  assert.doesNotMatch(
    document.body.textContent!,
    /nothing on this screen explains this/i,
    "the athlete's own screen findings should still explain Sway",
  );
});

test("an athlete sees his own flaws, and never the coach's notes on the assessment", () => {
  panel([], { isCoach: false }, [del(TODAY, { sway: true }, "SENTINEL")]);
  assert.match(document.body.textContent!, /Sway/);
  assert.doesNotMatch(document.body.textContent!, /SENTINEL/);
});

test("a painful finding reaches the report as an alert, not a plain explanation", () => {
  panel(
    [scr(TODAY, { "pelvic-rotation.rotation": "painful" })],
    { hand: "R" },
    [del(TODAY, { sway: true })],
  );
  assert.ok(
    document.querySelector(".ms-dot.alert"),
    "a painful finding must render with the alert marker this app uses for pain everywhere else",
  );
});

test("a flaw explained by another marked flaw says which one", () => {
  panel([], { hand: "R" }, [
    del(TODAY, { "flying-open": true, "short-stride": true }),
  ]);
  assert.match(document.body.textContent!, /Also marked on this screen/i);
  assert.match(document.body.textContent!, /Short Stride/);
});

test("the causes behind the lead one are hidden until asked for", () => {
  panel(
    [
      scr(TODAY, {
        "hip-45.45-degree-angle:R": "less",
        "pelvic-rotation.rotation": "limited-bilateral",
      }),
    ],
    { hand: "R" },
    [del(TODAY, { sway: true })],
  );
  assert.doesNotMatch(
    document.body.textContent!,
    /Spine disassociation/,
    "the non-lead cause stays behind the toggle at first",
  );
  fireEvent.click(screen.getByText(/1 more possible cause/i));
  assert.match(
    document.body.textContent!,
    /Spine disassociation/,
    "and appears once the toggle is opened",
  );
});

/* ------------------------------------------------------------------ *
 * The chooser: two assessments now live behind one record button.
 * ------------------------------------------------------------------ */

test("recording asks which assessment before opening anything", () => {
  panel([]);
  fireEvent.click(screen.getByText(/record a screen/i));
  assert.match(document.body.textContent!, /movement screen/i);
  assert.match(document.body.textContent!, /pitching inhibitors/i);
});

test("choosing the movement screen opens the screen modal, not the inhibitors one", () => {
  panel([]);
  fireEvent.click(screen.getByText(/record a screen/i));
  const [screenChoice] = document.querySelectorAll(".type-card");
  fireEvent.click(screenChoice);
  assert.ok(
    document.querySelector('input[type="date"]'),
    "the screen modal's date field",
  );
  assert.equal(document.querySelector('input[name^="flaw:"]'), null);
});

test("choosing inhibitors opens the twelve, not the sixteen tests", () => {
  panel([]);
  fireEvent.click(screen.getByText(/record a screen/i));
  const [, deliveryChoice] = document.querySelectorAll(".type-card");
  fireEvent.click(deliveryChoice);
  assert.equal(
    [...document.querySelectorAll('input[name^="flaw:"]')].length,
    12,
  );
});

test("an athlete is never offered the chooser", () => {
  panel([], { isCoach: false });
  assert.equal(screen.queryByText(/record a screen/i), null);
});
