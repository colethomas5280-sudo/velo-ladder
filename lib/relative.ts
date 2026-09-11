import type { RecoveryEntry } from "./types";
import {
  e1rm,
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
    }
  /**
   * A standard that graduates.
   *
   * Cole on pull-ups: "once we can get to 14+, I believe we start concerning
   * ourselves with adding weight." So the mark is reps until it is cleared,
   * and the chart's loaded ratio after that. One row on the page, two stages —
   * because an athlete who can do fifteen strict pull-ups does not need to be
   * told "Cleared" every week for the rest of his career.
   *
   * The loaded target is read off the chart via `targetFor`, not carried here.
   */
  | {
      liftKey: string;
      kind: "reps-then-load";
      /** Strict bodyweight reps to clear before added load is the point. */
      reps: number;
      /**
       * Band for the loaded stage, when the usual target band would land
       * somewhere the rep gate has already carried the athlete past.
       */
      loadedBand?: StrengthLevel;
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
  /*
   * Total load INCLUDING the athlete, over bodyweight — so 1.25x is a single
   * with a quarter of your bodyweight hanging off you. This row only comes
   * into play once the rep mark is cleared; see the two-stage standard below.
   */
  "pull-up": { beginner: 0.1, novice: 0.5, intermediate: 1, advanced: 1.25, elite: 1.5 },
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

/** One band's mark for a lift, or null if the chart has no row for it. */
export function markFor(liftKey: string, level: StrengthLevel): number | null {
  return STRENGTH_CHART[liftKey]?.[level] ?? null;
}

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
    kind: "reps-then-load",
    reps: 14,
    /*
     * ELITE, not the usual intermediate-advanced midpoint, and this is the one
     * place the target band is overridden.
     *
     * The rep gate has already carried the athlete past it. Fourteen strict
     * pull-ups puts a 180 lb athlete around 1.33x on this row — above the
     * chart's advanced (1.25x) — so the midpoint target of 1.125x would
     * arrive already met, which is not a target at all. In pounds: the
     * midpoint asks for 23 lb hung on for a single, elite asks for 90.
     *
     * Cole's to move, like every other number here.
     */
    loadedBand: "elite",
    note: "Strict, from a dead hang. Cole's number, not the chart's.",
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
 * Loaded bodyweight lifts
 * ------------------------------------------------------------------ */

export interface LoadedBest {
  /** Estimated 1RM of the TOTAL load: the athlete plus what they hung on. */
  e1rm: number;
  ratio: number;
  on: string;
  weight: BodyWeight;
  /** What was hung on for that set, so the row can name it. */
  added: number;
  reps: number;
}

/**
 * The best loaded set of a bodyweight lift, as a ratio of total load to
 * bodyweight — the number the chart's pull-up row is measured in.
 *
 * The athlete IS most of the load, so a weighted pull-up's real 1RM is
 * `bodyweight + added`, and only then divided by bodyweight. Ignoring the
 * athlete's own weight would call a 25 lb pull-up a 0.14x lift.
 *
 * Evaluated day by day, each against its OWN bodyweight, for the same reason
 * the loaded ratios are: a set done in March was done at March's bodyweight.
 */
export function loadedBest(
  days: readonly DatedLifts[],
  key: string,
  entries: readonly RecoveryEntry[],
  profileWeight: number | null,
): LoadedBest | null {
  let best: LoadedBest | null = null;

  for (const d of days) {
    const sets = d.lifts?.[key];
    if (!sets?.length) continue;
    // Only sets with something hung on: a bodyweight set is the rep stage.
    const loaded = sets.filter((set) => set.w > 0);
    if (!loaded.length) continue;

    const weight = bodyWeightOn(entries, d.date, profileWeight);
    if (!weight) continue;

    for (const set of loaded) {
      const e = e1rm(weight.lb + set.w, set.r);
      if (e == null) continue;
      const ratio = e / weight.lb;
      if (!best || ratio > best.ratio)
        best = { e1rm: e, ratio, on: d.date, weight, added: set.w, reps: set.r };
    }
  }
  return best;
}

/** Most reps in one STRICT set — nothing hung on. */
export function bodyweightReps(
  days: readonly DatedLifts[],
  key: string,
): { reps: number; on: string } | null {
  let best: { reps: number; on: string } | null = null;
  for (const d of days)
    for (const set of d.lifts?.[key] ?? [])
      if (set.w === 0 && (!best || set.r > best.reps))
        best = { reps: set.r, on: d.date };
  return best;
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
    if (s.kind !== "ratio" && mode !== "reps") continue;

    if (s.kind === "reps-then-load") {
      const graduated = resolveGraduating(s, days, entries, profileWeight);
      if (graduated) out.push(graduated);
      continue;
    }

    const best = liftBest(menu, days, s.liftKey);
    if (!best) continue;
    const weight = bodyWeightOn(entries, best.date, profileWeight);

    if (s.kind === "reps") {
      out.push(repsRow(s.liftKey, best.value, best.date, weight, s.target, s.note));
      continue;
    }

    // A ratio with no denominator is not a ratio.
    if (!weight) continue;
    out.push(ratioRow(s.liftKey, best.value, best.date, weight, s.target, s.note));
  }

  // Closest to the target first — the one worth a push this block.
  return out.sort((a, b) => b.value / b.target - a.value / a.target);
}

