import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRENGTH_STANDARDS,
  bodyWeightOn,
  fmtToGo,
  fmtValue,
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

const only = (target: number): Standard[] => [
  { liftKey: "deadlift", kind: "ratio", target },
];
const pullUps = (target: number): Standard[] => [
  { liftKey: "pull-up", kind: "reps", target },
];
const pulled = (reps: number) => [day("2026-09-05", { "pull-up": [set(0, reps)] })];

test("the ratio is the estimated max over bodyweight", () => {
  const [r] = relativeStrength(MENU, lifted(set(360, 1)), steady(180), null, only(2));
  assert.equal(r.achieved, 360);
  assert.equal(r.weight!.lb, 180);
  assert.equal(r.value, 2);
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
  assert.equal(fmtValue(r), "1.78×");
});

/*
 * A standard with nothing logged behind it is left out, not shown at zero.
 * An athlete who has never deadlifted here has not failed the deadlift
 * standard, and "0.00× — 360 lb to go" is a discouraging way to say "no data".
 */
test("a standard with no lift behind it is absent, not failed", () => {
  const got = relativeStrength(
    MENU,
    [day("2026-09-05", { "db-bench-press": [set(80, 5)] })],
    steady(180),
    null,
  );
  assert.deepEqual(got.map((r) => r.liftKey), ["db-bench-press"]);
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
  assert.equal(r.weight!.lb, 170, "he made that lift at 170");
  assert.equal(fmtValue(r), "2.00×");
  assert.equal(r.met, true, "dividing by today's 200 would have taken this off him");
});

test("no bodyweight anywhere means no ratio rather than a made-up one", () => {
  assert.deepEqual(relativeStrength(MENU, lifted(set(360, 1)), [], null, only(2)), []);
});

test("a lift measured in reps or seconds has no max to take a ratio of", () => {
  const days = [day("2026-09-05", { "push-up": [set(0, 20)], "high-plank": [set(0, 60)] })];
  const standards: Standard[] = [
    { liftKey: "push-up", kind: "ratio", target: 1 },
    { liftKey: "high-plank", kind: "ratio", target: 1 },
  ];
  assert.deepEqual(relativeStrength(MENU, days, steady(180), null, standards), []);
});

/* Closest to the target leads: that is the one worth a push this block. */
test("the list leads with whichever standard is nearest", () => {
  const days = [
    day("2026-09-05", {
      deadlift: [set(300, 1)], //        1.67 of 2    → 83%
      "db-bench-press": [set(86, 1)], // 0.48 of 0.5  → 96%
      "front-squat": [set(200, 1)], //   1.11 of 1.5  → 74%
    }),
  ];
  const got = relativeStrength(MENU, days, steady(180), null);
  assert.deepEqual(
    got.map((r) => r.liftKey),
    ["db-bench-press", "deadlift", "front-squat"],
  );
});

/* ---------------- rep standards ---------------- */

/*
 * An athlete IS the load on a pull-up, so "2× bodyweight of pull-up" is not a
 * sentence. The mark is a rep count, and the gap is reps.
 */
test("max pull-ups is counted in reps, not divided by anything", () => {
  const [r] = relativeStrength(MENU, pulled(7), steady(180), null, pullUps(10));
  assert.equal(r.kind, "reps");
  assert.equal(r.value, 7);
  assert.equal(r.toGo, 3);
  assert.equal(r.unit, "reps");
  assert.equal(r.met, false);
});

/*
 * Exactly on the mark, not past it. Ten pull-ups against a ten-pull-up
 * standard is cleared — telling that athlete he has "0 reps to go" would be
 * the app quibbling with him over a rep he just did.
 */
test("hitting the rep mark clears it", () => {
  const exact = relativeStrength(MENU, pulled(10), steady(180), null, pullUps(10))[0];
  assert.equal(exact.met, true, "ten is ten");
  assert.equal(exact.toGo, 0);

  const under = relativeStrength(MENU, pulled(9), steady(180), null, pullUps(10))[0];
  assert.equal(under.met, false);

  const over = relativeStrength(MENU, pulled(12), steady(180), null, pullUps(10))[0];
  assert.equal(over.met, true);
  assert.equal(over.toGo, 0);
});

