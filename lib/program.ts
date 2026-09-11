import type { Lift, LiftMode } from "./strength";

/* ------------------------------------------------------------------ *
 * The program
 *
 * Cole's athletes lift off Driveline's programming, and the sheet they work
 * from is a prescription: the sets and reps are given, and the WEIGHT column
 * is blank because that is what the athlete fills in. So the app holds both —
 * what was asked for, and what was done — and the entry form is the sheet.
 *
 * Structure, in the sheet's own words:
 *
 *   a CYCLE runs four weeks, the last a deload
 *   a cycle has DAYS, in three tracks: lifting, med ball, conditioning
 *   a day has TIERS, performed in order
 *   a tier has EXERCISES, performed in order AS A SUPERSET — one set of the
 *     first, one of the next, then back round
 *   an exercise has one prescription PER WEEK
 *
 * Position 0 in a tier is the main movement (the bold row in the sheet);
 * anything after it is the accessory supersetted with it.
 * ------------------------------------------------------------------ */

export type Track = "lift" | "medball" | "conditioning";

/** What the prescribed number counts. */
export type Unit = "reps" | "seconds" | "yards";

export interface Prescription {
  week: number;
  sets: number;
  /** Reps, seconds or yards — `unit` says which. */
  amount: number;
  unit: Unit;
  /** "x8/side": the prescription is per side, so the work is doubled. */
  perSide: boolean;
  /** A load the program specifies, like the 2.5lb trap raise. */
  weight?: number;
  /** Where the sheet gives a percentage rather than a load. */
  intensityPct?: number;
}

export interface ProgramSlot {
  track: Track;
  day: number;
  tier: number;
  /** Order within the tier. 0 is the main movement. */
  position: number;
  liftKey: string;
  weeks: Prescription[];
}

export interface ProgramCycle {
  id: string;
  /** Which of Cole's two programs this belongs to. */
  level: "Beginner" | "Intermediate";
  name: string;
  /** Cycle 1, 2, 3… within the level. */
  ordinal: number;
  weeks: number;
  /** The week that is a deload, or null where none is. */
  deloadWeek: number | null;
  notes: string;
  /**
   * False until Cole has read the transcription back against his own sheet.
   *
   * Carried in the data rather than remembered, because an unchecked training
   * program that looks finished is worse than one that says it isn't: the
   * cost of a mistyped set count is a teenager doing the wrong work for four
   * weeks. `/strength/program` says so at the top while this is false.
   */
  checked: boolean;
  slots: ProgramSlot[];
}

/* ------------------------------------------------------------------ *
 * Writing a cycle down
 *
 * The helpers exist so the transcription below reads like the sheet it came
 * from. A row that is hard to check against the original is a row nobody
 * checks, and this is a training program for teenagers — the cost of a
 * mistyped set count is somebody doing the wrong work for four weeks.
 * ------------------------------------------------------------------ */

type RxOpts = {
  unit?: Unit;
  perSide?: boolean;
  weight?: number;
  intensityPct?: number;
};

/** One week: `rx(3, 8)` is three sets of eight. */
const rx = (sets: number, amount: number, o: RxOpts = {}): Omit<Prescription, "week"> => ({
  sets,
  amount,
  unit: o.unit ?? "reps",
  perSide: o.perSide ?? false,
  ...(o.weight === undefined ? {} : { weight: o.weight }),
  ...(o.intensityPct === undefined ? {} : { intensityPct: o.intensityPct }),
});

/** Four weeks, each written out. */
const weeks = (...four: Omit<Prescription, "week">[]): Prescription[] =>
  four.map((p, i) => ({ ...p, week: i + 1 }));

/** Four identical weeks — what most accessories do. */
const every = (sets: number, amount: number, o: RxOpts = {}): Prescription[] =>
  weeks(rx(sets, amount, o), rx(sets, amount, o), rx(sets, amount, o), rx(sets, amount, o));

