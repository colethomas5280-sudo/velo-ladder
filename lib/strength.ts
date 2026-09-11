/* ------------------------------------------------------------------ *
 * Strength
 *
 * The lifting half of the tracker. An athlete logs what they actually did —
 * every working set, weight by reps — and the panel turns that into the three
 * numbers a lifting day is read by: the heaviest set, an estimated one-rep
 * max, and total volume.
 *
 * Kept pure and free of `pg` on purpose: the entry form, the roster and the
 * validator all read the same config, and a client component importing a
 * value out of a module that reaches the database breaks the build.
 * ------------------------------------------------------------------ */

/**
 * How a lift's progress is read.
 *
 * `load` — a barbell or dumbbell movement. Weight is the load on the bar and
 *          progress is an estimated one-rep max.
 * `reps` — a bodyweight movement. Weight is whatever was HUNG ON (0 = plain
 *          bodyweight) and progress is reps, because an estimated max off a
 *          chin-up means nothing without knowing what the athlete weighs.
 * `time` — a hold. The count is SECONDS rather than reps: a high plank is
 *          2x45s and there is no rep in it to estimate anything from.
 *
 * A set is always `{w, r}` whatever the mode — `r` is "the thing that was
 * counted" and the mode says what it counts. That keeps one stored shape for
 * every lift rather than a column per kind of work.
 */
export type LiftMode = "load" | "reps" | "time";

export interface Lift {
  /**
   * Stable forever. Generated from the name when the lift is created and
   * never changed by a rename, because this is what every logged set is
   * filed under — a key that moved would orphan an athlete's history.
   */
  key: string;
  name: string;
  /** Section heading in the entry form. */
  group: string;
  mode: LiftMode;
  /** Small print under the name — what counts as a working set here. "" for none. */
  help: string;
  /** Coach's ordering within the group. */
  position: number;
  /**
   * Retired. Off the entry form, but still named wherever it appears in a
   * history — soft-deleted for the same reason athletes and resources are.
   */
  archived: boolean;
}

/* ------------------------------------------------------------------ *
 * What a brand-new database starts with
 *
 * Every exercise named in the Driveline sheet Cole's athletes lift off —
 * Intermediate Off-Season (Throwing Skill-Dominant), Cycle 1. Taken from his
 * program rather than invented beside it, which is the whole reason the first
 * cut of this list was wrong.
 *
 * It is the SEED and nothing more. The live menu is the `lifts` table, which
 * Cole edits himself. Every INSERT is ON CONFLICT (key) DO NOTHING and the
 * seed runs on every /api/setup, so the two halves of that behave differently
 * on purpose: adding a NEW key here reaches his live menu on the next setup,
 * while editing an existing one never does — or a deploy would quietly
 * overwrite his own renames.
 *
 * The PROGRAMMING — which of these to do, in what order, for how many sets —
 * lives in Velo Beam. This app holds the lift and the log, not the plan.
 * ------------------------------------------------------------------ */

interface ExerciseDef {
  key: string;
  name: string;
  group: string;
  mode: LiftMode;
  help?: string;
}

