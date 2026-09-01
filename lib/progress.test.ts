import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_WINDOWS, progressWindow } from "@/lib/progress";
import { TRACKERS } from "@/lib/velo";
import type { RecoveryEntry, Throws, TrackerId, TrainingSession } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Fixtures — a fixed anchor, so nothing here depends on the day it runs.
 * ------------------------------------------------------------------ */

const D = (back: number): string => {
  const d = new Date("2026-09-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const TODAY = D(0);

const S = (
  back: number,
  throws: Throws,
  type: TrackerId = "pulldown",
  id = `s${back}${type}`,
): TrainingSession =>
  ({ id, athleteId: "a1", type, date: D(back), notes: "", level: null, throws }) as TrainingSession;

/** Index 0 is the 80% primer; it must never reach a stat. */
const fiveOz = (back: number, ...hundreds: number[]) =>
  S(back, { p1: [999, ...hundreds] });

const R = (back: number, energy: number): RecoveryEntry =>
  ({ date: D(back), notes: "", energy } as RecoveryEntry);

const win = (over: Partial<Parameters<typeof progressWindow>[0]> = {}) =>
  progressWindow({
    sessions: [],
    recovery: [],
    keys: ["p1", "p4"],
    trackerId: "pulldown",
    spanDays: 7,
    offsetWeeks: 0,
    asOf: TODAY,
    ...over,
  });

/* ------------------------------------------------------------------ *
 * Window geometry
 * ------------------------------------------------------------------ */

test("the window holds one slot per calendar day, oldest first", () => {
  const w = win({ spanDays: 7 });
  assert.equal(w.days.length, 7);
  assert.equal(w.days[0].date, D(6));
  assert.equal(w.days[6].date, TODAY);
  assert.equal(w.from, D(6));
  assert.equal(w.to, TODAY);
});

test("every offered width produces that many days", () => {
  for (const span of CHART_WINDOWS)
    assert.equal(win({ spanDays: span }).days.length, span);
});

test("the window ends today when the offset is zero", () => {
  assert.equal(win().to, TODAY);
});

test("each step back moves the window a full seven days", () => {
  const one = win({ offsetWeeks: 1 });
  assert.equal(one.to, D(7));
  assert.equal(one.from, D(13));

  const three = win({ offsetWeeks: 3 });
  assert.equal(three.to, D(21));
  assert.equal(three.from, D(27));
});

test("stepping back does not change how much is on screen", () => {
  assert.equal(win({ spanDays: 28, offsetWeeks: 5 }).days.length, 28);
});

/* ------------------------------------------------------------------ *
 * Placing the two series on the axis
 * ------------------------------------------------------------------ */

test("a check-in lands on its own day and nowhere else", () => {
  const w = win({ recovery: [R(3, 4)] });
  const scored = w.days.filter((d) => d.recovery != null);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].date, D(3));
});

test("a session lands on its own day", () => {
  const w = win({ sessions: [fiveOz(2, 90, 92, 94)] });
  const thrown = w.days.filter((d) => d.best != null);
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0].date, D(2));
  assert.equal(thrown[0].best, 94);
});

test("a rest day carries recovery and no velocity", () => {
  // The reason the axis is calendar time rather than sessions: most days
  // have a check-in and nothing thrown.
  const w = win({ recovery: [R(3, 4)], sessions: [fiveOz(2, 90)] });
  const rest = w.days.find((d) => d.date === D(3))!;
  assert.ok(rest.recovery != null);
  assert.equal(rest.best, null);
});

test("a session with no check-in that morning carries velocity and no bar", () => {
  const w = win({ sessions: [fiveOz(2, 90)] });
  const day = w.days.find((d) => d.date === D(2))!;
  assert.equal(day.recovery, null);
  assert.equal(day.best, 90);
});

test("days outside the window are dropped, not clamped to the edge", () => {
  const w = win({ spanDays: 7, sessions: [fiveOz(30, 99)], recovery: [R(30, 5)] });
  assert.ok(w.days.every((d) => d.best == null && d.recovery == null));
});

/* ------------------------------------------------------------------ *
 * What a day's velocity means
 * ------------------------------------------------------------------ */

test("the 80% primer never reaches a day's numbers", () => {
  const w = win({ sessions: [fiveOz(1, 90, 92)] });
  const d = w.days.find((x) => x.date === D(1))!;
  assert.equal(d.best, 92);
  assert.equal(d.avg, 91);
  assert.equal(d.min, 90);
});