/* ------------------------------------------------------------------ *
 * The exercises
 *
 * Every movement the program names, and how each is measured. This is the
 * lift menu: it is derived from the program rather than invented beside it,
 * so "what can be logged" and "what is programmed" cannot come apart.
 *
 * Cole edits the live menu in the app; this is only what a fresh database
 * starts with.
 * ------------------------------------------------------------------ */

interface ExerciseDef {
  key: string;
  name: string;
  group: string;
  mode: LiftMode;
  help?: string;
}

const EXERCISES: ExerciseDef[] = [
  // Day 1
  { key: "front-squat", name: "Front squat", group: "Lower body", mode: "load" },
  {
    key: "prone-1-arm-trap-raise",
    name: "Prone 1-arm trap raise",
    group: "Shoulder care",
    mode: "load",
    help: "Per side — the load in one hand, not the total",
  },
  {
    key: "reverse-lunge",
    name: "Reverse lunge",
    group: "Lower body",
    mode: "load",
    help: "Per side — the load you carried, not the total",
  },
  {
    key: "three-point-db-row",
    name: "Three point DB row",
    group: "Pull",
    mode: "load",
    help: "Per hand",
  },
  { key: "push-up", name: "Push-up", group: "Push", mode: "reps" },
  {
    key: "banded-side-lying-clam",
    name: "Banded side lying clam",
    group: "Core & hips",
    mode: "reps",
    help: "Per side",
  },
  { key: "high-plank", name: "High plank", group: "Core & hips", mode: "time" },

  // Day 2
  { key: "bench", name: "Bench", group: "Push", mode: "load" },
  {
    key: "half-kneeling-hip-flexor-mob",
    name: "Half kneeling hip flexor mob",
    group: "Mobility",
    mode: "reps",
    help: "Per side",
  },
  {
    key: "half-kneeling-landmine-press",
    name: "Half kneeling landmine press",
    group: "Push",
    mode: "load",
    help: "Per side",
  },
  { key: "rdl", name: "RDL", group: "Lower body", mode: "load" },
  {
    key: "db-goblet-lateral-lunge",
    name: "DB goblet lateral lunge",
    group: "Lower body",
    mode: "load",
    help: "Per side",
  },
  {
    key: "half-kneeling-cable-high-row",
    name: "Half kneeling cable high row",
    group: "Pull",
    mode: "load",
    help: "Per side",
  },
  { key: "dead-bug", name: "Dead bug", group: "Core & hips", mode: "reps", help: "Per side" },

  // Day 3
  { key: "deadlift", name: "Deadlift", group: "Lower body", mode: "load" },
  {
    key: "cable-external-rotation",
    name: "Cable external rotation",
    group: "Shoulder care",
    mode: "load",
    help: "Per side",
  },
  { key: "barbell-hip-thrust", name: "Barbell hip thrust", group: "Lower body", mode: "load" },
  { key: "bench-t-spine-mob", name: "Bench T-spine mob", group: "Mobility", mode: "reps" },
  { key: "yoga-push-up", name: "Yoga push-up", group: "Push", mode: "reps" },
  {
    key: "band-assisted-nordic-glute-ham",
    name: "Band assisted Nordic glute ham",
    group: "Lower body",
    mode: "reps",
  },
  {
    key: "single-leg-pallof-press",
    name: "Single leg Pallof press",
    group: "Core & hips",
    mode: "reps",
    help: "Per side",
  },
];

/** The exercises as lift rows — the menu a fresh database starts with. */
export function programLifts(): Lift[] {
  return EXERCISES.map((e, i) => ({
    key: e.key,
    name: e.name,
    group: e.group,
    mode: e.mode,
    help: e.help ?? "",
    position: i,
    archived: false,
  }));
}

