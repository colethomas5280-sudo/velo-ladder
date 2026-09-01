import type { RecoveryEntry, TrainingSession, TrackerId } from "./types";
import { TRACKERS, sBestG } from "./velo";

/* ------------------------------------------------------------------ *
 * Recovery scoring
 *
 * The five 1-5 ratings all point the same way (5 = good), so they can be
 * averaged directly. Sleep hours is mapped onto the same 1-5 range. Only
 * the fields an athlete actually filled in count, so a partial check-in
 * still scores.
 *
 * Resting HR and HRV are stored and charted but deliberately NOT scored:
 * they are personal baselines, and folding one athlete's 48bpm in with
 * another's 62 would produce a number that means nothing.
 * ------------------------------------------------------------------ */

export const RATING_FIELDS = [
  "sleepQuality",
  "soreness",
  "energy",
  "stress",
  "mood",
  "diet",
] as const;

export type RatingKey = (typeof RATING_FIELDS)[number];

interface BaseItem {
  key: string;
  label: string;
  /** small print under the label */
  help?: string;
}

/**
 * A question answered on a scale. `anchors[0]` is what 1 means, the last what
 * `max` means. Scales keep their native length and are normalised only at
 * scoring time, so the stored column always holds what the athlete picked.
 */
export interface RatedItem extends BaseItem {
  kind: "rated";
  anchors: string[];
  /** top of the scale; defaults to 5 */
  max?: number;
}

/**
 * A measurement the athlete types in. Deliberately **never scored** — there is
 * no good or bad bodyweight to average into a wellness number, the same reason
 * resting HR and HRV stay out. It is tracked for its trend instead.
 */
export interface NumericItem extends BaseItem {
  kind: "numeric";
  unit: string;
  min: number;
  max: number;
  placeholder: string;
  /** allow one decimal place */
  decimal?: boolean;
}

export type WellnessItem = RatedItem | NumericItem;

export interface WellnessSection {
  id: string;
  title: string;
  items: WellnessItem[];
}

/**
 * The questionnaire, as data. Adding a section is adding an entry here plus a
 * column per new item — the check-in renders whatever this contains.
 *
 * Every scale runs bad -> good so the answers can be averaged into one score.
 */
/**
 * Sleep bands, in athlete language. These are the answer — asking a
 * seventeen-year-old for the exact hours he slept invents precision he does
 * not have, and a band is what he can actually report honestly.
 *
 * Pitched at a training athlete, not a general adult: 7-8h clears the adult
 * guideline but sits at the bottom of the useful range for someone throwing at
 * max intent, and 6-7h — where most of them actually live — is a deficit, not
 * a floor. Top of the scale opens at 9h, the window sleep-extension work pushes
 * toward — left open-ended rather than capped at 10 so an athlete who slept
 * eleven hours has somewhere honest to put it. The bands shifted up a rung in
 * Aug 2026 for this reason; a 4 now means what a 5 used to.
 */
export const SLEEP_BAND_ANCHORS = [
  "Less than 6 hours",
  "6-7 hours",
  "7-8 hours",
  "8-9 hours",
  "9+ hours",
] as const;

/** The same bands, short enough for a feed line. */
export const SLEEP_BAND_SHORT = ["<6h", "6-7h", "7-8h", "8-9h", "9h+"] as const;

/** Label for a (possibly averaged) band value. */
export function sleepBandLabel(band: number): string {
  const i = Math.min(5, Math.max(1, Math.round(band))) - 1;
  return SLEEP_BAND_ANCHORS[i];
}