test("two sessions on one day pool into a single day's numbers", () => {
  // One slot per day, so a double session is read as one day's work: best of
  // both, floor of both, and the average across every throw rather than an
  // average of the two averages.
  const w = win({
    sessions: [
      S(1, { p1: [999, 100, 100] }, "pulldown", "a"),
      S(1, { p4: [999, 88, 92] }, "pulldown", "b"),
    ],
  });
  const d = w.days.find((x) => x.date === D(1))!;
  assert.equal(d.best, 100);
  assert.equal(d.min, 88);
  assert.equal(d.avg, 95);
});

test("only the tracker being viewed counts", () => {
  const w = win({
    trackerId: "pulldown",
    sessions: [S(1, { m5: [999, 99] }, "mound"), fiveOz(1, 90)],
  });
  assert.equal(w.days.find((x) => x.date === D(1))!.best, 90);
});

test("the weight group decides which slots are read", () => {
  const s = S(1, { p1: [999, 90], p2: [999, 99] });
  const on = (keys: string[]) =>
    win({ sessions: [s], keys }).days.find((d) => d.date === D(1))!.best;
  assert.equal(on(["p1", "p4"]), 90);
  assert.equal(on(["p2"]), 99);
});

test("a session with no throws for this weight leaves the day empty", () => {
  const w = win({ sessions: [S(1, { p2: [999, 99] })], keys: ["p1", "p4"] });
  assert.equal(w.days.find((x) => x.date === D(1))!.best, null);
});

test("a day is only a session day if this weight was actually thrown", () => {
  // `best` is null either way, because recStatsG reports no PR when nothing
  // matched. The count is where the difference shows, and the chart uses it
  // to decide whether to draw a velocity series at all.
  const w = win({ sessions: [S(1, { p2: [999, 99] })], keys: ["p1", "p4"] });
  assert.equal(w.sessionDays, 0);
});

test("the two trackers share no slot keys", () => {
  /*
   * Why progressWindow's `s.type !== trackerId` guard has no visible effect
   * today: a mound session carries only m* slots, so reading p* keys off it
   * finds nothing regardless. The guard is there for the day that stops being
   * true — and this test is what will fail first if it does, pointing at the
   * guard rather than at a chart that quietly plots the wrong sessions.
   */
  const mound = new Set(TRACKERS.mound.slots.map((x) => x.key));
  for (const slot of TRACKERS.pulldown.slots)
    assert.ok(!mound.has(slot.key), `${slot.key} belongs to both trackers`);
});

/* ------------------------------------------------------------------ *
 * What the arrows are allowed to do
 * ------------------------------------------------------------------ */

test("there is nowhere later to go while the window ends today", () => {
  assert.equal(win().hasLater, false);
  assert.equal(win({ offsetWeeks: 1 }).hasLater, true);
});

test("earlier is offered only while something is actually back there", () => {
  const s = [fiveOz(20, 90)];
  assert.equal(win({ spanDays: 7, sessions: s }).hasEarlier, true);
  assert.equal(win({ spanDays: 28, sessions: s }).hasEarlier, false);
});

test("a check-in counts as history too, not just a session", () => {
  // Paging back should reach a week an athlete logged but never threw in.
  assert.equal(win({ spanDays: 7, recovery: [R(20, 3)] }).hasEarlier, true);
});

test("an athlete with no history at all cannot page back", () => {
  assert.equal(win().hasEarlier, false);
});

test("data inside the window is not counted as earlier history", () => {
  assert.equal(win({ spanDays: 7, sessions: [fiveOz(6, 90)] }).hasEarlier, false);
});

/* ------------------------------------------------------------------ *
 * Counts the chart uses to decide what to draw
 * ------------------------------------------------------------------ */

test("the window reports how much of each series it actually holds", () => {
  const w = win({
    sessions: [fiveOz(1, 90), fiveOz(4, 92)],
    recovery: [R(1, 4), R(2, 3), R(30, 5)],
  });
  assert.equal(w.sessionDays, 2);
  assert.equal(w.recoveryDays, 2, "the day outside the window must not count");
});

test("an empty window reports zero of both", () => {
  const w = win();
  assert.equal(w.sessionDays, 0);
  assert.equal(w.recoveryDays, 0);
});