/* ------------------------------------------------------------------ *
 * Intermediate Off-Season (Throwing Skill-Dominant Focus) — Cycle 1
 *
 * TRANSCRIBED FROM COLE'S SHEET AND NOT YET CHECKED BY HIM. `/strength/program`
 * renders it back in the sheet's own shape so it can be read against the
 * original — the same thing `/tests/reference` does for the movement screen,
 * which is how two config errors got caught there.
 *
 * Lifting only so far. The med ball and conditioning tabs are part of the
 * cycle and belong here too, but several of their cells were not legible in
 * what was sent; transcribing a training program from a guess is not a thing
 * worth doing quickly.
 * ------------------------------------------------------------------ */

const slot = (
  track: Track,
  day: number,
  tier: number,
  position: number,
  liftKey: string,
  ws: Prescription[],
): ProgramSlot => ({ track, day, tier, position, liftKey, weeks: ws });

export const INTERMEDIATE_CYCLE_1: ProgramCycle = {
  id: "intermediate-offseason-c1",
  level: "Intermediate",
  name: "Off-Season (Throwing Skill-Dominant) — Cycle 1",
  ordinal: 1,
  weeks: 4,
  deloadWeek: 4,
  checked: false,
  notes:
    "Lift on high-intensity throwing days, AFTER throwing. Med ball work comes " +
    "before lifting on days 1 and 3. Within a tier the exercises are a superset: " +
    "one set of each in order, then back round. Unless a percentage is given, work " +
    "up to the heaviest weight you can hold good technique with — any set within " +
    "90% of your heaviest that day counts as a working set, anything lighter is a " +
    "warm-up and is not logged. Rest 2-3 minutes between sets.",
  slots: [
    /* ---- Day 1 ---- */
    slot("lift", 1, 1, 0, "front-squat", weeks(rx(3, 6), rx(3, 8), rx(4, 10), rx(3, 6))),
    slot("lift", 1, 1, 1, "prone-1-arm-trap-raise", every(3, 8, { perSide: true, weight: 2.5 })),

    slot("lift", 1, 2, 0, "reverse-lunge",
      weeks(
        rx(3, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(4, 6, { perSide: true }),
        rx(3, 6, { perSide: true }),
      )),
    slot("lift", 1, 2, 1, "three-point-db-row", every(3, 10, { perSide: true })),

    slot("lift", 1, 3, 0, "push-up", weeks(rx(2, 10), rx(3, 10), rx(3, 15), rx(2, 10))),
    slot("lift", 1, 3, 1, "banded-side-lying-clam",
      weeks(
        rx(2, 12, { perSide: true }),
        rx(3, 12, { perSide: true }),
        rx(3, 12, { perSide: true }),
        rx(2, 12, { perSide: true }),
      )),
    slot("lift", 1, 3, 2, "high-plank",
      weeks(
        rx(2, 45, { unit: "seconds" }),
        rx(3, 45, { unit: "seconds" }),
        rx(3, 45, { unit: "seconds" }),
        rx(2, 45, { unit: "seconds" }),
      )),

    /* ---- Day 2 ---- */
    slot("lift", 2, 1, 0, "bench", weeks(rx(3, 6), rx(3, 8), rx(4, 10), rx(3, 6))),
    slot("lift", 2, 1, 1, "half-kneeling-hip-flexor-mob", every(3, 8, { perSide: true })),

    slot("lift", 2, 2, 0, "half-kneeling-landmine-press",
      weeks(
        rx(3, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(4, 6, { perSide: true }),
        rx(3, 6, { perSide: true }),
      )),
    slot("lift", 2, 2, 1, "rdl", weeks(rx(3, 8), rx(3, 8), rx(4, 6), rx(3, 6))),

    slot("lift", 2, 3, 0, "db-goblet-lateral-lunge",
      weeks(
        rx(2, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(2, 8, { perSide: true }),
      )),
    slot("lift", 2, 3, 1, "half-kneeling-cable-high-row",
      weeks(
        rx(2, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(2, 8, { perSide: true }),
      )),
    slot("lift", 2, 3, 2, "dead-bug",
      weeks(
        rx(2, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(3, 8, { perSide: true }),
        rx(2, 8, { perSide: true }),
      )),

    /* ---- Day 3 ---- */
    slot("lift", 3, 1, 0, "deadlift", weeks(rx(3, 6), rx(3, 8), rx(4, 10), rx(3, 6))),
    slot("lift", 3, 1, 1, "cable-external-rotation", every(3, 8, { perSide: true, weight: 5 })),

    slot("lift", 3, 2, 0, "barbell-hip-thrust",
      weeks(rx(3, 8), rx(3, 8), rx(4, 6), rx(3, 6))),
    slot("lift", 3, 2, 1, "bench-t-spine-mob", every(3, 8)),

    slot("lift", 3, 3, 0, "yoga-push-up", weeks(rx(2, 8), rx(3, 8), rx(3, 8), rx(3, 8))),
    slot("lift", 3, 3, 1, "band-assisted-nordic-glute-ham",
      weeks(rx(2, 10), rx(3, 10), rx(3, 10), rx(3, 10))),
    slot("lift", 3, 3, 2, "single-leg-pallof-press",
      weeks(
        rx(3, 10, { perSide: true }),
        rx(3, 10, { perSide: true }),
        rx(3, 10, { perSide: true }),
        rx(2, 10, { perSide: true }),
      )),
  ],
};

export const CYCLES: ProgramCycle[] = [INTERMEDIATE_CYCLE_1];

/* ------------------------------------------------------------------ *
 * Reading a cycle
 * ------------------------------------------------------------------ */

export interface Tier {
  tier: number;
  slots: ProgramSlot[];
}

export interface Day {
  track: Track;
  day: number;
  tiers: Tier[];
}

/** The days of one track, each grouped into its tiers, all in sheet order. */
export function daysOf(cycle: ProgramCycle, track: Track): Day[] {
  const byDay = new Map<number, Map<number, ProgramSlot[]>>();
  for (const s of cycle.slots) {
    if (s.track !== track) continue;
    const tiers = byDay.get(s.day) ?? new Map<number, ProgramSlot[]>();
    byDay.set(s.day, tiers);
    tiers.set(s.tier, [...(tiers.get(s.tier) ?? []), s]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, tiers]) => ({
      track,
      day,
      tiers: [...tiers.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([tier, slots]) => ({
          tier,
          slots: [...slots].sort((a, b) => a.position - b.position),
        })),
    }));
}

/** Which tracks this cycle actually has anything in. */
export function tracksOf(cycle: ProgramCycle): Track[] {
  const order: Track[] = ["lift", "medball", "conditioning"];
  const present = new Set(cycle.slots.map((s) => s.track));
  return order.filter((t) => present.has(t));
}

/** One slot's prescription for a week, or null where that week has none. */
export function rxFor(slot: ProgramSlot, week: number): Prescription | null {
  return slot.weeks.find((w) => w.week === week) ?? null;
}

/** "3 × 8/side", "2 × 45s", "4 × 6" — the sheet's own shorthand. */
export function fmtRx(p: Prescription): string {
  const unit = p.unit === "seconds" ? "s" : p.unit === "yards" ? "yds" : "";
  return `${p.sets} × ${p.amount}${unit}${p.perSide ? "/side" : ""}`;
}

/** What the program says to load it with, where it says anything. */
export function fmtRxLoad(p: Prescription): string | null {
  if (p.intensityPct != null) return `${p.intensityPct}%`;
  if (p.weight != null) return `${p.weight} lb`;
  return null;
}

/** Total prescribed reps for a week, counting both sides where it says /side. */
export function rxVolume(p: Prescription): number {
  return p.sets * p.amount * (p.perSide ? 2 : 1);
}

export const TRACK_LABEL: Record<Track, string> = {
  lift: "Lifting",
  medball: "Med ball",
  conditioning: "Conditioning",
};
