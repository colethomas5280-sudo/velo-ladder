import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiftInput } from "@/lib/liftInput";
import {
  MAX_REPS,
  MAX_SETS,
  MAX_WEIGHT,
  liftMenu,
  seedLifts,
} from "@/lib/strength";

/* ------------------------------------------------------------------ *
 * Validating a lifting day
 *
 * Two jobs. Keep a slipped keypad out of the history — a PR of 2250lb is a
 * number no real session will ever beat, and it sits at the top of the
 * athlete's page forever. And keep a half-written set from being silently
 * dropped: the athlete racked the bar believing it was recorded.
 * ------------------------------------------------------------------ */

const TODAY = "2026-09-10";
const MENU = liftMenu(seedLifts());
const parse = (body: unknown) => parseLiftInput(body, TODAY, MENU);
const day = (lifts: Record<string, unknown>, notes = "") => ({
  date: TODAY,
  lifts,
  notes,
});

test("a good day comes back parsed", () => {
  const r = parse(day({ "front-squat": [{ w: 225, r: 5 }, { w: 245, r: 3 }] }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value!.lifts, {
    "front-squat": [
      { w: 225, r: 5 },
      { w: 245, r: 3 },
    ],
  });
});

/* ---------------- the date ---------------- */

test("the date has to be a real day, not just the right shape", () => {
  // The bug this app has now shipped twice: a shape-only check lets
  // 2026-02-30 through to Postgres, which answers 500 where 400 belonged.
  assert.equal(parse(day({ "front-squat": [{ w: 225, r: 5 }] })).ok, true);
  for (const date of ["2026-02-30", "2026-13-01", "26-09-01", "not-a-date", ""])
    assert.equal(
      parseLiftInput({ ...day({ "front-squat": [{ w: 225, r: 5 }] }), date }, TODAY, MENU)
        .ok,
      false,
      date,
    );
});

test("a day in the future is refused", () => {
  const r = parseLiftInput(
    { ...day({ "front-squat": [{ w: 225, r: 5 }] }), date: "2026-09-11" },
    TODAY,
    MENU,
  );
  assert.equal(r.ok, false);
  assert.match(r.error!, /future/);
});

/* ---------------- the lifts ---------------- */

test("a lift that isn't on the menu is refused by name", () => {
  const r = parse(day({ "power-snatch": [{ w: 135, r: 3 }] }));
  assert.equal(r.ok, false);
  assert.match(r.error!, /power-snatch/);
});

test("a lift has to be a list of sets", () => {
  assert.equal(parse(day({ "front-squat": "225x5" })).ok, false);
  assert.equal(parse(day({ "front-squat": { w: 225, r: 5 } })).ok, false);
  assert.equal(parse(day({ "front-squat": [225] })).ok, false, "a bare number is not a set");
});

test("more sets than we record is refused rather than truncated", () => {
  const many = Array.from({ length: MAX_SETS + 1 }, () => ({ w: 135, r: 5 }));
  const r = parse(day({ "front-squat": many }));
  assert.equal(r.ok, false);
  assert.match(r.error!, new RegExp(String(MAX_SETS)));
  assert.equal(parse(day({ "front-squat": many.slice(1) })).ok, true, "and one fewer is fine");
});

/* ---------------- one set ---------------- */

test("reps have to be a whole number inside the range", () => {
  for (const r of [0, -1, 2.5, MAX_REPS + 1, "five"])
    assert.equal(parse(day({ "front-squat": [{ w: 225, r }] })).ok, false, String(r));
  assert.equal(parse(day({ "front-squat": [{ w: 225, r: MAX_REPS }] })).ok, true);
});

test("a weight outside the range is refused", () => {
  for (const w of [-5, MAX_WEIGHT + 1, "heavy"])
    assert.equal(parse(day({ "front-squat": [{ w, r: 5 }] })).ok, false, String(w));
  assert.equal(parse(day({ "front-squat": [{ w: MAX_WEIGHT, r: 1 }] })).ok, true);
});

test("half-pound microplates survive; anything finer is rounded off", () => {
  const r = parse(day({ "front-squat": [{ w: 102.5, r: 5 }, { w: 100.37, r: 5 }] }));
  assert.deepEqual(r.value!.lifts["front-squat"], [
    { w: 102.5, r: 5 },
    { w: 100.5, r: 5 },
  ]);
});

/*
 * The half-written set. Dropping it quietly is the worst option available:
 * the athlete typed something, the app said "saved", and the number is gone.
 */
test("a weight with no reps is refused, and the message says which set", () => {
  const r = parse(day({ "front-squat": [{ w: 225, r: 5 }, { w: 245, r: "" }] }));
  assert.equal(r.ok, false);
  assert.match(r.error!, /set 2 of Front squat/i);
  assert.match(r.error!, /no reps/i);
});

test("reps with no weight are refused on a loaded lift", () => {
  const r = parse(day({ "bench": [{ w: "", r: 5 }] }));
  assert.equal(r.ok, false);
  assert.match(r.error!, /no weight/i);
});

test("reps with no weight are a bodyweight set on a bodyweight lift", () => {
  const r = parse(day({ "push-up": [{ w: "", r: 8 }, { w: 25, r: 5 }] }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value!.lifts["push-up"], [
    { w: 0, r: 8 },
    { w: 25, r: 5 },
  ]);
});

test("zero on the bar is refused on a loaded lift", () => {
  assert.equal(parse(day({ "bench": [{ w: 0, r: 5 }] })).ok, false);
});

/* ---------------- blanks ---------------- */

test("a row the athlete tabbed through and left empty is not an error", () => {
  const r = parse(
    day({ "front-squat": [{ w: 225, r: 5 }, { w: "", r: "" }, { w: null, r: null }] }),
  );
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value!.lifts["front-squat"], [{ w: 225, r: 5 }]);
});

test("a lift whose rows were all left blank is not part of the day", () => {
  const r = parse(day({ "front-squat": [{ w: 225, r: 5 }], "bench": [{ w: "", r: "" }] }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(Object.keys(r.value!.lifts), ["front-squat"]);
});

test("a day with nothing in it is refused rather than stored empty", () => {
  assert.equal(parse(day({})).ok, false);
  assert.equal(parse(day({ "front-squat": [] })).ok, false);
  assert.equal(parse(day({ "front-squat": [{ w: "", r: "" }] })).ok, false);
  assert.equal(parse(day({}, "   ")).ok, false, "whitespace is not a note");
});

test("a note on its own is a day worth keeping", () => {
  const r = parse(day({}, "Deload — tweaked my back Saturday"));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value!.lifts, {});
});

test("a long note is trimmed rather than refused", () => {
  const r = parse(day({ "front-squat": [{ w: 225, r: 5 }] }, "x".repeat(3000)));
  assert.equal(r.value!.notes.length, 2000);
});

test("a body that isn't an object is refused", () => {
  assert.equal(parse(null).ok, false);
  assert.equal(parse("hello").ok, false);
  assert.equal(parseLiftInput({ date: TODAY, lifts: "nope" }, TODAY, MENU).ok, false);
});

/*
 * Retiring a lift has to close its write path in the same action that takes
 * it off the form. Otherwise a stale tab — or anyone holding the endpoint —
 * keeps filing sets under a movement the coach has removed.
 */
test("an archived lift is off the menu and refused on the way in", () => {
  const rows = seedLifts().map((l) =>
    l.key === "front-squat" ? { ...l, archived: true } : l,
  );
  const narrowed = liftMenu(rows);
  const r = parseLiftInput(day({ "front-squat": [{ w: 225, r: 5 }] }), TODAY, narrowed);
  assert.equal(r.ok, false);
  assert.match(r.error!, /front-squat/);
  assert.equal(
    parseLiftInput(day({ "bench": [{ w: 185, r: 5 }] }), TODAY, narrowed).ok,
    true,
    "the rest of the menu is untouched",
  );
  // But the archived lift is still NAMED, so its history still reads.
  assert.equal(narrowed.name("front-squat"), "Front squat");
});
