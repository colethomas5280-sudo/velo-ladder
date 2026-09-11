import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODYWEIGHT_ANCHORS,
  STRENGTH_CHART,
  STRENGTH_LEVELS,
  STRENGTH_STANDARDS,
  TARGET_BAND,
  bodyWeightOn,
  bodyweightMarks,
  bodyweightStanding,
  fmtHeight,
  roundLoad,
  targetsAt,
  levelReached,
  markFor,
  targetFor,
  fmtToGo,
  fmtValue,
  fmtTarget,
  progressTo,
  relativeStrength,
  type Standard,
} from "@/lib/relative";
import { e1rm as e1rmOf, liftMenu, seedLifts, type DatedLifts, type LiftSet } from "@/lib/strength";
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
    [day("2026-09-05", { bench: [set(225, 3) ] })],
    steady(180),
    null,
  );
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
      deadlift: [set(300, 1)], //      1.67 of 2.25 → 74%
      bench: [set(260, 1)], //          1.44 of 1.5  → 96%
      "front-squat": [set(225, 1)], //  1.25 of 1.5  → 83%
    }),
  ];
  const got = relativeStrength(MENU, days, steady(180), null);
  assert.deepEqual(got.map((r) => r.liftKey), ["bench", "front-squat", "deadlift"]);
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
      s.kind === "ratio" ? "load" : "reps",
      `${s.liftKey} is a ${MENU.mode(s.liftKey)} lift with a ${s.kind} standard`,
    );
    const target = s.kind === "reps-then-load" ? s.reps : s.target;
    assert.ok(target > 0, `${s.liftKey}: ${target} is not a target`);
    if (s.kind === "ratio")
      assert.ok(target < 5, `${s.liftKey}: ${target}× is not plausible`);
  }
});

/* The five Cole named, and nothing else. The barbell bench on his sheet is
 * deliberately absent — he watches the dumbbell press. */
