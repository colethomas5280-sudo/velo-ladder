import type { RecoveryEntry, TrackerId, TrainingSession } from "./types";
import { recoveryScore } from "./recovery";
import { recStatsG, shiftDate } from "./velo";

/* ------------------------------------------------------------------ *
 * Putting recovery and velocity on one axis
 *
 * The progress chart used to plot sessions evenly spaced, one per slot, with
 * recovery drawn only for the days an athlete happened to throw. That answers
 * "how did I feel on throw days" and throws away every rest day — which is
 * most of them, and the part that explains why a session went the way it did.
 *
 * So the axis is calendar time: one slot per day, whether anything happened on
 * it or not. Recovery fills nearly every slot; velocity fills the few that were
 * training days. The gaps are the point.
 * ------------------------------------------------------------------ */

/** Widths offered in the chart's chips: 1, 2, 4 and 8 weeks. */
export const CHART_WINDOWS = [7, 14, 28, 56] as const;
export type ChartWindow = (typeof CHART_WINDOWS)[number];

/** How far one press of the back arrow moves the window. */
export const STEP_DAYS = 7;

export interface ProgressDay {
  date: string;
  /** 0-100 for a day with a check-in, else null. */
  recovery: number | null;
  /** The day's work for the selected weight group; null on a day with none. */
  best: number | null;
  avg: number | null;
  min: number | null;
}

export interface ProgressWindow {
  /** One entry per calendar day, oldest first. */
  days: ProgressDay[];
  from: string;
  to: string;
  /** Is there anything before `from` worth paging back to? */
  hasEarlier: boolean;
  /** Is the window sitting behind the present? */
  hasLater: boolean;
  sessionDays: number;
  recoveryDays: number;
}

export function progressWindow({
  sessions,
  recovery,
  keys,
  trackerId,
  spanDays,
  offsetWeeks,
  asOf,
}: {
  sessions: TrainingSession[];
  recovery: RecoveryEntry[];
  /** Slot keys of the weight group on screen, e.g. the folded 5 oz pair. */
  keys: string[];
  trackerId: TrackerId;
  spanDays: number;
  /** 0 is the window ending today; each step is a week further back. */
  offsetWeeks: number;
  asOf: string;
}): ProgressWindow {
  const to = shiftDate(asOf, -offsetWeeks * STEP_DAYS);
  const from = shiftDate(to, -(spanDays - 1));

  /*
   * Group by day before reading any numbers. Two sessions on one date share a
   * slot, so the day is scored as one piece of work — `recStatsG` pools every
   * throw across them rather than averaging two averages, which would let a
   * three-throw set count as heavily as a twelve-throw one.
   */
  const byDate = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    if (s.type !== trackerId) continue;
    const day = byDate.get(s.date);
    if (day) day.push(s);
    else byDate.set(s.date, [s]);
  }

  const recByDate = new Map<string, number>();
  for (const e of recovery) {
    const score = recoveryScore(e);
    if (score != null) recByDate.set(e.date, score);
  }

  const days: ProgressDay[] = [];
  let sessionDays = 0;
  let recoveryDays = 0;

  for (let i = 0; i < spanDays; i++) {
    const date = shiftDate(from, i);
    const daySessions = byDate.get(date);
    const stats = daySessions ? recStatsG(daySessions, keys) : null;
    // A session logged for a different weight leaves this day empty, so read
    // presence off the throws found rather than off the session existing.
    const threw = stats != null && stats.n > 0;
    const rec = recByDate.get(date) ?? null;

    if (threw) sessionDays++;
    if (rec != null) recoveryDays++;

    days.push({
      date,
      recovery: rec,
      best: threw ? stats!.pr : null,
      avg: threw ? stats!.avg : null,
      min: threw ? stats!.min : null,
    });
  }

  /*
   * The back arrow is offered only when pressing it would show something. A
   * check-in counts as history on its own: a week an athlete logged but never
   * threw in is still a week worth looking at, and on this chart it is most of
   * what there is to see.
   */
  const hasEarlier =
    sessions.some((s) => s.type === trackerId && s.date < from) ||
    recovery.some((e) => e.date < from);

  return {
    days,
    from,
    to,
    hasEarlier,
    hasLater: offsetWeeks > 0,
    sessionDays,
    recoveryDays,
  };
}

/* ------------------------------------------------------------------ *
 * Drawing the line between sessions
 * ------------------------------------------------------------------ */

export interface Pt {
  x: number;
  y: number;
}

/** A cubic Bezier leg: two control points and where it ends. */
export interface CurveSegment {
  c1: Pt;
  c2: Pt;
  to: Pt;
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson), as Bezier control points.
 *
 * Smoothing a velocity line is not purely cosmetic. A Catmull-Rom or cardinal
 * spline bulges past the points it joins, so the curve between two sessions
 * can peak above either of them — drawing a number the athlete never threw,
 * sometimes above the dashed line marking their own PR.
 *
 * This keeps each segment monotone: between two sessions the curve can only
 * travel between those two values. Two guards do that work — a tangent
 * pointing against a segment's direction is zeroed, and the remaining
 * tangents are scaled back inside the Fritsch-Carlson circle.
 */
export function smoothPath(points: Pt[]): CurveSegment[] {
  const n = points.length;
  if (n < 2) return [];

  const dx: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1].x - points[i].x;
    dx.push(h);
    delta.push(h === 0 ? 0 : (points[i + 1].y - points[i].y) / h);
  }

  // Tangents start as the average of the neighbouring secants.
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) / 2;

  for (let i = 0; i < n - 1; i++) {
    // A flat segment must stay flat, or the curve dips around a plateau.
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    // A tangent running against the segment guarantees a bulge past an end.
    if (m[i] / delta[i] < 0) m[i] = 0;
    if (m[i + 1] / delta[i] < 0) m[i + 1] = 0;

    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const sq = a * a + b * b;
    if (sq > 9) {
      const t = 3 / Math.sqrt(sq);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }

  const out: CurveSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    out.push({
      c1: { x: points[i].x + h, y: points[i].y + m[i] * h },
      c2: { x: points[i + 1].x - h, y: points[i + 1].y - m[i + 1] * h },
      to: points[i + 1],
    });
  }
  return out;
}
