import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRENGTH_STANDARDS,
  bodyWeightOn,
  fmtRatio,
  fmtTarget,
  progressTo,
  relativeStrength,
  type Standard,
} from "@/lib/relative";
import { liftMenu, seedLifts, type DatedLifts, type LiftSet } from "@/lib/strength";
import type { RecoveryEntry } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Relative strength
 *
 * The number Cole built this for, so the tests are about it being honest
 * rather than flattering: the right bodyweight, from the right time, and no
 * ratio at all where there is nothing to divide.
 * ------------------------------------------------------------------ */

const MENU = liftMenu(seedLifts());
const set = (w: number, r: number): LiftSet => ({ w, r });
const day = (date: string, lifts: Record<string, LiftSet[]>): DatedLifts => ({ date, lifts });
const weighIn = (date: string, lb: number): RecoveryEntry =>
  ({ date, bodyWeight: lb }) as RecoveryEntry;

/* ---------------- the denominator ---------------- */

test("bodyweight is averaged across the readings near the date", () => {
  const w = bodyWeightOn(
    [weighIn("2026-09-01", 180), weighIn("2026-09-03", 184), weighIn("2026-09-05", 182)],
    "2026-09-03",
    null,
  )!;
  assert.equal(w.lb, 182);
  assert.equal(w.n, 3);
  assert.equal(w.from, "checkins");
});

/*
 * A single morning weigh-in swings two or three pounds on food and hydration
 * alone. A ratio built on one moves without the athlete touching a barbell,
 * which is exactly what the recovery card already refuses to do.
 */
test("one heavy morning does not move the number much", () => {
  const steady = [weighIn("2026-09-01", 180), weighIn("2026-09-02", 180), weighIn("2026-09-03", 180)];
  const spiked = [...steady, weighIn("2026-09-04", 189)];
  const a = bodyWeightOn(steady, "2026-09-03", null)!.lb;
  const b = bodyWeightOn(spiked, "2026-09-03", null)!.lb;
  assert.ok(Math.abs(b - a) < 3, `moved ${b - a} lb on one reading`);
});

/*
 * The weight from AROUND THE LIFT, not today's. An athlete who squatted at
 * 170 and now weighs 190 made that lift at 170, and dividing by today would
 * quietly demote it.
 */
test("a lift is divided by what they weighed then, not now", () => {
  const entries = [
    weighIn("2026-03-01", 170), weighIn("2026-03-05", 170), weighIn("2026-03-09", 170),
    weighIn("2026-09-01", 190), weighIn("2026-09-05", 190), weighIn("2026-09-09", 190),
  ];
  assert.equal(bodyWeightOn(entries, "2026-03-05", null)!.lb, 170);
  assert.equal(bodyWeightOn(entries, "2026-09-05", null)!.lb, 190);
});

test("a thin history still gives a weight, and says how thin", () => {
  const w = bodyWeightOn([weighIn("2026-01-01", 175)], "2026-09-01", null)!;
  assert.equal(w.lb, 175);
  assert.equal(w.n, 1, "one reading, eight months away — the caller can say so");
});

test("with no check-ins it falls back to the profile, and marks it", () => {
  const w = bodyWeightOn([], "2026-09-01", 188)!;
  assert.equal(w.lb, 188);
  assert.equal(w.from, "profile");
  assert.equal(bodyWeightOn([], "2026-09-01", null), null, "and nothing at all is null");
  assert.equal(bodyWeightOn([], "2026-09-01", 0), null, "zero is not a bodyweight");
});

test("a blank bodyweight on a check-in is not counted as zero", () => {
  const entries = [
    { date: "2026-09-01", bodyWeight: null } as RecoveryEntry,
    // A stored 0 is the one that would drag an average down without being
    // obviously absent — `!= null` lets it through and `> 0` does not.
    { date: "2026-09-02", bodyWeight: 0 } as RecoveryEntry,
    weighIn("2026-09-03", 180),
  ];
  assert.equal(bodyWeightOn(entries, "2026-09-03", null)!.lb, 180);
  assert.equal(bodyWeightOn(entries, "2026-09-03", null)!.n, 1);
});

/* ---------------- the ratio ---------------- */

const lifted = (e1rmSet: LiftSet) => [day("2026-09-05", { deadlift: [e1rmSet] })];
const steady = (lb: number) =>
  [weighIn("2026-09-01", lb), weighIn("2026-09-05", lb), weighIn("2026-09-09", lb)];

const only = (multiple: number): Standard[] => [{ liftKey: "deadlift", multiple }];

test("the ratio is the estimated max over bodyweight", () => {
  const [r] = relativeStrength(MENU, lifted(set(360, 1)), steady(180), null, only(2));
  assert.equal(r.e1rm, 360);
  assert.equal(r.weight.lb, 180);
  assert.equal(r.ratio, 2);
  assert.equal(r.met, true);
  assert.equal(r.toGo, 0);
});

