import { test } from "node:test";
import assert from "node:assert/strict";
import {
  E1RM_MAX_REPS,
  LIFTS,
  LIFT_GROUPS,
  STRENGTH_WINDOW,
  dayTotals,
  defaultLift,
  e1rm,
  fmtMetric,
  fmtSet,
  liftBest,
  liftLast,
  liftMetric,
  liftMode,
  liftName,
  liftSeries,
  liftStats,
  liftsDone,
  liftsEverDone,
  recentRecords,
  type DatedLifts,
  type LiftSet,
} from "@/lib/strength";

/* ------------------------------------------------------------------ *
 * Strength
 *
 * The numbers here are the ones an athlete reads as "am I getting stronger",
 * so the tests are about the cases where two plausible rules disagree: which
 * set is the top set, which set the estimated max comes from, and what counts
 * as a personal best.
 * ------------------------------------------------------------------ */

const day = (date: string, lifts: Record<string, LiftSet[]>): DatedLifts => ({
  date,
  lifts,
});
const set = (w: number, r: number): LiftSet => ({ w, r });

/* ---------------- the config ---------------- */

test("every lift has a unique key and a group that is listed", () => {
  const keys = LIFTS.map((l) => l.key);
  assert.equal(new Set(keys).size, keys.length, "a duplicate key silently merges two lifts");
  for (const l of LIFTS) assert.ok(LIFT_GROUPS.includes(l.group), l.group);
  assert.ok(LIFTS.length > 5, "the menu is empty — is the config right?");
});

test("keys are slugs, because they are what the database stores forever", () => {
  for (const l of LIFTS) assert.match(l.key, /^[a-z0-9-]+$/, l.key);
});

test("a lift no longer on the menu still reads by its key", () => {
  assert.equal(liftName("power-clean-retired"), "power-clean-retired");
  assert.equal(liftMode("power-clean-retired"), "load", "and reads as a loaded lift");
  assert.equal(liftName("bench-press"), "Bench press");
  assert.equal(liftMode("chin-up"), "reps");
});

/* ---------------- estimating a max ---------------- */

test("a single estimates as itself, so a tested max never sits below an estimate", () => {
  assert.equal(e1rm(300, 1), 300);
});

test("more reps at the same weight estimates higher", () => {
  assert.ok(e1rm(225, 5)! > e1rm(225, 3)!);
  assert.equal(Math.round(e1rm(225, 5)!), 263);
});

test("a set too long to estimate from returns nothing rather than a number", () => {
  assert.equal(e1rm(135, E1RM_MAX_REPS), 135 * (1 + E1RM_MAX_REPS / 30));
  assert.equal(e1rm(135, E1RM_MAX_REPS + 1), null);
});

test("an unloaded set estimates nothing", () => {
  assert.equal(e1rm(0, 8), null, "a chin-up has no bar weight to estimate from");
  assert.equal(e1rm(200, 0), null);
});

/* ---------------- reading one day ---------------- */

/*
 * Order the tie so the WRONG answer is the one a naive scan would land on:
 * the better set comes first, so "keep the last one at this weight" fails.
 */
test("the top set is the heaviest, and ties go to the one with more reps", () => {
  assert.deepEqual(liftStats([set(225, 3), set(245, 5), set(245, 2)]).top, set(245, 5));
  assert.deepEqual(liftStats([set(245, 2), set(245, 5), set(225, 3)]).top, set(245, 5));
});

test("the longest set is the most reps, and ties go to the heavier", () => {
  assert.deepEqual(liftStats([set(25, 10), set(0, 10), set(45, 6)]).longest, set(25, 10));
  assert.deepEqual(liftStats([set(0, 10), set(25, 10), set(45, 6)]).longest, set(25, 10));
});

/*
 * The rule that is easy to get wrong. Reading the estimate off the top set
 * alone would report 245 here — the grinding single — and miss that the
 * back-off set of 225x8 says the athlete is capable of more.
 */
test("the estimated max comes from the best set, not from the heaviest one", () => {
  const s = liftStats([set(245, 1), set(225, 8)]);
  assert.equal(Math.round(s.e1rm!), 285);
  assert.deepEqual(s.top, set(245, 1), "which is still the top set");
});

test("sets too long to estimate from still count for volume", () => {
  const s = liftStats([set(135, 20)]);
  assert.equal(s.e1rm, null);
  assert.equal(s.volume, 2700);
  assert.equal(s.reps, 20);
  assert.equal(s.sets, 1);
});

