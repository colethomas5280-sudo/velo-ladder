import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armState,
  sorenessRun,
  cnsCheck,
  evaluate,
  guidance,
  CNS_DEFAULT_PCT,
} from "@/lib/setback";
import type {
  RecoveryEntry,
  Setback,
  SetbackKind,
  TrainingSession,
  TrackerId,
} from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * Every test pins its own dates against a fixed anchor, so none of this
 * depends on the day it runs. `asOf` is always passed explicitly.
 * ------------------------------------------------------------------ */

/** A day offset back from a fixed anchor. D(0) is the notional "today". */
const D = (back: number): string => {
  const d = new Date("2026-08-31T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const TODAY = D(0);

const entry = (date: string, over: Partial<RecoveryEntry> = {}): RecoveryEntry =>
  ({ date, notes: "", ...over }) as RecoveryEntry;

/** A check-in carrying an arm-readiness answer (1 worst … 5 clear). */
const arm = (back: number, readiness: number, over: Partial<RecoveryEntry> = {}) =>
  entry(D(back), { armReadiness: readiness, ...over });

/** A session whose 5 oz best is exactly `best` — index 0 is the 80% primer. */
const session = (
  back: number,
  best: number,
  type: TrackerId = "pulldown",
): TrainingSession =>
  ({
    id: `s${back}${type}`,
    athleteId: "a1",
    type,
    date: D(back),
    notes: "",
    level: null,
    throws: { [type === "pulldown" ? "p1" : "m5"]: [80, best] },
  }) as TrainingSession;

const flag = (kind: SetbackKind, over: Partial<Setback> = {}): Setback =>
  ({
    id: "f1",
    athleteId: "a1",
    kind,
    openedOn: D(3),
    resolvedOn: null,
    resolvedBy: null,
    detail: "",
    severity: null,
    ...over,
  }) as Setback;

/* ------------------------------------------------------------------ *
 * armState
 * ------------------------------------------------------------------ */

test("armState maps the 1-5 readiness scale onto the five states", () => {
  assert.equal(armState(arm(0, 1)), "pain-limiting");
  assert.equal(armState(arm(0, 2)), "pain");
  assert.equal(armState(arm(0, 3)), "sore-heavy");
  assert.equal(armState(arm(0, 4)), "sore-light");
  assert.equal(armState(arm(0, 5)), "clear");
});

test("armState is null when there is no check-in to read", () => {
  assert.equal(armState(undefined), null);
  assert.equal(armState(entry(TODAY)), null);
});

test("legacy armStatus 'sore' means very sore, not a little", () => {
  // The old question had no light/heavy split and "sore" prescribed a recovery
  // day. Reading those entries as merely a little sore would retroactively
  // prescribe MORE work than the athlete was actually given.
  assert.equal(armState(entry(TODAY, { armStatus: "sore" })), "sore-heavy");
  assert.equal(armState(entry(TODAY, { armStatus: "pain" })), "pain");
  assert.equal(armState(entry(TODAY, { armStatus: "good" })), "clear");
});

test("armReadiness wins over a legacy armStatus on the same entry", () => {
  const both = entry(TODAY, { armReadiness: 5, armStatus: "pain" });
  assert.equal(armState(both), "clear");
});

/* ------------------------------------------------------------------ *
 * sorenessRun
 * ------------------------------------------------------------------ */

test("sorenessRun counts consecutive sore days ending at asOf", () => {
  const r = sorenessRun([arm(2, 3), arm(1, 3), arm(0, 3)], TODAY);
  assert.equal(r.days, 3);
  assert.equal(r.severity, "heavy");
});

test("sorenessRun reports nothing when the latest day is clear", () => {
  const r = sorenessRun([arm(1, 3), arm(0, 5)], TODAY);
  assert.deepEqual(r, { days: 0, severity: null, hadHeavy: false, escalated: false });
});

test("a missing day breaks the run rather than being assumed sore", () => {
  // No check-in on D(1). We cannot know what that day was, so the run that
  // reaches today is one day long, not three.
  const r = sorenessRun([arm(3, 3), arm(2, 3), arm(0, 3)], TODAY);
  assert.equal(r.days, 1);
});

test("pain breaks a soreness run — it is a different branch entirely", () => {
  const r = sorenessRun([arm(2, 3), arm(1, 2), arm(0, 3)], TODAY);
  assert.equal(r.days, 1);
});

test("the run counts both severities, but reads today's severity from today", () => {
  // Very sore twice, then easing to a little sore. That is day 3 of a sore
  // arm, not day 1 — but today's work is decided by today's answer.
  const r = sorenessRun([arm(2, 3), arm(1, 3), arm(0, 4)], TODAY);
  assert.equal(r.days, 3);
  assert.equal(r.severity, "light");
  assert.equal(r.hadHeavy, true);
});

test("very sore escalates on day 3", () => {
  assert.equal(sorenessRun([arm(1, 3), arm(0, 3)], TODAY).escalated, false);
  assert.equal(
    sorenessRun([arm(2, 3), arm(1, 3), arm(0, 3)], TODAY).escalated,
    true,
  );
});

test("a little sore gets an extra day before escalating", () => {
  // Deliberately looser than the heavy threshold: a little sore for three days
  // running is an ordinary training week, not a signal.
  const three = [arm(2, 4), arm(1, 4), arm(0, 4)];
  assert.equal(sorenessRun(three, TODAY).escalated, false);

  const four = [arm(3, 4), ...three];
  assert.equal(sorenessRun(four, TODAY).escalated, true);
});

test("sorenessRun stops looking after 14 days", () => {
  const entries = Array.from({ length: 20 }, (_, i) => arm(i, 3));
  assert.equal(sorenessRun(entries, TODAY).days, 14);
});

/* ------------------------------------------------------------------ *
 * cnsCheck
 * ------------------------------------------------------------------ */

test("cnsCheck needs three prior sessions before it says anything", () => {
  assert.equal(cnsCheck([], CNS_DEFAULT_PCT), null);

  const two = [session(9, 100), session(6, 100), session(0, 80)];
  assert.equal(cnsCheck(two, CNS_DEFAULT_PCT), null);

  const three = [session(12, 100), ...two];
  assert.notEqual(cnsCheck(three, CNS_DEFAULT_PCT), null);
});

test("cnsCheck fires when the latest session drops past the threshold", () => {
  const s = [session(12, 100), session(9, 100), session(6, 100), session(0, 90)];
  const r = cnsCheck(s, CNS_DEFAULT_PCT)!;
  assert.equal(r.fired, true);
  assert.equal(r.detail, "90 vs 100 avg over 3 prior sessions (-10%)");
});

test("cnsCheck holds its fire on a drop inside the threshold", () => {
  const s = [session(12, 100), session(9, 100), session(6, 100), session(0, 98)];
  const r = cnsCheck(s, CNS_DEFAULT_PCT)!;
  assert.equal(r.fired, false);
  assert.equal(r.detail, "98 vs 100 avg over 3 prior sessions (-2%)");
});

test("cnsCheck signs an improvement as a gain, not a negative drop", () => {
  const s = [session(12, 100), session(9, 100), session(6, 100), session(0, 105)];
  assert.equal(
    cnsCheck(s, CNS_DEFAULT_PCT)!.detail,
    "105 vs 100 avg over 3 prior sessions (+5%)",
  );
});

test("cnsCheck compares like with like — mound is not a baseline for pulldown", () => {
  // Three mound sessions cannot supply a baseline for a pulldown day, so
  // there is not enough history and the check declines to fire.
  const s = [
    session(12, 100, "mound"),
    session(9, 100, "mound"),
    session(6, 100, "mound"),
    session(0, 80, "pulldown"),
  ];
  assert.equal(cnsCheck(s, CNS_DEFAULT_PCT), null);
});

test("cnsCheck ignores sessions older than the 30-day window", () => {
  const s = [session(40, 100), session(35, 100), session(31, 100), session(0, 80)];
  assert.equal(cnsCheck(s, CNS_DEFAULT_PCT), null);
});

test("cnsCheck reads the session order from dates, not array order", () => {
  const s = [session(0, 90), session(6, 100), session(12, 100), session(9, 100)];
  assert.equal(cnsCheck(s, CNS_DEFAULT_PCT)!.fired, true);
});

/* ------------------------------------------------------------------ *
 * evaluate
 * ------------------------------------------------------------------ */

test("evaluate opens an injury flag carrying the severity that caused it", () => {
  const limiting = evaluate([], [arm(0, 1)], CNS_DEFAULT_PCT, TODAY);
  assert.equal(limiting[0].kind, "injury");
  assert.equal(limiting[0].severity, "pain-limiting");

  const notLimiting = evaluate([], [arm(0, 2)], CNS_DEFAULT_PCT, TODAY);
  assert.equal(notLimiting[0].severity, "pain");
});

test("evaluate quotes the athlete's note on an injury, capped at 140 chars", () => {
  const long = "x".repeat(200);
  const f = evaluate([], [arm(0, 2, { notes: long })], CNS_DEFAULT_PCT, TODAY);
  assert.match(f[0].detail, /Pain reported .* \(not limiting movement\) — "x{140}"$/);
});

test("being a little sore raises no flag on its own", () => {
  // Normal state of a kid in a throwing program. Flagging it would bury the
  // coach's list in noise and make the real ones easy to miss.
  assert.deepEqual(evaluate([], [arm(0, 4)], CNS_DEFAULT_PCT, TODAY), []);
  assert.deepEqual(
    evaluate([], [arm(1, 4), arm(0, 4)], CNS_DEFAULT_PCT, TODAY),
    [],
  );
});

test("a single very sore day does raise a flag", () => {
  const f = evaluate([], [arm(0, 3)], CNS_DEFAULT_PCT, TODAY);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "soreness");
  assert.equal(f[0].detail, "Very sore 1 day running");
});

test("easing from very sore to a little sore does NOT drop the flag", () => {
  // Without this, under-reporting on day three would make an open flag vanish
  // — which quietly rewards exactly the dishonesty this question depends on
  // not happening.
  const f = evaluate([], [arm(2, 3), arm(1, 3), arm(0, 4)], CNS_DEFAULT_PCT, TODAY);
  assert.equal(f.length, 1);
  assert.equal(f[0].detail, "A little sore 3 days running, easing");
});

test("a run that outlasts its threshold says so in the detail", () => {
  const f = evaluate(
    [],
    [arm(3, 4), arm(2, 4), arm(1, 4), arm(0, 4)],
    CNS_DEFAULT_PCT,
    TODAY,
  );
  assert.equal(
    f[0].detail,
    "A little sore 4 days running — past the point where it should be settling",
  );
});

test("evaluate reports every branch that fired at once", () => {
  const sessions = [
    session(12, 100),
    session(9, 100),
    session(6, 100),
    session(0, 90),
  ];
  const kinds = evaluate(sessions, [arm(0, 2)], CNS_DEFAULT_PCT, TODAY).map(
    (f) => f.kind,
  );
  assert.deepEqual(kinds, ["injury", "cns"]);
});

test("a clean check-in with no history raises nothing", () => {
  assert.deepEqual(evaluate([], [arm(0, 5)], CNS_DEFAULT_PCT, TODAY), []);
});

/* ------------------------------------------------------------------ *
 * guidance
 * ------------------------------------------------------------------ */

test("pain that limits movement stops throwing outright", () => {
  const g = guidance([flag("injury", { severity: "pain-limiting" })], [], [], TODAY);
  assert.equal(g.level, "stop");
  assert.equal(g.title, "Stop throwing");
});

test("pain that does not limit movement drops to recovery, not a shutdown", () => {
  const g = guidance([flag("injury", { severity: "pain" })], [], [], TODAY);
  assert.equal(g.level, "caution");
  assert.equal(g.title, "Recovery day");
});

test("injury severity is read off the flag, never off today's check-in", () => {
  // The athlete reported pain that limited movement, then felt better two days
  // later. Feeling better is not the same as having been looked at: only a
  // coach clearing the flag changes this message.
  const g = guidance(
    [flag("injury", { severity: "pain-limiting" })],
    [],
    [arm(0, 5)],
    TODAY,
  );
  assert.equal(g.title, "Stop throwing");
});

test("a flag predating severity falls back to reading the latest check-in", () => {
  const legacy = flag("injury", { severity: null });
  assert.equal(guidance([legacy], [], [arm(0, 1)], TODAY).title, "Stop throwing");
  assert.equal(guidance([legacy], [], [arm(0, 2)], TODAY).title, "Recovery day");
});

test("an open injury outranks CNS and soreness", () => {
  const open = [flag("cns"), flag("soreness"), flag("injury", { severity: "pain" })];
  assert.equal(guidance(open, [], [arm(0, 3)], TODAY).kind, "injury");
});

test("a CNS flag prescribes a deload", () => {
  const g = guidance([flag("cns")], [], [], TODAY);
  assert.equal(g.level, "caution");
  assert.equal(g.title, "Deload week");
});

test("very sore walks recovery -> their call -> day off", () => {
  const day1 = guidance([], [], [arm(0, 3)], TODAY);
  assert.equal(day1.title, "Recovery day");
  assert.equal(day1.level, "recovery");

  const day2 = guidance([], [], [arm(1, 3), arm(0, 3)], TODAY);
  assert.equal(day2.title, "Your call on intensity");

  const day3 = guidance([], [], [arm(2, 3), arm(1, 3), arm(0, 3)], TODAY);
  assert.equal(day3.title, "Take the day off");
  assert.equal(day3.level, "caution");
});

test("a little sore buys a hybrid day, not a shutdown", () => {
  const g = guidance([], [], [arm(0, 4)], TODAY);
  assert.equal(g.level, "recovery");
  assert.equal(g.title, "Hybrid day");
  assert.match(g.body, /Plyos and catch play today, no ladder/);
});

test("a little sore that will not settle finally drops to recovery work", () => {
  const g = guidance([], [], [arm(3, 4), arm(2, 4), arm(1, 4), arm(0, 4)], TODAY);
  assert.equal(g.level, "caution");
  assert.equal(g.title, "Recovery day");
  assert.match(g.body, /Day 4 of a sore arm/);
});

test("easing to a little sore softens the athlete's day even while flagged", () => {
  // Pairs with the evaluate test above: the coach keeps a flag showing the
  // three-day run, while the athlete is told to do hybrid work rather than
  // being shut down for a soreness level that is already improving.
  const entries = [arm(2, 3), arm(1, 3), arm(0, 4)];
  assert.equal(evaluate([], entries, CNS_DEFAULT_PCT, TODAY).length, 1);
  assert.equal(guidance([], [], entries, TODAY).title, "Hybrid day");
});

test("throwing yesterday makes today a recovery day by default", () => {
  const g = guidance([], [session(1, 95)], [arm(0, 5)], TODAY);
  assert.equal(g.level, "recovery");
  assert.equal(g.title, "Recovery day");
  assert.equal(g.kind, null);
});

test("nothing flagged and no session yesterday is a green light", () => {
  const g = guidance([], [session(3, 95)], [arm(0, 5)], TODAY);
  assert.equal(g.level, "clear");
  assert.equal(g.title, "Green light");
});

test("a resolved flag is the caller's to filter — guidance trusts what it is given", () => {
  // guidance() takes OPEN setbacks. Passing none means none are open, even
  // with an athlete reporting a clear arm on the day a flag was raised.
  assert.equal(guidance([], [], [arm(0, 5)], TODAY).level, "clear");
});
