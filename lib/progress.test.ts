import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_WINDOWS, progressWindow, smoothPath, type Pt } from "@/lib/progress";
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

/* ------------------------------------------------------------------ *
 * smoothPath — the curve must never invent a velocity
 * ------------------------------------------------------------------ */

/** Sample a cubic Bezier's y at t. */
const bezierY = (y0: number, y1: number, y2: number, y3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
};

/** Highest and lowest y the drawn curve actually reaches. */
function curveBounds(pts: Pt[]) {
  const segs = smoothPath(pts);
  let lo = Infinity;
  let hi = -Infinity;
  segs.forEach((s, i) => {
    for (let k = 0; k <= 60; k++) {
      const y = bezierY(pts[i].y, s.c1.y, s.c2.y, s.to.y, k / 60);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  });
  return { lo, hi };
}

const at = (...ys: number[]): Pt[] => ys.map((y, x) => ({ x, y }));

test("smoothPath needs at least two points to draw anything", () => {
  assert.deepEqual(smoothPath([]), []);
  assert.deepEqual(smoothPath(at(90)), []);
  assert.equal(smoothPath(at(90, 92)).length, 1);
});

test("one segment per gap between points", () => {
  assert.equal(smoothPath(at(90, 92, 94, 91)).length, 3);
});

test("the curve never rises above the highest point it joins", () => {
  // A spike is what makes a cardinal spline bulge: the curve either side of
  // 100 would arc above it, drawing a velocity that was never thrown.
  const pts = at(90, 90, 100, 90, 90);
  const { hi } = curveBounds(pts);
  assert.ok(hi <= 100 + 1e-9, `curve reached ${hi}, above the 100 it joins`);
});

test("the curve never dips below the lowest point it joins", () => {
  const pts = at(95, 95, 85, 95, 95);
  const { lo } = curveBounds(pts);
  assert.ok(lo >= 85 - 1e-9, `curve reached ${lo}, below the 85 it joins`);
});

test("every segment stays between its own two endpoints", () => {
  // The strong form: not just the overall range, but each leg individually.
  const pts = at(88, 95, 91, 97, 86, 93, 90);
  const segs = smoothPath(pts);
  segs.forEach((s, i) => {
    const a = pts[i].y;
    const b = s.to.y;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let k = 0; k <= 40; k++) {
      const y = bezierY(a, s.c1.y, s.c2.y, b, k / 40);
      assert.ok(
        y >= lo - 1e-9 && y <= hi + 1e-9,
        `segment ${i} reached ${y}, outside [${lo}, ${hi}]`,
      );
    }
  });
});

test("a flat run stays flat rather than rippling", () => {
  const pts = at(92, 92, 92, 92);
  const { lo, hi } = curveBounds(pts);
  assert.ok(Math.abs(hi - 92) < 1e-9 && Math.abs(lo - 92) < 1e-9);
});

test("a steadily climbing line still climbs the whole way", () => {
  const pts = at(88, 90, 92, 94);
  const segs = smoothPath(pts);
  segs.forEach((s, i) => {
    let prev = pts[i].y;
    for (let k = 1; k <= 30; k++) {
      const y = bezierY(pts[i].y, s.c1.y, s.c2.y, s.to.y, k / 30);
      assert.ok(y >= prev - 1e-9, `segment ${i} went backwards`);
      prev = y;
    }
  });
});

test("the curve passes exactly through every real session", () => {
  // The dots sit on the data; the curve must not drift off them.
  const pts = at(90, 96, 89, 94);
  const segs = smoothPath(pts);
  segs.forEach((s, i) => {
    assert.equal(bezierY(pts[i].y, s.c1.y, s.c2.y, s.to.y, 0), pts[i].y);
    assert.equal(s.to.y, pts[i + 1].y);
  });
});

test("uneven gaps between sessions are handled", () => {
  // Sessions are days apart, not evenly spaced, so x steps vary.
  const pts: Pt[] = [
    { x: 0, y: 90 },
    { x: 12, y: 97 },
    { x: 14, y: 88 },
    { x: 40, y: 93 },
  ];
  const segs = smoothPath(pts);
  assert.equal(segs.length, 3);
  const { hi, lo } = curveBounds(pts);
  assert.ok(hi <= 97 + 1e-9 && lo >= 88 - 1e-9);
});

test("a small step into a big jump does not dip below the step", () => {
  /*
   * The case the Fritsch-Carlson circle exists for, and the one my first pass
   * missed. Both tangents point the same way here, so the sign guards do
   * nothing — but the middle tangent is ~5x the first segment's own slope, and
   * an unclamped curve swings well under 88 on its way from 88 to 89.
   */
  /*
   * Chosen by measurement, not by eye: overshoot starts around a 12:1 ratio
   * between neighbouring slopes. These two segments are 15:1, which puts
   * alpha^2 + beta^2 at 65 — comfortably inside the band where the curve
   * misbehaves but a loosened threshold would wave it through. Unclamped this
   * dips to 90.295, below the 90 it starts from.
   */
  // Two ratios on purpose. 15:1 sits just inside the band a loosened
  // threshold would wave through; 55:1 is steep enough to catch a wrong
  // Hermite-to-Bezier constant, which clamping alone would otherwise hide.
  for (const pts of [at(90, 90.5, 98), at(88, 88.2, 99)]) {
    const segs = smoothPath(pts);
    const lo = pts[0].y;
    const hi = pts[1].y;
    for (let k = 0; k <= 400; k++) {
      const y = bezierY(pts[0].y, segs[0].c1.y, segs[0].c2.y, segs[0].to.y, k / 400);
      assert.ok(
        y >= lo - 1e-9 && y <= hi + 1e-9,
        `dipped to ${y}, outside [${lo}, ${hi}]`,
      );
    }
  }
});

test("a plateau between two slopes stays a plateau", () => {
  // Flat data alone proves nothing: every tangent is zero anyway. It takes a
  // flat run with a climb into it and a fall out of it to need the guard.
  const pts = at(90, 95, 95, 90);
  const segs = smoothPath(pts);
  for (let k = 0; k <= 40; k++) {
    const y = bezierY(pts[1].y, segs[1].c1.y, segs[1].c2.y, segs[1].to.y, k / 40);
    assert.ok(Math.abs(y - 95) < 1e-9, `plateau rippled to ${y}`);
  }
});