/* "−18 lb to go" reads as a deficit to the athlete who just cleared the bar. */
test("having beaten the target leaves nothing to go, never a negative", () => {
  const [r] = relativeStrength(MENU, lifted(set(400, 1)), steady(180), null, only(2));
  assert.equal(r.met, true);
  assert.equal(r.toGo, 0);
});

test("short of the target, what is left is pounds on the bar", () => {
  const [r] = relativeStrength(MENU, lifted(set(320, 1)), steady(180), null, only(2));
  assert.equal(r.met, false);
  assert.equal(r.toGo, 40, "360 is two times 180");
  assert.equal(fmtRatio(r.ratio), "1.78×");
});

/*
 * A standard with nothing logged behind it is left out, not shown at zero.
 * An athlete who has never deadlifted here has not failed the deadlift
 * standard, and "0.00× — 360 lb to go" is a discouraging way to say "no data".
 */
test("a standard with no lift behind it is absent, not failed", () => {
  const got = relativeStrength(MENU, [day("2026-09-05", { bench: [set(200, 1)] })], steady(180), null);
  assert.deepEqual(got.map((r) => r.liftKey), ["bench"]);
});

/*
 * The same rule as the helper test above, but asserted through the function
 * that USES it — which is where it can actually go wrong. Testing only
 * `bodyWeightOn` left `relativeStrength` free to pass it today's date, and a
 * mutation doing exactly that went unnoticed.
 */
test("the ratio uses the weight from the lift's own date, not the latest one", () => {
  const days = [day("2026-03-05", { deadlift: [set(340, 1)] })];
  const entries = [
    weighIn("2026-03-01", 170), weighIn("2026-03-05", 170), weighIn("2026-03-09", 170),
    weighIn("2026-09-01", 200), weighIn("2026-09-05", 200), weighIn("2026-09-09", 200),
  ];
  const [r] = relativeStrength(MENU, days, entries, null, only(2));
  assert.equal(r.weight.lb, 170, "he made that lift at 170");
  assert.equal(fmtRatio(r.ratio), "2.00×");
  assert.equal(r.met, true, "dividing by today's 200 would have taken this off him");
});

test("no bodyweight anywhere means no ratio rather than a made-up one", () => {
  assert.deepEqual(relativeStrength(MENU, lifted(set(360, 1)), [], null, only(2)), []);
});

test("a lift measured in reps or seconds has no max to take a ratio of", () => {
  const days = [day("2026-09-05", { "push-up": [set(0, 20)], "high-plank": [set(0, 60)] })];
  const standards: Standard[] = [
    { liftKey: "push-up", multiple: 1 },
    { liftKey: "high-plank", multiple: 1 },
  ];
  assert.deepEqual(relativeStrength(MENU, days, steady(180), null, standards), []);
});

/* Closest to the target leads: that is the one worth a push this block. */
test("the list leads with whichever standard is nearest", () => {
  const days = [
    day("2026-09-05", {
      deadlift: [set(300, 1)], // 1.67 of 2   → 83%
      bench: [set(215, 1)], //    1.19 of 1.25 → 96%
      "front-squat": [set(200, 1)], // 1.11 of 1.5 → 74%
    }),
  ];
  const got = relativeStrength(MENU, days, steady(180), null);
  assert.deepEqual(got.map((r) => r.liftKey), ["bench", "deadlift", "front-squat"]);
});

/* ---------------- the standards themselves ---------------- */

test("every standard names a lift on the menu, and a loaded one", () => {
  for (const s of STRENGTH_STANDARDS) {
    assert.ok(MENU.get(s.liftKey), `${s.liftKey} is not on the menu`);
    assert.equal(MENU.mode(s.liftKey), "load", `${s.liftKey} has no max to divide`);
    assert.ok(s.multiple > 0 && s.multiple < 5, `${s.liftKey}: ${s.multiple}× is not plausible`);
  }
});

test("the standards stay few — a target on everything is a scoreboard", () => {
  assert.ok(STRENGTH_STANDARDS.length <= 5, `${STRENGTH_STANDARDS.length} standards`);
});

/* ---------------- how it reads ---------------- */

test("a ratio reads to two places and a target as it was written", () => {
  assert.equal(fmtRatio(1.7234), "1.72×");
  assert.equal(fmtTarget(2), "2×");
  assert.equal(fmtTarget(1.25), "1.25×");
});

test("the meter fills towards the target and stops there", () => {
  const near = relativeStrength(MENU, lifted(set(180, 1)), steady(180), null, only(2))[0];
  assert.equal(progressTo(near), 0.5);
  const over = relativeStrength(MENU, lifted(set(500, 1)), steady(180), null, only(2))[0];
  assert.equal(progressTo(over), 1, "past the target the bar is full, not overflowing");
});
