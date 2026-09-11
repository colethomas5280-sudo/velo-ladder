import { test } from "node:test";
import assert from "node:assert/strict";
import {
  E1RM_MAX_REPS,
  STRENGTH_WINDOW,
  dayTotals,
  defaultLift,
  e1rm,
  fmtMetric,
  fmtSet,
  liftBest,
  liftLast,
  liftMetric,
  liftKeyFrom,
  liftMenu,
  liftSeries,
  liftStats,
  liftsDone,
  metricSet,
  liftsEverDone,
  recentRecords,
  topSet,
  type DatedLifts,
  type LiftSet,
} from "@/lib/strength";
import { programLifts } from "@/lib/program";

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

/* The menu a fresh database starts with — what these tests read keys against. */
const LIFTS = programLifts();
const LIFT_GROUPS = [...new Set(LIFTS.map((l) => l.group))];
const menu = liftMenu(LIFTS);
const liftName = (k: string) => menu.name(k);
const liftMode = (k: string) => menu.mode(k);

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
  assert.equal(liftName("bench"), "Bench");
  assert.equal(liftMode("push-up"), "reps");
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
  assert.equal(e1rm(0, 8), null, "a push-up has no bar weight to estimate from");
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
    "front-squat": [set(225, 5), set(225, 5)],
    "bench": [set(185, 5)],
    "push-up": [],
  });
  assert.deepEqual(dayTotals(menu, d), { lifts: 2, sets: 3, reps: 15, volume: 3175 });
});

test("lifts done come back in menu order, with anything retired at the end", () => {
  const d = day("2026-09-01", {
    "zz-retired": [set(100, 5)],
    "bench": [set(185, 5)],
    "front-squat": [set(225, 5)],
    "deadlift": [],
  });
  assert.deepEqual(liftsDone(menu, d), ["front-squat", "bench", "zz-retired"]);
});

/* ---------------- reading a lift across days ---------------- */

const history: DatedLifts[] = [
  day("2026-08-03", { "front-squat": [set(225, 5)] }),
  day("2026-08-10", { "front-squat": [set(235, 5)] }),
  day("2026-08-17", { "front-squat": [set(235, 5)] }),
  day("2026-08-24", { "front-squat": [set(215, 5)] }),
  day("2026-09-01", { "front-squat": [set(245, 5)] }),
];

test("a series is oldest first and skips days the lift wasn't done", () => {
  const s = liftSeries(menu, [...history].reverse(), "front-squat");
  assert.deepEqual(
    s.map((p) => p.date),
    ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-09-01"],
  );
  assert.equal(liftSeries(menu, history, "bench").length, 0);
});

/*
 * The first day a lift appears set the number; it did not beat anything. A
 * badge on it would fire on every new lift and mean nothing.
 */
test("the first day of a lift is not a personal best", () => {
  assert.equal(liftSeries(menu, history, "front-squat")[0].record, false);
});

test("repeating the best is not a new best", () => {
  const s = liftSeries(menu, history, "front-squat");
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
  const s = liftSeries(menu, 
    [
      day("2026-08-01", { "front-squat": [set(135, 20)] }),
      day("2026-08-08", { "front-squat": [set(225, 5)] }),
    ],
    "front-squat",
  );
  assert.equal(s[0].value, null);
  assert.equal(s[1].record, true, "225x5 beat nothing recorded, but it is not the first day");
});

test("the best day is the best number and the set behind it", () => {
  const best = liftBest(menu, history, "front-squat")!;
  assert.equal(best.date, "2026-09-01");
  assert.deepEqual(best.set, set(245, 5));
  assert.equal(liftBest(menu, history, "bench"), null);
});

test("a bodyweight best reports the longest set, not the heaviest", () => {
  const days = [
    day("2026-08-01", { "push-up": [set(0, 8)] }),
    day("2026-08-08", { "push-up": [set(45, 3), set(0, 12)] }),
  ];
  const best = liftBest(menu, days, "push-up")!;
  assert.equal(best.value, 12);
  assert.deepEqual(best.set, set(0, 12), "the 45lb triple is heavier and shorter");
});

test("the last day is the most recent one, whatever order the rows arrive in", () => {
  assert.equal(liftLast(menu, [...history].reverse(), "front-squat")!.date, "2026-09-01");
  assert.equal(liftLast(menu, history, "bench"), null);
});

