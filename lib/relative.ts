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

/* ------------------------------------------------------------------ *
 * The chart
 *
 * Male strength standards as Cole sent them: estimated 1RM divided by
 * bodyweight, across five bands. Stored whole rather than reduced to the one
 * number the page shows, because the band an athlete has REACHED is the more
 * motivating half — "you are intermediate on this, advanced on that" says
 * more than a single distance from a single target.
 *
 * Leg press is deliberately absent. Cole: the priority is non-machine lifts.
 *
 * Overhead press and barbell row are absent for a different reason — his
 * program runs a half-kneeling landmine press and cable/DB rows, which are
 * not the barbell lifts those rows are measured on. A chart row with no lift
 * to bind to would be a standard nobody can ever meet.
 * ------------------------------------------------------------------ */

export const STRENGTH_LEVELS = [
  "beginner",
  "novice",
  "intermediate",
  "advanced",
  "elite",
] as const;

export type StrengthLevel = (typeof STRENGTH_LEVELS)[number];

/** Keyed by the menu's lift key, so a row can only describe a real lift. */
export const STRENGTH_CHART: Record<string, Record<StrengthLevel, number>> = {
  bench: { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.75, elite: 2 },
  "back-squat": { beginner: 0.75, novice: 1, intermediate: 1.75, advanced: 2.25, elite: 2.5 },
  deadlift: { beginner: 1, novice: 1.25, intermediate: 2, advanced: 2.5, elite: 3 },
  "front-squat": { beginner: 0.6, novice: 0.85, intermediate: 1.25, advanced: 1.75, elite: 2 },
  "barbell-hip-thrust": { beginner: 0.75, novice: 1.25, intermediate: 1.75, advanced: 2.25, elite: 2.75 },
};

/**
 * Where Cole wants his athletes: between these two bands.
 *
 * The target is the midpoint, DERIVED rather than typed. Five typed midpoints
 * would lose their connection to the chart, and moving the ambition to
 * "advanced" would then be five edits that could disagree with each other.
 */
export const TARGET_BAND: readonly [StrengthLevel, StrengthLevel] = [
  "intermediate",
  "advanced",
];

/** The multiple to chase on a lift, or null if the chart has no row for it. */
export function targetFor(liftKey: string): number | null {
  const row = STRENGTH_CHART[liftKey];
  if (!row) return null;
  return (row[TARGET_BAND[0]] + row[TARGET_BAND[1]]) / 2;
}

/**
 * The highest band a ratio has reached, or null when it is below the first.
 *
 * Null rather than "beginner" on purpose: an athlete under the beginner mark
 * has not reached beginner, and labelling him with it would be the app
 * telling him he is somewhere he is not.
 */
export function levelReached(liftKey: string, ratio: number): StrengthLevel | null {
  const row = STRENGTH_CHART[liftKey];
  if (!row) return null;
  let reached: StrengthLevel | null = null;
  for (const level of STRENGTH_LEVELS) if (ratio >= row[level]) reached = level;
  return reached;
}

/**
 * The lifts actually tracked — the five Cole watches.
 *
 * Every ratio target comes off the chart; nothing here is a number I chose.
 * The one exception is max pull-ups, which is measured in REPS: the chart's
 * pull-up row is a weighted 1RM ratio and Cole wants the rep test instead, so
 * that mark is mine and says so.
 *
 * The DB bench press is on the menu for logging but carries no standard —
 * the chart's bench row is a barbell lift, and converting it per-dumbbell
 * would be my arithmetic rather than his chart. Cole's call.
 */
export const STRENGTH_STANDARDS: Standard[] = [
  { liftKey: "deadlift", kind: "ratio", target: targetFor("deadlift")! },
  { liftKey: "back-squat", kind: "ratio", target: targetFor("back-squat")! },
  { liftKey: "front-squat", kind: "ratio", target: targetFor("front-squat")! },
  { liftKey: "bench", kind: "ratio", target: targetFor("bench")! },
  {
    liftKey: "pull-up",
    kind: "reps",
    target: 10,
    note: "Strict, from a dead hang. This mark is not off the chart.",
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
  /** Band reached on the chart. Null for a rep standard, which has no row. */
  level: StrengthLevel | null;
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
        level: null,
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
      level: levelReached(s.liftKey, value),
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
