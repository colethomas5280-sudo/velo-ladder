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

/**
 * A mark to train towards.
 *
 * Two kinds, because two of the five lifts Cole watches are not measured in
 * pounds. A back squat is a multiple of bodyweight; max pull-ups is a rep
 * count — an athlete IS the load, so "2× bodyweight of pull-up" is not a
 * sentence. The discriminant is explicit rather than inferred from the lift's
 * mode so the config says out loud what `target: 10` means.
 */
export type Standard =
  | {
      liftKey: string;
      kind: "ratio";
      /** Multiple of bodyweight. */
      target: number;
      note?: string;
    }
  | {
      liftKey: string;
      kind: "reps";
      /** Reps in one set. */
      target: number;
      note?: string;
    };

/**
 * PROPOSED, NOT COLE'S. These are the commonly cited relative-strength marks
 * for pitchers, put here so there is something to train against on day one —
 * they are his to correct, and changing one is a one-line edit.
 *
 * One target for everyone, by his call: a ratio is a ratio, and splitting it
 * by level would mean deciding that a sixteen-year-old should want less.
 *
 * These are the five lifts Cole says he watches, and no others. The barbell
 * bench on his sheet is deliberately absent — he named the DB press, and a
 * standard on every accessory would turn a target into a scoreboard.
 */
export const STRENGTH_STANDARDS: Standard[] = [
  {
    liftKey: "deadlift",
    kind: "ratio",
    target: 2,
    note: "Twice your bodyweight off the floor.",
  },
  {
    liftKey: "back-squat",
    kind: "ratio",
    target: 1.75,
    note: "The heavier of the two squats, so the heavier mark.",
  },
  {
    liftKey: "front-squat",
    kind: "ratio",
    target: 1.5,
    note: "A front squat runs about 85% of a back squat — same effort, lower number.",
  },
  {
    liftKey: "db-bench-press",
    kind: "ratio",
    target: 0.5,
    note: "Per dumbbell, not the pair — 90s at 180 lb bodyweight.",
  },
  {
    liftKey: "pull-up",
    kind: "reps",
    target: 10,
    note: "Strict, from a dead hang. Ten is the mark.",
  },
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
  kind: Standard["kind"];
  /** What they actually did: an estimated max in lb, or reps in a set. */
  achieved: number;
  /** The day it came from. */
  on: string;
  /**
   * Bodyweight around that day. Required for a ratio — there is no ratio
   * without it — and merely CONTEXT for a rep standard, which is why it is
   * nullable: twelve pull-ups at 200 lb is a different feat from twelve at
   * 150, but an athlete who has never weighed in still has a pull-up count.
   */
  weight: BodyWeight | null;
  /** The number against the target: a multiple of bodyweight, or reps. */
  value: number;
  target: number;
  met: boolean;
  /**
   * What is left: pounds to add to the bar, or reps to add to the set.
   * Zero once it is met — never negative, because "−18 lb to go" reads as a
   * deficit to the person who just cleared the bar.
   */
  toGo: number;
  /** The unit `toGo` is counted in, so the page can never mislabel it. */
  unit: "lb" | "reps";
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
    const mode = menu.mode(s.liftKey);
    /*
     * The standard and the lift have to agree about what is being measured.
     * A ratio needs a loaded lift to take a max of; a rep standard needs a
     * lift actually counted in reps. A mismatch is a config mistake, and
     * silently showing something would hide it.
     */
    if (s.kind === "ratio" && mode !== "load") continue;
    if (s.kind === "reps" && mode !== "reps") continue;

    const best = liftBest(menu, days, s.liftKey);
    if (!best) continue;

    const weight = bodyWeightOn(entries, best.date, profileWeight);

    if (s.kind === "reps") {
      out.push({
        liftKey: s.liftKey,
        kind: "reps",
        achieved: best.value,
        on: best.date,
        weight,
        value: best.value,
        target: s.target,
        met: best.value >= s.target,
        toGo: Math.max(0, s.target - best.value),
        unit: "reps",
        note: s.note,
      });
      continue;
    }

    // A ratio with no denominator is not a ratio.
    if (!weight) continue;
    const value = best.value / weight.lb;
    out.push({
      liftKey: s.liftKey,
      kind: "ratio",
      achieved: best.value,
      on: best.date,
      weight,
      value,
      target: s.target,
      met: value >= s.target,
      toGo: Math.max(0, s.target * weight.lb - best.value),
      unit: "lb",
      note: s.note,
    });
  }

  // Closest to the target first — the one worth a push this block.
  return out.sort((a, b) => b.value / b.target - a.value / a.target);
}

/** "1.72×" for a ratio, "8" for reps — the number as its own kind reads. */
export function fmtValue(r: Relative): string {
  return r.kind === "reps" ? String(r.value) : `${r.value.toFixed(2)}×`;
}

/** "of 2× bodyweight" / "of 10 reps" — what is being chased. */
export function fmtTarget(r: Relative): string {
  return r.kind === "reps"
    ? `of ${r.target} reps`
    : `of ${r.target}× bodyweight`;
}

/**
 * What is left, in the unit it is counted in. Reps round UP the same way
 * pounds do: half a rep short is still short.
 */
export function fmtToGo(r: Relative): string {
  const n = Math.ceil(r.toGo);
  return r.unit === "reps" ? `${n} rep${n === 1 ? "" : "s"} to go` : `${n} lb to go`;
}

/** How far along the bar towards the target, capped at 1 for the meter. */
export function progressTo(r: Relative): number {
  return Math.max(0, Math.min(1, r.value / r.target));
}
