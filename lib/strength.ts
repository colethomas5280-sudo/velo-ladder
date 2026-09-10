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
 * `reps`  — a bodyweight movement. Weight is whatever was HUNG ON (0 = plain
 *          bodyweight) and progress is reps, because an estimated max off a
 *          chin-up means nothing without knowing what the athlete weighs.
 */
export type LiftMode = "load" | "reps";

export interface Lift {
  key: string;
  name: string;
  /** Section heading in the entry form. */
  group: string;
  mode: LiftMode;
  /** Small print under the name — what counts as a working set here. */
  help?: string;
}

/**
 * The lifts on the menu.
 *
 * A starting list of the main barbell movements, NOT a transcription of any
 * particular program — Cole lifts his athletes off Driveline's, and the exact
 * menu is his to set. It is declarative for that reason: adding, renaming or
 * removing a lift is an edit here and nothing else, because nothing stores a
 * lift's name — only its key.
 *
 * Removing a key that has already been logged hides it from the form and
 * leaves the history intact; `liftByKey` returns null and the panel labels it
 * by its key rather than dropping the sets on the floor.
 */
export const LIFTS: Lift[] = [
  // Lower body
  { key: "trap-bar-deadlift", name: "Trap bar deadlift", group: "Lower body", mode: "load" },
  { key: "back-squat", name: "Back squat", group: "Lower body", mode: "load" },
  { key: "front-squat", name: "Front squat", group: "Lower body", mode: "load" },
  { key: "romanian-deadlift", name: "Romanian deadlift", group: "Lower body", mode: "load" },
  {
    key: "split-squat",
    name: "Rear-foot elevated split squat",
    group: "Lower body",
    mode: "load",
    help: "Log one side — the load, not the total",
  },
  { key: "hip-thrust", name: "Hip thrust", group: "Lower body", mode: "load" },

  // Upper body — push
  { key: "bench-press", name: "Bench press", group: "Push", mode: "load" },
  { key: "incline-db-press", name: "Incline dumbbell press", group: "Push", mode: "load", help: "Per dumbbell" },
  { key: "overhead-press", name: "Overhead press", group: "Push", mode: "load" },

  // Upper body — pull
  {
    key: "chin-up",
    name: "Chin-up",
    group: "Pull",
    mode: "reps",
    help: "Leave the weight blank for bodyweight, or enter what you hung on",
  },
  { key: "barbell-row", name: "Barbell row", group: "Pull", mode: "load" },
  { key: "db-row", name: "Dumbbell row", group: "Pull", mode: "load", help: "Per hand" },
];

/** Group headings in config order, without repeats. */
export const LIFT_GROUPS: string[] = [...new Set(LIFTS.map((l) => l.group))];

const BY_KEY = new Map(LIFTS.map((l) => [l.key, l]));

export function liftByKey(key: string): Lift | null {
  return BY_KEY.get(key) ?? null;
}

/** A lift's name, falling back to its key so retired lifts still read. */
export function liftName(key: string): string {
  return BY_KEY.get(key)?.name ?? key;
}

/** The mode a stored key is read under. Retired keys read as loaded lifts. */
export function liftMode(key: string): LiftMode {
  return BY_KEY.get(key)?.mode ?? "load";
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
export const MAX_WEIGHT = 1000;
export const MAX_REPS = 50;

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
  if (mode === "reps") return stats.longest ? stats.longest.r : null;
  return stats.e1rm;
}

/** What the charted number is called, so the axis can't drift from the maths. */
export const METRIC_LABEL: Record<LiftMode, string> = {
  load: "Est. 1RM",
  reps: "Top set reps",
};

export const METRIC_UNIT: Record<LiftMode, string> = {
  load: "lb",
  reps: "reps",
};

/* ------------------------------------------------------------------ *
 * Reading a lift across days
 * ------------------------------------------------------------------ */

/** Lift keys with at least one set recorded, in config order. */
export function liftsDone(day: DatedLifts): string[] {
  const done = Object.entries(day.lifts)
    .filter(([, sets]) => Array.isArray(sets) && sets.length > 0)
    .map(([key]) => key);
  const order = new Map(LIFTS.map((l, i) => [l.key, i]));
  // A retired key has no place in the order; it sorts to the end, by name.
  return done.sort(
    (a, b) =>
      (order.get(a) ?? LIFTS.length) - (order.get(b) ?? LIFTS.length) ||
      a.localeCompare(b),
  );
}

/** Every lift key this athlete has ever logged, in config order. */
export function liftsEverDone(days: readonly DatedLifts[]): string[] {
  const seen = new Set<string>();
  for (const d of days) for (const k of liftsDone(d)) seen.add(k);
  const order = new Map(LIFTS.map((l, i) => [l.key, i]));
  return [...seen].sort(
    (a, b) =>
      (order.get(a) ?? LIFTS.length) - (order.get(b) ?? LIFTS.length) ||
      a.localeCompare(b),
  );
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
  days: readonly DatedLifts[],
  key: string,
  mode: LiftMode = liftMode(key),
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
export function defaultLift(days: readonly DatedLifts[]): string | null {
  let best: { key: string; n: number; last: string } | null = null;
  for (const key of liftsEverDone(days)) {
    const series = liftSeries(days, key);
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
  days: readonly DatedLifts[],
  key: string,
  mode: LiftMode = liftMode(key),
): LiftRecord | null {
  let best: LiftRecord | null = null;
  for (const p of liftSeries(days, key, mode)) {
    if (p.value == null) continue;
    if (!best || p.value > best.value)
      best = {
        value: p.value,
        date: p.date,
        // The set the number came from, so the caption can't contradict it.
        set: mode === "reps" ? p.stats.longest : p.stats.e1rmSet,
      };
  }
  return best;
}

/** The most recent day a lift was done. */
export function liftLast(
  days: readonly DatedLifts[],
  key: string,
): { date: string; stats: LiftStats } | null {
  const series = liftSeries(days, key);
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
  days: readonly DatedLifts[],
  since: string,
): { key: string; date: string; value: number }[] {
  const out: { key: string; date: string; value: number }[] = [];
  for (const key of liftsEverDone(days))
    for (const p of liftSeries(days, key))
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
export function dayTotals(day: DatedLifts): DayTotals {
  const keys = liftsDone(day);
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

/** "225 × 5", or "BW × 8" / "BW+25 × 8" for a bodyweight lift. */
export function fmtSet(set: LiftSet, mode: LiftMode): string {
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
  return mode === "reps"
    ? `${value} rep${value === 1 ? "" : "s"}`
    : `${Math.round(value)} lb`;
}

/** "12,400 lb" — volume is big and reads better grouped. */
export function fmtVolume(v: number): string {
  return `${Math.round(v).toLocaleString("en-US")} lb`;
}