export const WELLNESS_SECTIONS: WellnessSection[] = [
  {
    id: "feel",
    title: "How do you feel today?",
    items: [
      {
        kind: "rated",
        key: "energy",
        label: "Fatigue",
        anchors: [
          "Extremely tired",
          "More tired than normal",
          "Normal",
          "Fresh",
          "Very fresh",
        ],
      },
      {
        kind: "rated",
        key: "sleepDuration",
        label: "Sleep duration",
        anchors: [...SLEEP_BAND_ANCHORS],
      },
      {
        kind: "rated",
        key: "sleepQuality",
        label: "Sleep quality",
        help: "Falling asleep, waking, morning feel",
        /*
         * Behavioural, not evaluative. "Slightly unsatisfactory" asks a kid to
         * grade his own night against a standard nobody gave him; "20-30 min,
         * a couple of wake-ups, a bit groggy" is something he can actually
         * recognise. The rating word leads so the collapsed dropdown still
         * reads cleanly once an answer is picked.
         */
        anchors: [
          "Very poor — long struggle to fall asleep, up repeatedly, exhausted",
          "Poor — over 30 min and restless, several wake-ups, unrefreshed",
          "Fair — 20-30 min to fall asleep, a couple of wake-ups, a bit groggy",
          "Good — asleep under 20 min, woke once and resettled, rested",
          "Excellent — asleep in 10-20 min, slept through, wake refreshed",
        ],
      },
      {
        kind: "rated",
        key: "soreness",
        label: "General muscle soreness",
        anchors: [
          "Extremely sore",
          "Very sore",
          "A little sore",
          "Feeling good",
          "Feeling great",
        ],
      },
      {
        kind: "rated",
        key: "stress",
        label: "Stress",
        anchors: [
          "Extremely stressed",
          "Stressed",
          "Normal",
          "Relaxed",
          "Very relaxed",
        ],
      },
      {
        kind: "rated",
        key: "diet",
        label: "Diet",
        anchors: [
          "Terrible quality, way over or under ate",
          "Not good quality, over or under ate",
          "So-so quality, over or under ate a bit",
          "Decent quality, enough calories",
          "Great quality, enough calories",
        ],
      },
    ],
  },
  {
    id: "weight",
    title: "Bodyweight",
    items: [
      {
        kind: "numeric",
        key: "bodyWeight",
        label: "Weight today",
        help: "Morning, before eating, same conditions each time",
        unit: "lb",
        min: 50,
        max: 500,
        placeholder: "185.0",
        decimal: true,
      },
    ],
  },
  {
    id: "arm",
    title: "Arm readiness",
    items: [
      {
        kind: "rated",
        key: "armReadiness",
        label: "How's the arm?",
        anchors: [
          "Pain (limiting movement)",
          "Pain/soreness (not limiting movement)",
          "No pain (very sore)",
          "No pain (a little sore)",
          "No pain (no soreness)",
        ],
      },
    ],
  },
];

/** Every *scored* question, across all sections. Numeric items are excluded. */
export const ANSWERED_ITEMS: RatedItem[] = WELLNESS_SECTIONS.flatMap((s) =>
  s.items.filter((i): i is RatedItem => i.kind === "rated"),
);

/**
 * Put a value from a scale of any length onto the shared 1-5 range so the
 * sections can be averaged together. A 1-4 answer becomes 1 / 2.33 / 3.67 / 5.
 */
export function normalizeRating(value: number, max = 5): number {
  if (max === 5) return value;
  return 1 + ((value - 1) / (max - 1)) * 4;
}

/**
 * Legacy 1-5 columns no longer asked for, still scored on old entries.
 *
 * `sleepQuality` came back off this list — it is a live question again. Moving
 * an item between here and the questionnaire is score-neutral by construction:
 * both paths contribute the raw 1-5 value, so no historical entry re-scores.
 */
const RETIRED_FIELDS = ["mood"] as const;

/**
 * Which band typed hours fall into. LEGACY ONLY — athletes pick the band
 * directly now. Kept to read entries logged before the hours box was removed.
 */
export function sleepBand(hours: number): number {
  if (hours < 6) return 1;
  if (hours < 7) return 2;
  if (hours < 8) return 3;
  if (hours < 9) return 4;
  return 5;
}

/**
 * The band for an entry, however it was recorded — picked directly on new
 * check-ins, derived from typed hours on ones logged before the box was
 * removed. A typed 7.5 genuinely is the "7-8 hours" band, so nothing is lost.
 */
export function entryBand(e: RecoveryEntry): number | null {
  if (typeof e.sleepDuration === "number") return e.sleepDuration;
  if (typeof e.sleepHours === "number" && e.sleepHours > 0)
    return sleepBand(e.sleepHours);
  return null;
}