/*
 * Bodyweight is context on a rep standard, not arithmetic — twelve pull-ups
 * at 200 lb is a different feat from twelve at 150. So an athlete who has
 * never weighed in still has a pull-up count, where a ratio would have none.
 */
test("a rep standard survives having no bodyweight at all", () => {
  const [r] = relativeStrength(MENU, pulled(9), [], null, pullUps(10));
  assert.equal(r.value, 9);
  assert.equal(r.weight, null);
  assert.equal(
    relativeStrength(MENU, lifted(set(320, 1)), [], null, only(2)).length,
    0,
    "where a ratio with no denominator is dropped",
  );
});

test("bodyweight still rides along on a rep standard when there is one", () => {
  const [r] = relativeStrength(MENU, pulled(9), steady(180), null, pullUps(10));
  assert.equal(r.weight!.lb, 180);
});

/* A standard and its lift have to agree about what is being measured. */
test("a rep standard on a loaded lift is skipped, and the reverse too", () => {
  const days = [day("2026-09-05", { deadlift: [set(320, 1)], "pull-up": [set(0, 9)] })];
  const crossed: Standard[] = [
    { liftKey: "deadlift", kind: "reps", target: 10 },
    { liftKey: "pull-up", kind: "ratio", target: 1 },
  ];
  assert.deepEqual(relativeStrength(MENU, days, steady(180), null, crossed), []);
});

/* ---------------- the standards themselves ---------------- */

/*
 * A standard whose kind disagrees with its lift's mode is skipped silently by
 * `relativeStrength`, which is right at runtime and useless as a warning —
 * so the config is checked here instead.
 */
test("every standard names a menu lift whose mode matches its kind", () => {
  for (const s of STRENGTH_STANDARDS) {
    assert.ok(MENU.get(s.liftKey), `${s.liftKey} is not on the menu`);
    assert.equal(
      MENU.mode(s.liftKey),
      s.kind === "reps" ? "reps" : "load",
      `${s.liftKey} is a ${MENU.mode(s.liftKey)} lift with a ${s.kind} standard`,
    );
    assert.ok(s.target > 0, `${s.liftKey}: ${s.target} is not a target`);
    if (s.kind === "ratio")
      assert.ok(s.target < 5, `${s.liftKey}: ${s.target}× is not plausible`);
  }
});

/* The five Cole named, and nothing else. The barbell bench on his sheet is
 * deliberately absent — he watches the dumbbell press. */
test("the standards are exactly the lifts Cole watches", () => {
  assert.deepEqual(
    [...STRENGTH_STANDARDS.map((s) => s.liftKey)].sort(),
    ["back-squat", "db-bench-press", "deadlift", "front-squat", "pull-up"],
  );
});

test("the standards stay few — a target on everything is a scoreboard", () => {
  assert.ok(STRENGTH_STANDARDS.length <= 6, `${STRENGTH_STANDARDS.length} standards`);
});

/* ---------------- how it reads ---------------- */

test("a ratio reads to two places, and reps read as a whole number", () => {
  const ratio = relativeStrength(MENU, lifted(set(310, 1)), steady(180), null, only(2))[0];
  assert.equal(fmtValue(ratio), "1.72×");
  assert.equal(fmtTarget(ratio), "of 2× bodyweight");
  assert.equal(fmtToGo(ratio), "50 lb to go");

  const [reps] = relativeStrength(MENU, pulled(8), [], null, pullUps(10));
  assert.equal(fmtValue(reps), "8");
  assert.equal(fmtTarget(reps), "of 10 reps");
  assert.equal(fmtToGo(reps), "2 reps to go");
});

test("the meter fills towards the target and stops there", () => {
  const near = relativeStrength(MENU, lifted(set(180, 1)), steady(180), null, only(2))[0];
  assert.equal(progressTo(near), 0.5);
  const over = relativeStrength(MENU, lifted(set(500, 1)), steady(180), null, only(2))[0];
  assert.equal(progressTo(over), 1, "past the target the bar is full, not overflowing");
});