function repsRow(
  liftKey: string,
  reps: number,
  on: string,
  weight: BodyWeight | null,
  target: number,
  note?: string,
): Relative {
  return {
    liftKey,
    kind: "reps",
    achieved: reps,
    on,
    weight,
    value: reps,
    target,
    met: reps >= target,
    toGo: Math.max(0, target - reps),
    unit: "reps",
    level: null,
    note,
  };
}

function ratioRow(
  liftKey: string,
  e1rmLb: number,
  on: string,
  weight: BodyWeight,
  target: number,
  note?: string,
): Relative {
  const value = e1rmLb / weight.lb;
  return {
    liftKey,
    kind: "ratio",
    achieved: e1rmLb,
    on,
    weight,
    value,
    target,
    met: value >= target,
    toGo: Math.max(0, target * weight.lb - e1rmLb),
    unit: "lb",
    level: levelReached(liftKey, value),
    note,
  };
}

/**
 * Which stage of a graduating standard the athlete is on.
 *
 * Reps until the mark is cleared, the chart's loaded ratio after that — but
 * only once there is loaded work to read it from. An athlete who has just
 * cleared fourteen and never hung a plate on has NOT failed the loaded
 * standard; showing him 0.00x of 1.125x would be the page inventing a
 * setback out of a milestone. He gets his cleared rep row and a note telling
 * him what comes next, until his first loaded set flips the row over.
 */
function resolveGraduating(
  s: Extract<Standard, { kind: "reps-then-load" }>,
  days: readonly DatedLifts[],
  entries: readonly RecoveryEntry[],
  profileWeight: number | null,
): Relative | null {
  const strict = bodyweightReps(days, s.liftKey);
  const cleared = !!strict && strict.reps >= s.reps;
  const target = s.loadedBand
    ? markFor(s.liftKey, s.loadedBand)
    : targetFor(s.liftKey);

  if (cleared && target != null) {
    const loaded = loadedBest(days, s.liftKey, entries, profileWeight);
    if (loaded)
      return ratioRow(
        s.liftKey,
        loaded.e1rm,
        loaded.on,
        loaded.weight,
        target,
        `Total load — you plus the ${trimAdded(loaded.added)} you hung on.`,
      );
  }

  if (!strict) return null;
  const weight = bodyWeightOn(entries, strict.on, profileWeight);
  return repsRow(
    s.liftKey,
    strict.reps,
    strict.on,
    weight,
    s.reps,
    cleared
      ? "Cleared — start adding weight, and this turns into a loaded ratio."
      : s.note,
  );
}

const trimAdded = (lb: number) =>
  `${Number.isInteger(lb) ? lb : Math.round(lb * 10) / 10} lb`;

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

/* ------------------------------------------------------------------ *
 * Carrying enough weight
 *
 * Cole's rule, in his words: "athletes need to be height(inches) x2.5 at
 * minimum, and ideally they are around 2.7x. The average MLB player is 2.8x,
 * while the average HS draftee is 2.5x."
 *
 * Presented as a RANGE with its anchors named, never as a verdict — his call,
 * and it sits right with the rest of the app. The recovery card already
 * refuses to score bodyweight so it never puts a value judgement on a
 * teenager's body; naming what 2.5x and 2.8x actually ARE lets an athlete
 * place himself without being told he is wrong.
 * ------------------------------------------------------------------ */

export interface BodyweightAnchor {
  /** Pounds per inch of height. */
  per: number;
  label: string;
  /** What that number is, so the scale explains itself. */
  note: string;
}

export const BODYWEIGHT_ANCHORS: readonly BodyweightAnchor[] = [
  { per: 2.5, label: "Minimum", note: "about where the average high-school draftee sits" },
  { per: 2.7, label: "Target", note: "where you want to be" },
  { per: 2.8, label: "Pro average", note: "the average MLB player" },
];