/**
 * LEGACY sleep scoring, for entries that stored typed hours rather than a band.
 * No production entry has ever used this path — the hours box was removed
 * before `recovery_entries` existed in production — but it is kept so a local
 * or imported entry still scores. Tracks the same bands: 9-10h is the target,
 * piling on past that is not extra credit, and undersleeping is the steeper
 * penalty.
 *
 *   5h -> 1.0    7h -> 3.0    9h -> 5.0    10h -> 5.0    12h -> 4.2
 */
export function sleepToRating(hours: number): number {
  if (hours <= 5) return 1;
  if (hours <= 9) return 1 + (hours - 5); // 5h..9h -> 1..5
  if (hours <= 10) return 5; // the target window
  return Math.max(3.5, 5 - (hours - 10) * 0.4);
}

/**
 * Composite 0-100, or null when nothing scoreable was filled in.
 * Averages only what is present, so a partial check-in still scores and
 * changing the questionnaire never rewrites old entries.
 */
export function recoveryScore(e: RecoveryEntry): number | null {
  const parts: number[] = [];

  for (const item of ANSWERED_ITEMS) {
    const v = (e as unknown as Record<string, unknown>)[item.key];
    const max = item.max ?? 5;
    if (typeof v === "number" && v >= 1 && v <= max)
      parts.push(normalizeRating(v, max));
  }
  for (const f of RETIRED_FIELDS) {
    const v = e[f];
    if (typeof v === "number" && v >= 1 && v <= 5) parts.push(v);
  }
  /*
   * Legacy sleep: entries from when hours were typed rather than banded.
   * Guarded on `sleepDuration` being absent, so an old entry that gets edited —
   * picking up a band while keeping its hours — doesn't score sleep twice.
   */
  if (
    e.sleepDuration == null &&
    typeof e.sleepHours === "number" &&
    e.sleepHours > 0
  )
    parts.push(sleepToRating(e.sleepHours));

  if (!parts.length) return null;
  const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(mean * 20);
}

export function scoreBand(score: number): "low" | "mid" | "high" {
  if (score >= 75) return "high";
  if (score >= 50) return "mid";
  return "low";
}

/* ------------------------------------------------------------------ *
 * Bodyweight
 *
 * Never scored, for the same reason resting HR isn't: there is no good or bad
 * number to average into a wellness score, and pretending otherwise would put
 * a value judgement on a teenager's weight. It is tracked for its trend.
 *
 * A single morning weight is mostly noise — hydration, food and timing move it
 * two or three pounds day to day. The rolling 7-day mean is the number that
 * actually says whether an athlete is gaining, so that is what gets shown.
 * ------------------------------------------------------------------ */

/** Check-ins needed inside a window before its average means anything. */
const MIN_READINGS = 3;

/** Windows the athlete can look back over, in days. */
export const TREND_WINDOWS = [7, 14, 28] as const;
export type TrendWindow = (typeof TREND_WINDOWS)[number];

/** How a window reads as an adjective: "7-day", "2-week", "4-week". */
export function windowLabel(days: number): string {
  return days % 7 === 0 && days > 7 ? `${days / 7}-week` : `${days}-day`;
}