const SEED_LIFTS: ExerciseDef[] = [
  // Day 1
  { key: "front-squat", name: "Front squat", group: "Lower body", mode: "load" },
  {
    key: "prone-1-arm-trap-raise",
    name: "Prone 1-arm trap raise",
    group: "Shoulder care",
    mode: "load",
    help: "Per side: the load in one hand, not the total",
  },
  {
    key: "reverse-lunge",
    name: "Reverse lunge",
    group: "Lower body",
    mode: "load",
    help: "Per side: the load you carried, not the total",
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
  /*
   * The last four are NOT off the Driveline sheet. Cole named Back Squat, DB
   * Bench Press, Max Pull-ups and a Barbell Row as lifts he watches, and none
   * was in the cycle he sent — the sheet's "Bench" is a separate barbell lift,
   * which is why this does not reuse that key, and its row work is the three
   * point DB row, which stays alongside. Appended rather than slotted in, so
   * nothing above them shifts position.
   */
  { key: "back-squat", name: "Back squat", group: "Lower body", mode: "load" },
  { key: "barbell-row", name: "Barbell row", group: "Pull", mode: "load" },
  {
    key: "db-bench-press",
    name: "DB bench press",
    group: "Push",
    mode: "load",
    help: "Per dumbbell, like the rest of the dumbbell work",
  },
  {
    key: "pull-up",
    name: "Max pull-ups",
    group: "Pull",
    mode: "reps",
    help: "Strict, neutral grip, from a dead hang. Log the reps, and any weight you hung on",
  },
  {
    key: "single-leg-pallof-press",
    name: "Single leg Pallof press",
    group: "Core & hips",
    mode: "reps",
    help: "Per side",
  },
];

/**
 * Seeded lifts absent from a live menu.
 *
 * Pure so it can be tested without a database, and named because the failure
 * it catches is silent: the lift menu grows by INSERT ... ON CONFLICT DO
 * NOTHING, so a rejected insert and a successful one produce the same output.
 * That is not hypothetical — a CHECK constraint on `mode` once rejected every
 * `time` lift, and nothing said so.
 *
 * Retired lifts are ARCHIVED rather than deleted, so their keys are still
 * present; only a genuine insert failure shows up here.
 */
export function missingSeedLifts(present: readonly string[]): string[] {
  const have = new Set(present);
  return SEED_LIFTS.filter((l) => !have.has(l.key)).map((l) => l.key);
}

/** The seed as real rows: position by declaration order, none archived. */
export function seedLifts(): Lift[] {
  return SEED_LIFTS.map((e, i) => ({
    key: e.key,
    name: e.name,
    group: e.group,
    mode: e.mode,
    // Always a string, never absent. An optional field that is sometimes
    // missing and sometimes `undefined` compares unequal to itself across
    // the wire, which is a needless way to make two identical menus differ.
    help: e.help ?? "",
    position: i,
    archived: false,
  }));
}

/* ------------------------------------------------------------------ *
 * The menu
 *
 * Every derived function takes one. The menu used to be this module's own
 * constant, which stopped being true the moment Cole could edit it: the
 * lifts live in the database now and the answer to "what is this key called"
 * depends on what he has done to it.
 *
 * Built from EVERY lift, archived included. A retired lift still has to be
 * named wherever it appears in a history — an athlete who benched for a year
 * should not find that year relabelled `bench-press` because the movement
 * came off the menu.
 * ------------------------------------------------------------------ */

export interface Menu {
  /** Live lifts, in the coach's order. What the entry form offers. */
  lifts: Lift[];
  /** Group headings in that order, without repeats. */
  groups: string[];
  /** A lift by key, archived included; null for a key never defined. */
  get(key: string): Lift | null;
  /** A lift's name, falling back to the key so nothing renders blank. */
  name(key: string): string;
  /** How a key is read. Anything unknown reads as a loaded lift. */
  mode(key: string): LiftMode;
  /** Sort position. Anything not on the live menu sorts last. */
  rank(key: string): number;
}

export function liftMenu(all: readonly Lift[]): Menu {
  const byKey = new Map(all.map((l) => [l.key, l]));
  const live = all
    .filter((l) => !l.archived)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const order = new Map(live.map((l, i) => [l.key, i]));
  return {
    lifts: live,
    groups: [...new Set(live.map((l) => l.group))],
    get: (key) => byKey.get(key) ?? null,
    name: (key) => byKey.get(key)?.name ?? key,
    mode: (key) => byKey.get(key)?.mode ?? "load",
    rank: (key) => order.get(key) ?? live.length,
  };
}

/** A menu holding nothing — for a page rendering before its fetch lands. */
export const EMPTY_MENU: Menu = liftMenu([]);

/**
 * The key a new lift gets, from the name the coach typed.
 *
 * Readable rather than a UUID, because these end up as the keys of a JSONB
 * column someone will one day read by hand — `{"back-squat": [...]}` says
 * what it is and `{"f4c1...": [...]}` does not.
 *
 * Made unique against what already exists INCLUDING archived lifts: reusing
 * a retired lift's key would silently graft its history onto the new one.
 * A name with nothing sluggable in it still gets a key, because refusing to
 * create "?" is a worse answer than filing it under `lift`.
 */
export function liftKeyFrom(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "lift";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** One working set. `w` is pounds on the bar (or hung on); `r` is reps. */
export interface LiftSet {
  w: number;
  r: number;
}

/** What one lifting day holds: lift key -> the sets done, in order. */
export type Lifts = Record<string, LiftSet[]>;

/** The shape the pure functions need from a stored day. */
export interface DatedLifts {
  date: string;
  lifts: Lifts;
}

/* ------------------------------------------------------------------ *
 * Limits
 *
 * Shared by the validator and the entry form so a number the form accepts is
 * never one the route refuses. Wide enough not to argue with a real athlete,
 * tight enough that a slipped keypad ("2250") can't set a lifetime PR nobody
 * can beat.
 * ------------------------------------------------------------------ */

export const MAX_SETS = 12;

/** Long enough for "Rear-foot elevated split squat", short enough to render. */
export const MAX_LIFT_NAME = 60;

export function isLiftMode(v: unknown): v is LiftMode {
  return v === "load" || v === "reps" || v === "time";
}
export const MAX_WEIGHT = 1000;
export const MAX_REPS = 50;

/** Ten minutes. Longer than any hold in the program, short of a typo. */
export const MAX_SECONDS = 600;

/**
 * Above this many reps an estimated max is fiction, not arithmetic — every
 * one-rep-max formula is fitted to heavy, low-rep work and a 20-rep set walks
 * straight out of the range it was fitted on. Sets past it still count for
 * volume and still show in the history; they just don't claim a max.
 */
export const E1RM_MAX_REPS = 10;

/**
 * Epley: `w × (1 + r/30)`, with a single returning the weight itself.
 *
 * That last part is not a rounding detail. Epley is fitted for multi-rep sets
 * and hands back `w × 31/30` at one rep, so an athlete who goes in and TESTS
 * a 300lb max would be told his estimated max is 310 — a number he has just
 * demonstrated he cannot lift, and one no honest single will ever beat.
 *
 * Null when the set can't support an estimate: no load on the bar, or more
 * reps than the formula holds for.
 */
export function e1rm(w: number, r: number): number | null {
  if (w <= 0 || r < 1 || r > E1RM_MAX_REPS) return null;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

export interface LiftStats {
  /** Working sets recorded. */
  sets: number;
  /** Reps across all of them. */
  reps: number;
  /** Σ weight × reps. Zero for a bodyweight lift with nothing hung on. */
  volume: number;
  /** The heaviest set; ties go to the one with more reps. */
  top: LiftSet | null;
  /** The longest set; ties go to the heavier. Only interesting in `reps` mode. */
  longest: LiftSet | null;
  /** Best estimated max across the sets, or null when none can support one. */
  e1rm: number | null;
  /**
   * The set that estimate came from — not necessarily the heaviest.
   *
   * Kept because showing the number beside the wrong set is a page arguing
   * with itself: a day of 275x3 and 245x8 estimates 310 off the eight, and
   * captioning it "(275 × 3)" invites an athlete to work out 275x3 = 310 and
   * conclude the app cannot do arithmetic.
   */
  e1rmSet: LiftSet | null;
}

const EMPTY_STATS: LiftStats = {
  sets: 0,
  reps: 0,
  volume: 0,
  top: null,
  longest: null,
  e1rm: null,
  e1rmSet: null,
};

/**
 * Read one lift's day.
 *
 * The best estimated max is taken across every set rather than from the
 * heaviest one: a back-off set of 225×8 estimates higher than a grinding
 * single at 245, and it is the higher of the two that says what the athlete
 * can do. Sets too long to estimate from simply don't contribute one.
 */
export function liftStats(sets: readonly LiftSet[] | undefined): LiftStats {
  if (!sets || !sets.length) return EMPTY_STATS;

  let reps = 0;
  let volume = 0;
  let top: LiftSet | null = null;
  let longest: LiftSet | null = null;
  let best: number | null = null;
  let bestSet: LiftSet | null = null;

  for (const s of sets) {
    reps += s.r;
    volume += s.w * s.r;
    if (!top || s.w > top.w || (s.w === top.w && s.r > top.r)) top = s;
    if (!longest || s.r > longest.r || (s.r === longest.r && s.w > longest.w))
      longest = s;
    const est = e1rm(s.w, s.r);
    if (est != null && (best == null || est > best)) {
      best = est;
      bestSet = s;
    }
  }

  return {
    sets: sets.length,
    reps,
    volume,
    top,
    longest,
    e1rm: best,
    e1rmSet: bestSet,
  };
}

/**
 * The one number a lift is charted and PR'd on.
 *
 * Estimated max for a loaded lift, top-set reps for a bodyweight one. Null
 * when the day holds nothing that number can be built from — a chin-up day
 * with no reps, or a loaded day of nothing but long sets.
 */
export function liftMetric(stats: LiftStats, mode: LiftMode): number | null {
  // A hold and a bodyweight set are read the same way — the longest one.
  if (mode === "reps" || mode === "time")
    return stats.longest ? stats.longest.r : null;
  return stats.e1rm;
}

/**
 * The set the charted number came from.
 *
 * Paired with `liftMetric` deliberately: these two answer "what is the number"
 * and "which set produced it", and a page that shows them side by side is
 * wrong the moment they disagree. It already went wrong once, reading
 * "Best 310 lb (275 × 3)" off a day whose 310 came from 245 × 8.
 */
export function metricSet(stats: LiftStats, mode: LiftMode): LiftSet | null {
  return mode === "load" ? stats.e1rmSet : stats.longest;
}

/**
 * The set worth quoting as "what you last hit" — the heaviest, or the longest
 * where there is no weight to rank by.
 *
 * NOT the same question as `metricSet`, and deliberately not the same answer:
 * the heaviest set is what an athlete wants to see beside a date, while the
 * best estimate may have come from a lighter, longer one.
 */
export function topSet(stats: LiftStats, mode: LiftMode): LiftSet | null {
  return mode === "load" ? stats.top : stats.longest;
}

/** What the charted number is called, so the axis can't drift from the maths. */
export const METRIC_LABEL: Record<LiftMode, string> = {
  load: "Est. 1RM",
  reps: "Top set reps",
  time: "Longest hold",
};

export const METRIC_UNIT: Record<LiftMode, string> = {
  load: "lb",
  reps: "reps",
  time: "seconds",
};

/* ------------------------------------------------------------------ *
 * Reading a lift across days
 * ------------------------------------------------------------------ */

/** Lift keys with at least one set recorded, in config order. */
export function liftsDone(menu: Menu, day: DatedLifts): string[] {
  const done = Object.entries(day.lifts)
    .filter(([, sets]) => Array.isArray(sets) && sets.length > 0)
    .map(([key]) => key);
  // A retired key has no place in the order; it sorts to the end, by name.
  return done.sort((a, b) => menu.rank(a) - menu.rank(b) || a.localeCompare(b));
}

/** Every lift key this athlete has ever logged, in config order. */
export function liftsEverDone(menu: Menu, days: readonly DatedLifts[]): string[] {
  const seen = new Set<string>();
  for (const d of days) for (const k of liftsDone(menu, d)) seen.add(k);
  return [...seen].sort((a, b) => menu.rank(a) - menu.rank(b) || a.localeCompare(b));
}

export interface LiftPoint {
  date: string;
  stats: LiftStats;
  /** The charted number, or null when the day can't support one. */
  value: number | null;
  /** True when `value` beat every earlier day. Never true on the first. */
  record: boolean;
}

/**
 * One lift's history, oldest first.
 *
 * `record` marks a day that beat everything before it. The FIRST day a lift
 * appears is deliberately not a record: it set the number, but calling a
 * first session a personal best turns the badge into noise on every new lift
 * and tells an athlete nothing they didn't know.
 *
 * Ties are not records either. Repeating last month's best is a good day, not
 * a new one, and the point of the badge is that something moved.
 */
export function liftSeries(
  menu: Menu,
  days: readonly DatedLifts[],
  key: string,
  mode: LiftMode = menu.mode(key),
): LiftPoint[] {
  const ordered = [...days]
    .filter((d) => liftStats(d.lifts?.[key]).sets > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let best: number | null = null;
  let seen = false;
  return ordered.map((d) => {
    const stats = liftStats(d.lifts[key]);
    const value = liftMetric(stats, mode);
    const record = seen && value != null && (best == null || value > best);
    if (value != null && (best == null || value > best)) best = value;
    /*
     * A day whose value is null (all long sets, say) still counts as having
     * seen the lift — otherwise the day after it would be treated as the
     * first and its record silently suppressed.
     */
    seen = true;
    return { date: d.date, stats, value, record };
  });
}

/**
 * The lift to show first.
 *
 * The one with the most sessions behind it, ties going to whichever was
 * lifted most recently. Config order is wrong here: it put a trap-bar
 * deadlift done once in July at the top of an athlete's page and left his
 * back squat — five sessions and two PRs — unshown behind a picker, under a
 * caption saying there was nothing to draw yet.
 */
export function defaultLift(menu: Menu, days: readonly DatedLifts[]): string | null {
  let best: { key: string; n: number; last: string } | null = null;
  for (const key of liftsEverDone(menu, days)) {
    const series = liftSeries(menu, days, key);
    if (!series.length) continue;
    const cur = { key, n: series.length, last: series[series.length - 1].date };
    if (!best || cur.n > best.n || (cur.n === best.n && cur.last > best.last))
      best = cur;
  }
  return best?.key ?? null;
}

export interface LiftRecord {
  value: number;
  date: string;
  /** The set the number came from, so a PR can be read as "225 × 5". */
  set: LiftSet | null;
}

/** The best day for a lift, and when. Null when nothing supports a number. */
export function liftBest(
  menu: Menu,
  days: readonly DatedLifts[],
  key: string,
  mode: LiftMode = menu.mode(key),
): LiftRecord | null {
  let best: LiftRecord | null = null;
  for (const p of liftSeries(menu, days, key, mode)) {
    if (p.value == null) continue;
    if (!best || p.value > best.value)
      best = {
        value: p.value,
        date: p.date,
        // The set the number came from, so the caption can't contradict it.
        set: metricSet(p.stats, mode),
      };
  }
  return best;
}

/** The most recent day a lift was done. */
export function liftLast(
  menu: Menu,
  days: readonly DatedLifts[],
  key: string,
): { date: string; stats: LiftStats } | null {
  const series = liftSeries(menu, days, key);
  const last = series[series.length - 1];
  return last ? { date: last.date, stats: last.stats } : null;
}

/**
 * How far back the roster looks for "recent" work.
 *
 * Four weeks, not one. A week is the right window for throwing — an athlete
 * throws most days — but a lifting block runs three or four sessions a week
 * across movements that repeat weekly at most, so a seven-day window would
 * report a squat PR as absent because the squat day hadn't come round yet.
 */
export const STRENGTH_WINDOW = 28;

/** Records set on or after `since`, newest first. */
export function recentRecords(
  menu: Menu,
  days: readonly DatedLifts[],
  since: string,
): { key: string; date: string; value: number }[] {
  const out: { key: string; date: string; value: number }[] = [];
  for (const key of liftsEverDone(menu, days))
    for (const p of liftSeries(menu, days, key))
      if (p.record && p.value != null && p.date >= since)
        out.push({ key, date: p.date, value: p.value });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ------------------------------------------------------------------ *
 * Reading a whole day
 * ------------------------------------------------------------------ */

export interface DayTotals {
  lifts: number;
  sets: number;
  reps: number;
  volume: number;
}

/** Everything across every lift on one day — the line a history row shows. */
export function dayTotals(menu: Menu, day: DatedLifts): DayTotals {
  const keys = liftsDone(menu, day);
  let sets = 0;
  let reps = 0;
  let volume = 0;
  for (const k of keys) {
    const s = liftStats(day.lifts[k]);
    sets += s.sets;
    reps += s.reps;
    volume += s.volume;
  }
  return { lifts: keys.length, sets, reps, volume };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** "225 × 5", "BW × 8" / "BW+25 × 8" for bodyweight, "45s" for a hold. */
export function fmtSet(set: LiftSet, mode: LiftMode): string {
  if (mode === "time")
    return set.w > 0 ? `${trim(set.w)} × ${set.r}s` : `${set.r}s`;
  if (mode === "reps")
    return set.w > 0 ? `BW+${trim(set.w)} × ${set.r}` : `BW × ${set.r}`;
  return `${trim(set.w)} × ${set.r}`;
}

/** A weight without a trailing ".0" — microplates keep their half. */
export function trim(w: number): string {
  return Number.isInteger(w) ? String(w) : String(Math.round(w * 10) / 10);
}

/** The charted number as it reads: "248 lb" or "8 reps". */
export function fmtMetric(value: number | null, mode: LiftMode): string {
  if (value == null) return "–";
  if (mode === "time") return `${value}s`;
  return mode === "reps"
    ? `${value} rep${value === 1 ? "" : "s"}`
    : `${Math.round(value)} lb`;
}

/** "12,400 lb" — volume is big and reads better grouped. */
export function fmtVolume(v: number): string {
  return `${Math.round(v).toLocaleString("en-US")} lb`;
}