test("the standards are exactly the lifts Cole watches", () => {
  assert.deepEqual(
    [...STRENGTH_STANDARDS.map((s) => s.liftKey)].sort(),
    ["back-squat", "bench", "deadlift", "front-squat", "pull-up"],
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

/* ---------------- the chart ---------------- */

test("every chart row names a lift on the menu", () => {
  for (const key of Object.keys(STRENGTH_CHART))
    assert.ok(MENU.get(key), `${key} has a chart row but is not a lift`);
});

test("a chart row climbs — no band is easier than the one below it", () => {
  for (const [key, row] of Object.entries(STRENGTH_CHART)) {
    for (let i = 1; i < STRENGTH_LEVELS.length; i++) {
      const lower = row[STRENGTH_LEVELS[i - 1]];
      const upper = row[STRENGTH_LEVELS[i]];
      assert.ok(upper > lower, `${key}: ${STRENGTH_LEVELS[i]} (${upper}) <= ${STRENGTH_LEVELS[i - 1]} (${lower})`);
    }
  }
});

/*
 * The targets are DERIVED, not typed. This is the test that would fail if
 * someone "simplified" targetFor into five literals and then moved the band.
 */
test("a ratio target is the midpoint of the band Cole is aiming between", () => {
  assert.deepEqual([...TARGET_BAND], ["intermediate", "advanced"]);
  assert.equal(targetFor("deadlift"), (2 + 2.5) / 2);
  assert.equal(targetFor("back-squat"), (1.75 + 2.25) / 2);
  assert.equal(targetFor("bench"), (1.25 + 1.75) / 2);
  assert.equal(targetFor("front-squat"), (1.25 + 1.75) / 2);
  assert.equal(targetFor("push-up"), null, "a lift with no chart row has no target");

  for (const s of STRENGTH_STANDARDS)
    if (s.kind === "ratio")
      assert.equal(s.target, targetFor(s.liftKey), `${s.liftKey} was typed, not derived`);
});

test("leg press is off the chart on purpose", () => {
  assert.equal("leg-press" in STRENGTH_CHART, false, "Cole: non-machine lifts are the priority");
});

/*
 * The band an athlete has REACHED, never the one he is nearest. Rounding him
 * up would be the app flattering him about where he stands.
 */
test("the band is the highest one actually cleared", () => {
  assert.equal(levelReached("deadlift", 1.0), "beginner");
  assert.equal(levelReached("deadlift", 1.99), "novice", "not rounded up to intermediate");
  assert.equal(levelReached("deadlift", 2.0), "intermediate", "exactly on it counts");
  assert.equal(levelReached("deadlift", 3.5), "elite", "and it stops at the top");
});

test("below the first band is no band at all, not 'beginner'", () => {
  assert.equal(levelReached("deadlift", 0.9), null);
  assert.equal(levelReached("push-up", 5), null, "and a lift with no row has none either");
});

/* ---------------- the ladder ---------------- */

/*
 * Cole: "once we can get to 14+, I believe we start concerning ourselves with
 * adding weight." So the pull-up standard has two stages and the athlete's own
 * work decides which one he is looking at.
 */
const graduating: Standard[] = [
  { liftKey: "pull-up", kind: "reps-then-load", reps: 14, loadedBand: "elite" },
];
const pullDay = (date: string, sets: LiftSet[]): DatedLifts => ({
  date,
  lifts: { "pull-up": sets },
});

test("under the rep mark it is a rep standard", () => {
  const [r] = relativeStrength(MENU, pulled(9), steady(180), null, graduating);
  assert.equal(r.kind, "reps");
  assert.equal(r.target, 14);
  assert.equal(r.toGo, 5);
  assert.equal(r.met, false);
});

/*
 * Cleared the reps but never hung a plate on. He has NOT failed the loaded
 * standard — showing him 0.00× of 1.5× would invent a setback out of a
 * milestone. He keeps the cleared rep row and is told what comes next.
 */
test("clearing the reps with nothing loaded yet says what comes next", () => {
  const [r] = relativeStrength(MENU, pulled(15), steady(180), null, graduating);
  assert.equal(r.kind, "reps", "still the rep row, not a ratio at zero");
  assert.equal(r.met, true);
  assert.match(r.note!, /start adding weight/i);
});

test("exactly the rep mark clears it", () => {
  const [r] = relativeStrength(MENU, pulled(14), steady(180), null, graduating);
  assert.equal(r.met, true);
  assert.match(r.note!, /start adding weight/i);
});

/*
 * The athlete IS most of the load. Ignoring his own bodyweight would call a
 * 45 lb pull-up a 0.25× lift; the real total is 180 + 45.
 */
test("once loaded, the ratio counts the athlete as well as the plate", () => {
  const days = [pullDay("2026-09-05", [{ w: 0, r: 15 }, { w: 45, r: 3 }])];
  const [r] = relativeStrength(MENU, days, steady(180), null, graduating);
  assert.equal(r.kind, "ratio");
  assert.equal(Math.round(r.achieved), Math.round(e1rmOf(225, 3)!), "225 on the bar, not 45");
  assert.equal(r.target, 1.5);
  assert.equal(fmtValue(r), "1.38×");
  assert.match(r.note!, /45 lb/, "and it names what was hung on");
});

/* Reps first, in Cole's order: loaded work before the gate does not skip it. */
test("a loaded set under the rep mark does not graduate him early", () => {
  const days = [pullDay("2026-09-05", [{ w: 0, r: 8 }, { w: 25, r: 3 }])];
  const [r] = relativeStrength(MENU, days, steady(180), null, graduating);
  assert.equal(r.kind, "reps");
  assert.equal(r.value, 8);
});

test("a loaded set is not counted as a bodyweight rep test", () => {
  const days = [pullDay("2026-09-05", [{ w: 0, r: 9 }, { w: 25, r: 20 }])];
  const [r] = relativeStrength(MENU, days, steady(180), null, graduating);
  assert.equal(r.value, 9, "twenty reps with a plate on is not twenty strict pull-ups");
});

/* Each day against its own bodyweight, like every other ratio here. */
test("a loaded set is divided by what he weighed that day", () => {
  const days = [
    pullDay("2026-03-05", [{ w: 0, r: 15 }, { w: 45, r: 3 }]),
    pullDay("2026-09-05", [{ w: 45, r: 3 }]),
  ];
  const entries = [
    weighIn("2026-03-01", 150), weighIn("2026-03-05", 150), weighIn("2026-03-09", 150),
    weighIn("2026-09-01", 200), weighIn("2026-09-05", 200), weighIn("2026-09-09", 200),
  ];
  const [r] = relativeStrength(MENU, days, entries, null, graduating);
  // 195/150 = 1.30 in March beats 245/200 = 1.23 in September.
  assert.equal(r.on, "2026-03-05");
  assert.equal(r.weight!.lb, 150);
});

test("no bodyweight at all leaves him on the rep stage", () => {
  const days = [pullDay("2026-09-05", [{ w: 0, r: 15 }, { w: 45, r: 3 }])];
  const [r] = relativeStrength(MENU, days, [], null, graduating);
  assert.equal(r.kind, "reps", "a ratio needs a denominator; the rep count does not");
  assert.equal(r.met, true);
});

test("no pull-ups logged at all shows no row", () => {
  assert.deepEqual(relativeStrength(MENU, [], steady(180), null, graduating), []);
});

/*
 * The reason the loaded stage is ELITE rather than the usual band. Fourteen
 * strict pull-ups already puts an athlete past the chart's advanced mark, so
 * the intermediate-advanced midpoint would arrive pre-met — not a target.
 */
test("the loaded pull-up target is one an athlete who just cleared 14 has not met", () => {
  const justCleared = e1rmOf(180, 10)! / 180; // ~1.33x, on bodyweight alone
  assert.ok(justCleared > targetFor("pull-up")!, "the usual midpoint is already behind him");
  assert.ok(justCleared < markFor("pull-up", "elite")!, "elite is still ahead");
});

/*
 * The loaded stage measures LOADED work, and a bodyweight set is not that —
 * even when it estimates higher. An athlete at 180 lb doing ten strict reps
 * estimates to 1.33x; a real 20 lb single-digit set estimates to 1.22x. If the
 * bodyweight set counted, he could sit on his rep strength forever and the row
 * would never ask him to hang a plate on, which is the whole point of the
 * stage Cole described.
 */
test("the loaded ratio reads loaded sets only, even when a rep set estimates higher", () => {
  const days = [
    pullDay("2026-09-01", [{ w: 0, r: 15 }]), // clears the gate
    pullDay("2026-09-05", [{ w: 0, r: 10 }, { w: 20, r: 3 }]),
  ];
  const [r] = relativeStrength(MENU, days, steady(180), null, graduating);
  assert.equal(r.kind, "ratio");
  assert.equal(fmtValue(r), "1.22×", "the 20 lb triple, not the bodyweight ten");
  assert.match(r.note!, /20 lb/);
});

/* ---------------- carrying enough weight ---------------- */

/*
 * Cole's rule: height in inches x2.5 at minimum, ~2.7x ideally, 2.8x being
 * the average MLB player and 2.5x the average high-school draftee.
 */
test("the anchors are pounds per inch, so they scale with height", () => {
  const short = bodyweightMarks(68).map((m) => Math.round(m.lb));
  const tall = bodyweightMarks(76).map((m) => Math.round(m.lb));
  assert.deepEqual(short, [170, 184, 190]);
  assert.deepEqual(tall, [190, 205, 213]);
});

test("every anchor says what it is, not just what it is worth", () => {
  for (const a of BODYWEIGHT_ANCHORS) {
    assert.ok(a.note.length > 10, `${a.label} has no explanation`);
    assert.ok(a.per > 0);
  }
  assert.deepEqual(
    BODYWEIGHT_ANCHORS.map((a) => a.per),
    [2.5, 2.7, 2.8],
    "Cole's numbers",
  );
});

test("the anchors climb, so 'the highest reached' means something", () => {
  const pers = BODYWEIGHT_ANCHORS.map((a) => a.per);
  for (let i = 1; i < pers.length; i++) assert.ok(pers[i] > pers[i - 1]);
});

test("an athlete under the minimum has reached nothing, and is pointed at it", () => {
  const b = bodyweightStanding(72, 170)!;
  assert.equal(b.reached, null, "not rounded up to 'Minimum'");
  assert.equal(b.next!.anchor.label, "Minimum");
  assert.equal(Math.round(b.next!.toGo), 10, "180 is 2.5 x 72");
});

test("exactly on an anchor counts as reaching it", () => {
  const b = bodyweightStanding(72, 180)!;
  assert.equal(b.reached!.label, "Minimum");
  assert.equal(b.next!.anchor.label, "Target");
});

/*
 * Nothing above the top anchor. Inventing a rung past "average MLB player"
 * would push a teenager beyond anywhere anyone is asking him to be.
 */
test("past the last anchor there is nothing left to chase", () => {
  const b = bodyweightStanding(72, 230)!;
  assert.equal(b.reached!.label, "Pro average");
  assert.equal(b.next, null);
});

test("nonsense in gives nothing back rather than a divide by zero", () => {
  assert.equal(bodyweightStanding(0, 180), null);
  assert.equal(bodyweightStanding(72, 0), null);
  assert.equal(bodyweightStanding(-72, 180), null);
  assert.equal(bodyweightStanding(NaN, 180), null);
});

/* ---------------- the standards, in pounds ---------------- */

test("a ratio becomes a weight an athlete can actually load", () => {
  const at180 = targetsAt(180);
  const dl = at180.find((t) => t.liftKey === "deadlift")!;
  assert.equal(dl.unit, "lb");
  assert.equal(dl.amount, 2.25 * 180);
  assert.equal(dl.ratio, targetFor("deadlift"));
});

test("every target scales with the athlete in front of it", () => {
  const light = targetsAt(150).find((t) => t.liftKey === "deadlift")!.amount;
  const heavy = targetsAt(200).find((t) => t.liftKey === "deadlift")!.amount;
  assert.ok(heavy > light);
  assert.equal(heavy / light, 200 / 150);
});

/*
 * The pull-up's second rung is what to HANG ON, not the total. The ratio
 * counts the athlete, so at 1.5x he is already carrying 1x himself — telling
 * him to load 1.5x bodyweight would be half again what anyone is asking.
 */
test("the pull-up's next rung is the plate, not the plate plus the athlete", () => {
  const pu = targetsAt(180).find((t) => t.liftKey === "pull-up")!;
  assert.equal(pu.unit, "reps");
  assert.equal(pu.amount, 14);
  assert.equal(pu.then!.added, 90, "1.5x of 180 is 270 total, and he is 180 of it");
});

test("the pounds shown are loadable, not spurious to a decimal", () => {
  assert.equal(roundLoad(403.7), 405);
  assert.equal(roundLoad(267.5), 270);
  assert.equal(roundLoad(0), 0);
});

test("a height reads in feet and inches", () => {
  assert.equal(fmtHeight(72), "6'0\"");
  assert.equal(fmtHeight(74), "6'2\"");
  assert.equal(fmtHeight(68), "5'8\"");
});
