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
  /** derived from typed hours rather than chosen */
  derived?: boolean;
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
        derived: true,
        anchors: [
          "Less than 5 hours",
          "5-6 hours",
          "6-7 hours",
          "7-8 hours",
          "8+ hours",
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
  s.items.filter((i): i is RatedItem => i.kind === "rated" && !i.derived),
);

/**
 * Put a value from a scale of any length onto the shared 1-5 range so the
 * sections can be averaged together. A 1-4 answer becomes 1 / 2.33 / 3.67 / 5.
 */
export function normalizeRating(value: number, max = 5): number {
  if (max === 5) return value;
  return 1 + ((value - 1) / (max - 1)) * 4;
}

/** Legacy 1-5 columns no longer asked for, still scored on old entries. */
const RETIRED_FIELDS = ["sleepQuality", "mood"] as const;

/** Which 1-5 band typed hours fall into, per the questionnaire anchors. */
export function sleepBand(hours: number): number {
  if (hours < 5) return 1;
  if (hours < 6) return 2;
  if (hours < 7) return 3;
  if (hours < 8) return 4;
  return 5;
}

/**
 * Sleep's contribution to the score. Deliberately NOT the raw band: 8-9 hours
 * is the target, and piling on past that is not extra credit, so the curve
 * plateaus through 9h and eases back after. Undersleeping is still the steeper
 * penalty.
 *
 *   4h -> 1.0    6h -> 3.0    8h -> 5.0    9h -> 5.0    11h -> 4.2
 */
export function sleepToRating(hours: number): number {
  if (hours <= 4) return 1;
  if (hours <= 8) return 1 + (hours - 4) * (4 / 4); // 4h..8h -> 1..5
  if (hours <= 9) return 5; // the target window
  return Math.max(3.5, 5 - (hours - 9) * 0.4);
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
  if (typeof e.sleepHours === "number" && e.sleepHours > 0)
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

/** Weigh-ins needed in a week before its average means anything. */
const MIN_WEIGH_INS = 3;

export interface WeightTrend {
  latest: number;
  latestDate: string;
  /** rolling mean of the last 7 days */
  avg7: number | null;
  /** rolling mean of the 7 days before those */
  prev7: number | null;
  /** avg7 − prev7: the week-over-week move */
  change: number | null;
  /** today against this week's own average — a swing here is fluid, not mass */
  acute: number | null;
  /** weigh-ins behind avg7 */
  n7: number;
}

const dayDiff = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
};

export function weightTrend(entries: RecoveryEntry[]): WeightTrend | null {
  const weighed = entries
    .filter((e) => typeof e.bodyWeight === "number" && e.bodyWeight > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!weighed.length) return null;

  const last = weighed[weighed.length - 1];
  const window = (from: number, to: number) => {
    const xs = weighed
      .filter((e) => {
        const age = dayDiff(e.date, last.date);
        return age >= from && age < to;
      })
      .map((e) => e.bodyWeight as number);
    return xs.length >= MIN_WEIGH_INS
      ? xs.reduce((a, b) => a + b, 0) / xs.length
      : null;
  };

  const n7 = weighed.filter((e) => dayDiff(e.date, last.date) < 7).length;
  const avg7 = window(0, 7);
  const prev7 = window(7, 14);

  return {
    latest: last.bodyWeight as number,
    latestDate: last.date,
    avg7,
    prev7,
    change: avg7 != null && prev7 != null ? avg7 - prev7 : null,
    acute: avg7 != null ? (last.bodyWeight as number) - avg7 : null,
    n7,
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
      sleep: typeof e.sleepHours === "number" ? e.sleepHours : null,
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