/** How a window reads as a noun phrase: "7 days", "2 weeks", "4 weeks". */
export function windowPhrase(days: number): string {
  if (days % 7 === 0 && days > 7) {
    const w = days / 7;
    return `${w} week${w === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}

export interface Trend {
  /** rolling mean across the window */
  avg: number | null;
  /** rolling mean across the window before it */
  prev: number | null;
  /** avg − prev: the move between comparable periods */
  change: number | null;
  /** readings behind `avg` */
  n: number;
  /** the window this was computed over, so labels can't drift from the maths */
  days: number;
}

export interface WeightTrend extends Trend {
  latest: number;
  latestDate: string;
  /** the latest reading against its own window — a swing here is fluid, not mass */
  acute: number | null;
}

const dayDiff = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
};

/**
 * Mean of the readings whose age sits in [from, to) days behind `anchor`.
 * Null below MIN_READINGS: three points is thin, but fewer is not a trend.
 */
function windowMean(
  readings: { date: string; value: number }[],
  anchor: string,
  from: number,
  to: number,
): { mean: number | null; n: number } {
  const xs = readings
    .filter((r) => {
      const age = dayDiff(r.date, anchor);
      return age >= from && age < to;
    })
    .map((r) => r.value);
  return {
    mean: xs.length >= MIN_READINGS ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    n: xs.length,
  };
}

/*
 * Both trends below window by DATE, not by "the last N readings". An athlete
 * who checks in seven times across three weeks has a three-week average, and
 * calling it a seven-day one would be a quiet lie — which is exactly what the
 * recovery card used to do.
 */

/** Recovery score across a window, and how it compares with the window before. */
export function scoreTrend(
  entries: RecoveryEntry[],
  days: number = 7,
): Trend | null {
  const scored = entries
    .map((e) => ({ date: e.date, value: recoveryScore(e) }))
    .filter((r): r is { date: string; value: number } => r.value != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!scored.length) return null;

  const anchor = scored[scored.length - 1].date;
  const cur = windowMean(scored, anchor, 0, days);
  const prev = windowMean(scored, anchor, days, days * 2);

  return {
    avg: cur.mean,
    prev: prev.mean,
    change: cur.mean != null && prev.mean != null ? cur.mean - prev.mean : null,
    n: cur.n,
    days,
  };
}

/**
 * Bodyweight across a window. A single morning weigh-in is mostly noise —
 * hydration, food and timing move it two or three pounds day to day — so the
 * headline is the rolling mean, never the latest reading.
 */
export function weightTrend(
  entries: RecoveryEntry[],
  days: number = 7,
): WeightTrend | null {
  const weighed = entries
    .filter((e) => typeof e.bodyWeight === "number" && e.bodyWeight > 0)
    .map((e) => ({ date: e.date, value: e.bodyWeight as number }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!weighed.length) return null;

  const last = weighed[weighed.length - 1];
  const cur = windowMean(weighed, last.date, 0, days);
  const prev = windowMean(weighed, last.date, days, days * 2);

  return {
    latest: last.value,
    latestDate: last.date,
    avg: cur.mean,
    prev: prev.mean,
    change: cur.mean != null && prev.mean != null ? cur.mean - prev.mean : null,
    acute: cur.mean != null ? last.value - cur.mean : null,
    n: cur.n,
    days,
  };
}

/* ------------------------------------------------------------------ *
 * Velocity ↔ recovery
 * ------------------------------------------------------------------ */

export interface Insight {
  /** paired throwing days used */
  n: number;
  topScore: number | null;
  bottomScore: number | null;
  /** mean sleep *band* (1-5), not hours — bands are what gets recorded */
  topSleep: number | null;
  bottomSleep: number | null;
  topVelo: number;
  bottomVelo: number;
}

/** Best 100% throw of a session across every weight. */
function sessionTop(s: TrainingSession): number | null {
  let best: number | null = null;
  for (const g of TRACKERS[s.type as TrackerId].groups) {
    const v = sBestG(s, g.keys);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/**
 * Pair each throwing day with that morning's check-in, then compare the
 * athlete's best throwing days against their worst. Needs at least six
 * paired days before it will claim anything.
 */
export function buildInsight(
  sessions: TrainingSession[],
  entries: RecoveryEntry[],
): Insight | null {
  const byDate = new Map<string, RecoveryEntry>();
  for (const e of entries) byDate.set(e.date, e);

  const paired: { velo: number; score: number | null; sleep: number | null }[] =
    [];
  for (const s of sessions) {
    const velo = sessionTop(s);
    const e = byDate.get(s.date);
    if (velo == null || !e) continue;
    paired.push({
      velo,
      score: recoveryScore(e),
      sleep: entryBand(e),
    });
  }
  if (paired.length < 6) return null;

  paired.sort((a, b) => b.velo - a.velo);
  const cut = Math.max(1, Math.floor(paired.length / 3));
  const top = paired.slice(0, cut);
  const bottom = paired.slice(-cut);

  return {
    n: paired.length,
    topScore: avg(top.map((p) => p.score).filter((x): x is number => x != null)),
    bottomScore: avg(
      bottom.map((p) => p.score).filter((x): x is number => x != null),
    ),
    topSleep: avg(top.map((p) => p.sleep).filter((x): x is number => x != null)),
    bottomSleep: avg(
      bottom.map((p) => p.sleep).filter((x): x is number => x != null),
    ),
    topVelo: avg(top.map((p) => p.velo))!,
    bottomVelo: avg(bottom.map((p) => p.velo))!,
  };
}