test("a lift with no sets reads as empty rather than throwing", () => {
  const s = liftStats(undefined);
  assert.equal(s.sets, 0);
  assert.equal(s.top, null);
  assert.equal(s.e1rm, null);
  assert.deepEqual(liftStats([]), s);
});

test("the charted number is a max for a loaded lift and reps for a bodyweight one", () => {
  const s = liftStats([set(0, 12), set(25, 8)]);
  assert.equal(liftMetric(s, "reps"), 12, "the longest set, whatever was hung on");
  assert.equal(liftMetric(liftStats([set(225, 5)]), "load"), e1rm(225, 5));
});

test("a loaded day of nothing but long sets charts nothing rather than zero", () => {
  assert.equal(liftMetric(liftStats([set(135, 20)]), "load"), null);
});

test("a day's totals add up across every lift", () => {
  const d = day("2026-09-01", {
    "back-squat": [set(225, 5), set(225, 5)],
    "bench-press": [set(185, 5)],
    "chin-up": [],
  });
  assert.deepEqual(dayTotals(d), { lifts: 2, sets: 3, reps: 15, volume: 3175 });
});

test("lifts done come back in menu order, with anything retired at the end", () => {
  const d = day("2026-09-01", {
    "zz-retired": [set(100, 5)],
    "bench-press": [set(185, 5)],
    "back-squat": [set(225, 5)],
    "trap-bar-deadlift": [],
  });
  assert.deepEqual(liftsDone(d), ["back-squat", "bench-press", "zz-retired"]);
});

/* ---------------- reading a lift across days ---------------- */

const history: DatedLifts[] = [
  day("2026-08-03", { "back-squat": [set(225, 5)] }),
  day("2026-08-10", { "back-squat": [set(235, 5)] }),
  day("2026-08-17", { "back-squat": [set(235, 5)] }),
  day("2026-08-24", { "back-squat": [set(215, 5)] }),
  day("2026-09-01", { "back-squat": [set(245, 5)] }),
];

test("a series is oldest first and skips days the lift wasn't done", () => {
  const s = liftSeries([...history].reverse(), "back-squat");
  assert.deepEqual(
    s.map((p) => p.date),
    ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-09-01"],
  );
  assert.equal(liftSeries(history, "bench-press").length, 0);
});

/*
 * The first day a lift appears set the number; it did not beat anything. A
 * badge on it would fire on every new lift and mean nothing.
 */
test("the first day of a lift is not a personal best", () => {
  assert.equal(liftSeries(history, "back-squat")[0].record, false);
});

test("repeating the best is not a new best", () => {
  const s = liftSeries(history, "back-squat");
  assert.equal(s[1].record, true, "235 beat 225");
  assert.equal(s[2].record, false, "235 again is a good day, not a new one");
  assert.equal(s[3].record, false, "and 215 is not");
  assert.equal(s[4].record, true, "245 is");
});

/*
 * A day whose value can't be computed still counts as having seen the lift.
 * Treating it as absent would make the day AFTER it the first one, and its
 * record would be silently suppressed.
 */
test("a day that charts nothing doesn't reset the record clock", () => {
  const s = liftSeries(
    [
      day("2026-08-01", { "back-squat": [set(135, 20)] }),
      day("2026-08-08", { "back-squat": [set(225, 5)] }),
    ],
    "back-squat",
  );
  assert.equal(s[0].value, null);
  assert.equal(s[1].record, true, "225x5 beat nothing recorded, but it is not the first day");
});

test("the best day is the best number and the set behind it", () => {
  const best = liftBest(history, "back-squat")!;
  assert.equal(best.date, "2026-09-01");
  assert.deepEqual(best.set, set(245, 5));
  assert.equal(liftBest(history, "bench-press"), null);
});

test("a bodyweight best reports the longest set, not the heaviest", () => {
  const days = [
    day("2026-08-01", { "chin-up": [set(0, 8)] }),
    day("2026-08-08", { "chin-up": [set(45, 3), set(0, 12)] }),
  ];
  const best = liftBest(days, "chin-up")!;
  assert.equal(best.value, 12);
  assert.deepEqual(best.set, set(0, 12), "the 45lb triple is heavier and shorter");
});

test("the last day is the most recent one, whatever order the rows arrive in", () => {
  assert.equal(liftLast([...history].reverse(), "back-squat")!.date, "2026-09-01");
  assert.equal(liftLast(history, "bench-press"), null);
});

