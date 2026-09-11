import type { RecoveryEntry } from "./types";
import {
  liftBest,
  type DatedLifts,
  type Menu,
} from "./strength";

/* ------------------------------------------------------------------ *
 * Relative strength
 *
 * What an athlete lifts, divided by what they weigh. This is the number Cole
 * wanted the tracker for: not a diary, a target to chase. "245 on the bar" is
 * a fact; "1.7× bodyweight, 55 lb off two" is something to train towards.
 *
 * Two decisions worth stating, because both could reasonably have gone the
 * other way:
 *
 * The bodyweight is the TRENDED one, never a single morning's reading. A
 * weigh-in swings two or three pounds on hydration and food alone, and a
 * ratio built on one would move an athlete's number without them touching a
 * barbell. The recovery card already refuses to report a raw weight for the
 * same reason.
 *
 * And it is the weight from AROUND THE LIFT, not today's. An athlete who
 * squatted 315 in March at 170 lb and now weighs 190 hit 1.85× in March;
 * dividing by today's weight would quietly demote a lift they actually made.
 * ------------------------------------------------------------------ */

export interface Standard {
  liftKey: string;
  /** Target as a multiple of bodyweight. */
  multiple: number;
  /** Why this number, in the athlete's language. */
  note?: string;
}

/**
 * PROPOSED, NOT COLE'S. These are the commonly cited relative-strength marks
 * for pitchers, put here so there is something to train against on day one —
 * they are his to correct, and changing one is a one-line edit.
 *
 * One target for everyone, by his call: a ratio is a ratio, and splitting it
 * by level would mean deciding that a sixteen-year-old should want less.
 *
 * Deliberately only three. A standard on every accessory would turn a target
 * into a scoreboard, and nobody has a published mark for a banded clam.
 */
export const STRENGTH_STANDARDS: Standard[] = [
  {
    liftKey: "deadlift",
    multiple: 2,
    note: "The big one. Twice your bodyweight off the floor.",
  },
  {
    liftKey: "front-squat",
    multiple: 1.5,
    note: "Front squat sits below a back squat — this is the equivalent mark.",
  },
  { liftKey: "bench", multiple: 1.25, note: "Upper body, against your own size." },
];

/* ------------------------------------------------------------------ *
 * The denominator
 * ------------------------------------------------------------------ */

/** Readings this far either side of a date count towards its bodyweight. */
const WINDOW_DAYS = 21;

/** Fewer than this in the window is not a trend, so the window widens. */
const MIN_READINGS = 3;

const dayGap = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(
    Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000),
  );
};

export interface BodyWeight {
  lb: number;
  /** Readings behind it. 1 means a lone weigh-in, which is thin. */
  n: number;
  /** Where it came from, so the page never reports a number without a source. */
  from: "checkins" | "profile";
}

/**
 * What the athlete weighed around `date`.
 *
 * Readings inside three weeks either side, averaged. Below three readings the
 * window is dropped and the nearest three weigh-ins are used instead — an
 * athlete who checks in twice a month still has a bodyweight, it is just a
 * looser one, and `n` says so rather than the page pretending otherwise.
 *
 * Falls back to the weight on their profile, which a coach may have entered
 * by hand and which is better than refusing to show a ratio at all.
 */
export function bodyWeightOn(
  entries: readonly RecoveryEntry[],
  date: string,
  profileWeight: number | null,
): BodyWeight | null {
  const weighed = entries
    .filter((e) => typeof e.bodyWeight === "number" && e.bodyWeight > 0)
    .map((e) => ({ date: e.date, lb: e.bodyWeight as number }));

  if (weighed.length) {
    const near = weighed.filter((w) => dayGap(w.date, date) <= WINDOW_DAYS);
    const used =
      near.length >= MIN_READINGS
        ? near
        : [...weighed]
            .sort((a, b) => dayGap(a.date, date) - dayGap(b.date, date))
            .slice(0, MIN_READINGS);
    const lb = used.reduce((t, w) => t + w.lb, 0) / used.length;
    return { lb, n: used.length, from: "checkins" };
  }

  if (profileWeight && profileWeight > 0)
    return { lb: profileWeight, n: 1, from: "profile" };
  return null;
}

/* ------------------------------------------------------------------ *
 * The ratio
 * ------------------------------------------------------------------ */

export interface Relative {
  liftKey: string;
  /** Best estimated max, and the day it came from. */
  e1rm: number;
  on: string;
  weight: BodyWeight;
  /** e1rm ÷ bodyweight. */
  ratio: number;
  target: number;
  met: boolean;
  /**
   * Pounds still to add to the bar to hit the target at that bodyweight.
   * Zero once it is met — never negative, because "−18 lb to go" reads as a
   * deficit to the person who just cleared the bar.
   */
  toGo: number;
  note?: string;
}

/**
 * Every standard the athlete has a lift for, best first by how close they are.
 *
 * A standard with no logged lift behind it is left out entirely rather than
 * shown at zero: an athlete who has never deadlifted here has not failed the
 * deadlift standard, and a row reading "0.0× — 340 lb to go" is a discouraging
 * way to say "no data".
 */
export function relativeStrength(
  menu: Menu,
  days: readonly DatedLifts[],
  entries: readonly RecoveryEntry[],
  profileWeight: number | null,
  standards: readonly Standard[] = STRENGTH_STANDARDS,
): Relative[] {
  const out: Relative[] = [];

  for (const s of standards) {
    // Only a loaded lift has a max to take a ratio of.
    if (menu.mode(s.liftKey) !== "load") continue;
    const best = liftBest(menu, days, s.liftKey);
    if (!best) continue;

    const weight = bodyWeightOn(entries, best.date, profileWeight);
    if (!weight) continue;

    const ratio = best.value / weight.lb;
    const toGo = Math.max(0, s.multiple * weight.lb - best.value);
    out.push({
      liftKey: s.liftKey,
      e1rm: best.value,
      on: best.date,
      weight,
      ratio,
      target: s.multiple,
      met: ratio >= s.multiple,
      toGo,
      note: s.note,
    });
  }

  // Closest to the target first — the one worth a push this block.
  return out.sort((a, b) => b.ratio / b.target - a.ratio / a.target);
}

/** "1.72×" — two decimals is false precision on a number built from an estimate. */
export function fmtRatio(ratio: number): string {
  return `${ratio.toFixed(2)}×`;
}

/** "2×" / "1.25×" — a target reads exactly as it was written down. */
export function fmtTarget(multiple: number): string {
  return `${multiple}×`;
}

/** How far along the bar towards the target, capped at 1 for the meter. */
export function progressTo(r: Relative): number {
  return Math.max(0, Math.min(1, r.ratio / r.target));
}