test("every lift ever done comes back once, in menu order", () => {
  const days = [
    day("2026-08-01", { "bench": [set(185, 5)] }),
    day("2026-08-02", { "front-squat": [set(225, 5)], "bench": [set(190, 5)] }),
  ];
  assert.deepEqual(liftsEverDone(menu, days), ["front-squat", "bench"]);
});

/*
 * One record sits exactly on the cutoff. The window is inclusive of it — a
 * "last 28 days" that quietly drops the 28th day is off by one, and the day
 * it drops is the one most likely to be the reason someone opened the page.
 */
test("recent records are inside the window and newest first", () => {
  const days = [
    day("2026-08-01", { "front-squat": [set(225, 5)] }), // first: sets the number
    day("2026-08-10", { "front-squat": [set(230, 5)] }), // a record, but old
    day("2026-08-20", { "front-squat": [set(235, 5)] }), // exactly on the cutoff
    day("2026-09-01", { "front-squat": [set(245, 5)] }),
    day("2026-09-05", { "bench": [set(185, 5)] }), // first bench: not a record
  ];
  assert.deepEqual(
    recentRecords(menu, days, "2026-08-20").map((r) => [r.key, r.date]),
    [
      ["front-squat", "2026-09-01"],
      ["front-squat", "2026-08-20"],
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
    day("2026-07-15", { "deadlift": [set(315, 5)], "front-squat": [set(225, 5)] }),
    day("2026-08-05", { "front-squat": [set(245, 5)] }),
    day("2026-08-26", { "front-squat": [set(255, 5)] }),
  ];
  assert.equal(defaultLift(menu, days), "front-squat");
});

test("a tie goes to whichever was lifted most recently", () => {
  const days = [
    day("2026-07-15", { "deadlift": [set(315, 5)] }),
    day("2026-08-26", { "front-squat": [set(225, 5)] }),
  ];
  assert.equal(defaultLift(menu, days), "front-squat", "one session each");
});

test("nothing logged leads with nothing", () => {
  assert.equal(defaultLift(menu, []), null);
  assert.equal(defaultLift(menu, [day("2026-08-01", { "front-squat": [] })]), null);
});

/*
 * Found by opening the form on real data: it read "Best 310 lb (275 × 3)".
 * The 310 came off a back-off set of 245x8; captioning it with the heaviest
 * set invites the athlete to check the arithmetic and find it wrong.
 */
test("a best names the set its number actually came from", () => {
  const days = [
    day("2026-08-01", { "front-squat": [set(225, 5)] }),
    day("2026-09-09", { "front-squat": [set(275, 3), set(245, 8)] }),
  ];
  const best = liftBest(menu, days, "front-squat")!;
  assert.equal(Math.round(best.value), 310);
  assert.deepEqual(best.set, set(245, 8), "not the 275 triple, which estimates 302");
});

test("the stats say which set the estimate came from", () => {
  const s = liftStats([set(275, 3), set(245, 8)]);
  assert.deepEqual(s.e1rmSet, set(245, 8));
  assert.deepEqual(s.top, set(275, 3), "which is still the top set");
  assert.equal(liftStats([set(135, 20)]).e1rmSet, null, "no estimate, no set");
});

/* ---------------- the menu ---------------- */

const lift = (over: Partial<ReturnType<typeof programLifts>[number]>) => ({
  key: "x",
  name: "X",
  group: "Lower body",
  mode: "load" as const,
  help: "",
  position: 0,
  archived: false,
  ...over,
});

test("the menu offers live lifts in the coach's order, not alphabetically", () => {
  const m = liftMenu([
    lift({ key: "a", name: "Zebra press", position: 0 }),
    lift({ key: "b", name: "Apple squat", position: 1 }),
  ]);
  assert.deepEqual(m.lifts.map((l) => l.key), ["a", "b"]);
  assert.equal(m.rank("a") < m.rank("b"), true);
});

/*
 * The reason the menu is built from EVERY lift rather than the live ones. An
 * athlete who benched for a year should not find that year relabelled
 * `bench` because the movement came off the menu.
 */
test("a retired lift is off the menu but still named", () => {
  const m = liftMenu([
    lift({ key: "bench", name: "Bench", archived: true }),
    lift({ key: "front-squat", name: "Front squat", position: 1 }),
  ]);
  assert.deepEqual(m.lifts.map((l) => l.key), ["front-squat"]);
  assert.equal(m.name("bench"), "Bench", "history still reads");
  assert.equal(m.mode("bench"), "load");
  assert.equal(m.rank("bench"), m.lifts.length, "and it sorts last");
});

test("a key that was never defined falls back to itself rather than blank", () => {
  const m = liftMenu([]);
  assert.equal(m.name("power-clean"), "power-clean");
  assert.equal(m.mode("power-clean"), "load");
  assert.equal(m.get("power-clean"), null);
});

test("groups come from the live menu, in order, without repeats", () => {
  const m = liftMenu([
    lift({ key: "a", group: "Lower body", position: 0 }),
    lift({ key: "b", group: "Push", position: 1 }),
    lift({ key: "c", group: "Lower body", position: 2 }),
    lift({ key: "d", group: "Pull", position: 3, archived: true }),
  ]);
  assert.deepEqual(m.groups, ["Lower body", "Push"], "the retired group is gone too");
});

/* ---------------- keys for new lifts ---------------- */

test("a new lift's key is a readable slug of its name", () => {
  assert.equal(liftKeyFrom("Trap Bar Deadlift", []), "trap-bar-deadlift");
  assert.equal(liftKeyFrom("  Bulgarian  split squat ", []), "bulgarian-split-squat");
  assert.equal(liftKeyFrom("Bench Press (close grip)", []), "bench-press-close-grip");
});

/*
 * Uniqueness has to count archived keys. Reusing a retired lift's key would
 * graft its whole history onto whatever was just created.
 */
test("a key never collides, archived ones included", () => {
  assert.equal(liftKeyFrom("Front squat", ["front-squat"]), "front-squat-2");
  assert.equal(
    liftKeyFrom("Front squat", ["front-squat", "front-squat-2"]),
    "front-squat-3",
  );
});

test("a name with nothing sluggable still gets a key", () => {
  assert.equal(liftKeyFrom("???", []), "lift");
  assert.equal(liftKeyFrom("???", ["lift"]), "lift-2");
  assert.equal(liftKeyFrom("", []), "lift");
});

test("accents are folded rather than dropped into nothing", () => {
  assert.equal(liftKeyFrom("Pallof press", []), "pallof-press");
  assert.equal(liftKeyFrom("Zerchér squat", []), "zercher-squat");
});

test("a very long name is cut without leaving a trailing dash", () => {
  const key = liftKeyFrom("a".repeat(80), []);
  assert.ok(key.length <= 48);
  assert.equal(/-$/.test(key), false);
  assert.equal(/-$/.test(liftKeyFrom(`${"b".repeat(47)} tail`, [])), false);
});

/* ---------------- holds ---------------- */

/*
 * A hold stores seconds in the same field a rep count uses. One stored shape
 * for every lift beats a column per kind of work — and the mode is what says
 * which it is, so nothing has to guess from the number.
 */
test("a hold is read as its longest set, in seconds", () => {
  const s = liftStats([set(0, 30), set(0, 45), set(25, 40)]);
  assert.equal(liftMetric(s, "time"), 45);
  assert.equal(fmtMetric(45, "time"), "45s");
});

test("a hold formats as time, loaded or not", () => {
  assert.equal(fmtSet(set(0, 45), "time"), "45s");
  assert.equal(fmtSet(set(25, 45), "time"), "25 × 45s");
  assert.equal(fmtSet(set(0, 45), "reps"), "BW × 45", "and reps still read as reps");
});

test("a hold never claims an estimated max", () => {
  const days = [
    day("2026-08-01", { "high-plank": [set(0, 30)] }),
    day("2026-08-08", { "high-plank": [set(0, 45)] }),
  ];
  const m = liftMenu([lift({ key: "high-plank", name: "High plank", mode: "time" })]);
  const best = liftBest(m, days, "high-plank")!;
  assert.equal(best.value, 45);
  assert.deepEqual(best.set, set(0, 45));
});

/*
 * These two answer different questions and are easy to conflate. The best
 * quotes the set its own number came from; "last hit" quotes the heaviest.
 * A page showing both was briefly wrong by using one for the other.
 */
test("the metric's set and the set worth quoting are not always the same", () => {
  const s = liftStats([set(275, 3), set(245, 8)]);
  assert.deepEqual(metricSet(s, "load"), set(245, 8), "where the estimate came from");
  assert.deepEqual(topSet(s, "load"), set(275, 3), "what he actually hit hardest");
});

test("with nothing loaded, both fall back to the longest set", () => {
  const s = liftStats([set(0, 12), set(45, 3)]);
  for (const mode of ["reps", "time"] as const) {
    assert.deepEqual(metricSet(s, mode), set(0, 12), mode);
    assert.deepEqual(topSet(s, mode), set(0, 12), mode);
  }
});