test("every lift ever done comes back once, in menu order", () => {
  const days = [
    day("2026-08-01", { "bench-press": [set(185, 5)] }),
    day("2026-08-02", { "back-squat": [set(225, 5)], "bench-press": [set(190, 5)] }),
  ];
  assert.deepEqual(liftsEverDone(days), ["back-squat", "bench-press"]);
});

/*
 * One record sits exactly on the cutoff. The window is inclusive of it — a
 * "last 28 days" that quietly drops the 28th day is off by one, and the day
 * it drops is the one most likely to be the reason someone opened the page.
 */
test("recent records are inside the window and newest first", () => {
  const days = [
    day("2026-08-01", { "back-squat": [set(225, 5)] }), // first: sets the number
    day("2026-08-10", { "back-squat": [set(230, 5)] }), // a record, but old
    day("2026-08-20", { "back-squat": [set(235, 5)] }), // exactly on the cutoff
    day("2026-09-01", { "back-squat": [set(245, 5)] }),
    day("2026-09-05", { "bench-press": [set(185, 5)] }), // first bench: not a record
  ];
  assert.deepEqual(
    recentRecords(days, "2026-08-20").map((r) => [r.key, r.date]),
    [
      ["back-squat", "2026-09-01"],
      ["back-squat", "2026-08-20"],
    ],
  );
});

test("the window is four weeks, not the throwing tracker's one", () => {
  assert.equal(STRENGTH_WINDOW, 28);
});

/* ---------------- how it reads ---------------- */

test("a bodyweight set says so, and names what was hung on", () => {
  assert.equal(fmtSet(set(0, 8), "reps"), "BW × 8");
  assert.equal(fmtSet(set(25, 8), "reps"), "BW+25 × 8");
  assert.equal(fmtSet(set(225, 5), "load"), "225 × 5");
  assert.equal(fmtSet(set(102.5, 5), "load"), "102.5 × 5", "microplates keep their half");
});

test("the charted number reads in its own unit", () => {
  assert.equal(fmtMetric(263.2, "load"), "263 lb");
  assert.equal(fmtMetric(1, "reps"), "1 rep");
  assert.equal(fmtMetric(8, "reps"), "8 reps");
  assert.equal(fmtMetric(null, "load"), "–");
});

/* ---------------- which lift leads ---------------- */

/*
 * Config order was the first answer and it was wrong on real data: a trap-bar
 * deadlift done once in July sorted above a back squat with five sessions,
 * so the athlete's page opened on a chart that said there was nothing to draw.
 */
test("the lift shown first is the one with the most behind it", () => {
  const days = [
    day("2026-07-15", { "trap-bar-deadlift": [set(315, 5)], "back-squat": [set(225, 5)] }),
    day("2026-08-05", { "back-squat": [set(245, 5)] }),
    day("2026-08-26", { "back-squat": [set(255, 5)] }),
  ];
  assert.equal(defaultLift(days), "back-squat");
});

test("a tie goes to whichever was lifted most recently", () => {
  const days = [
    day("2026-07-15", { "trap-bar-deadlift": [set(315, 5)] }),
    day("2026-08-26", { "back-squat": [set(225, 5)] }),
  ];
  assert.equal(defaultLift(days), "back-squat", "one session each");
});

test("nothing logged leads with nothing", () => {
  assert.equal(defaultLift([]), null);
  assert.equal(defaultLift([day("2026-08-01", { "back-squat": [] })]), null);
});

/*
 * Found by opening the form on real data: it read "Best 310 lb (275 × 3)".
 * The 310 came off a back-off set of 245x8; captioning it with the heaviest
 * set invites the athlete to check the arithmetic and find it wrong.
 */
test("a best names the set its number actually came from", () => {
  const days = [
    day("2026-08-01", { "back-squat": [set(225, 5)] }),
    day("2026-09-09", { "back-squat": [set(275, 3), set(245, 8)] }),
  ];
  const best = liftBest(days, "back-squat")!;
  assert.equal(Math.round(best.value), 310);
  assert.deepEqual(best.set, set(245, 8), "not the 275 triple, which estimates 302");
});

test("the stats say which set the estimate came from", () => {
  const s = liftStats([set(275, 3), set(245, 8)]);
  assert.deepEqual(s.e1rmSet, set(245, 8));
  assert.deepEqual(s.top, set(275, 3), "which is still the top set");
  assert.equal(liftStats([set(135, 20)]).e1rmSet, null, "no estimate, no set");
});