/**
 * The anchors as actual pounds at a given height, rounded UP to the nearest 5.
 *
 * Cole's call, and it is about being memorable: "you want to be 200" is a
 * number an athlete carries around, where 197.1 is one he has to look up
 * again. Up rather than nearest because these are minimums — rounding a
 * floor down moves the floor.
 *
 * Rounded HERE rather than at the point of display, so everything derived
 * from a mark agrees with the mark shown. Rounding in the component would
 * print "target 200" beside "11 lb to go" and leave the athlete to notice
 * that 186 + 11 is not 200.
 */
export function bodyweightMarks(
  heightIn: number,
): { anchor: BodyweightAnchor; lb: number }[] {
  return BODYWEIGHT_ANCHORS.map((anchor) => ({
    anchor,
    lb: roundUp5(anchor.per * heightIn),
  }));
}

/** Up to the nearest 5. A target you can hold in your head. */
export function roundUp5(lb: number): number {
  return Math.ceil(lb / 5) * 5;
}

export interface BodyweightStanding {
  heightIn: number;
  weightLb: number;
  /** Pounds per inch — the number the anchors are in. */
  per: number;
  marks: { anchor: BodyweightAnchor; lb: number }[];
  /** The highest anchor reached, or null when below the first. */
  reached: BodyweightAnchor | null;
  /**
   * Pounds to the next anchor up, and which. Null once past the last —
   * there is nothing above "pro average" to chase, and inventing one would
   * push a teenager past where anyone is asking him to be.
   */
  next: { anchor: BodyweightAnchor; lb: number; toGo: number } | null;
}

export function bodyweightStanding(
  heightIn: number,
  weightLb: number,
): BodyweightStanding | null {
  if (!(heightIn > 0) || !(weightLb > 0)) return null;
  const marks = bodyweightMarks(heightIn);

  let reached: BodyweightAnchor | null = null;
  for (const m of marks) if (weightLb >= m.lb) reached = m.anchor;

  const upcoming = marks.find((m) => weightLb < m.lb);

  return {
    heightIn,
    weightLb,
    per: weightLb / heightIn,
    marks,
    reached,
    next: upcoming
      ? { anchor: upcoming.anchor, lb: upcoming.lb, toGo: upcoming.lb - weightLb }
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * What the standards come to, in pounds
 * ------------------------------------------------------------------ */

export interface LiftTarget {
  liftKey: string;
  /** What to aim for: pounds on the bar, or reps in a set. */
  amount: number;
  unit: "lb" | "reps";
  /** The ratio it came from, so the page can show its working. */
  ratio: number | null;
  /**
   * The rung after this one. Only the pull-up has one: clear the reps, then
   * start hanging weight on.
   */
  then?: { added: number; note: string };
}

/**
 * Every standard as a number an athlete can walk up to a bar and try.
 *
 * A ratio is abstract — "2.25x bodyweight" is not something you load. This
 * turns the whole chart into pounds at one specific bodyweight, which is what
 * Cole asked the resource page to do.
 */
export function targetsAt(
  weightLb: number,
  standards: readonly Standard[] = STRENGTH_STANDARDS,
): LiftTarget[] {
  const out: LiftTarget[] = [];
  for (const s of standards) {
    if (s.kind === "ratio") {
      out.push({
        liftKey: s.liftKey,
        amount: s.target * weightLb,
        unit: "lb",
        ratio: s.target,
      });
      continue;
    }
    if (s.kind === "reps") {
      out.push({ liftKey: s.liftKey, amount: s.target, unit: "reps", ratio: null });
      continue;
    }
    // reps-then-load: the reps are the target, the load is the rung after.
    const loaded = s.loadedBand
      ? markFor(s.liftKey, s.loadedBand)
      : targetFor(s.liftKey);
    out.push({
      liftKey: s.liftKey,
      amount: s.reps,
      unit: "reps",
      ratio: null,
      then:
        loaded == null
          ? undefined
          : {
              /*
               * What to HANG ON, not the total. The ratio counts the athlete
               * too, so at 1.5x he is already carrying 1x of it himself —
               * telling him to load 1.5x bodyweight would be half again as
               * much as anyone is asking for.
               */
              added: (loaded - 1) * weightLb,
              note: "once you can do the reps",
            },
    });
  }
  return out;
}

/** 74 -> 6'2" */
export function fmtHeight(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return `${ft}'${inch}"`;
}

/** Targets are rounded to the nearest 5 lb — nobody loads a bar to 403.7. */
export function roundLoad(lb: number): number {
  return Math.round(lb / 5) * 5;
}
