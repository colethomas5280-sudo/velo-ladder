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

/**
 * One question. `anchors[0]` is what 1 means, the last what `max` means.
 * Scales keep their native length — arm readiness is a 1-4 scale and stays
 * one, normalised only at scoring time.
 */
export interface WellnessItem {
  key: string;
  label: string;
  anchors: string[];
  /** top of the scale; defaults to 5 */
  max?: number;
  /** derived from typed hours rather than chosen */
  derived?: boolean;
}

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
    id: "arm",
    title: "Arm readiness",
    items: [
      {
        key: "armReadiness",
        label: "How's the arm?",
        max: 4,
        anchors: [
          "Pain (limiting movement)",
          "Pain/soreness (not limiting movement)",
          "No pain (some soreness)",
          "No pain (no soreness)",
        ],
      },
    ],
  },
];

/** Every question an athlete answers directly, across all sections. */
export const ANSWERED_ITEMS = WELLNESS_SECTIONS.flatMap((s) =>
  s.items.filter((i) => !i.derived),
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
