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
] as const;

export interface RatingDef {
  key: (typeof RATING_FIELDS)[number];
  label: string;
  low: string;
  high: string;
}

/** Wording is chosen so 1 is always the bad end and 5 always the good end. */
export const RATINGS: RatingDef[] = [
  { key: "sleepQuality", label: "Sleep quality", low: "Restless", high: "Great" },
  { key: "soreness", label: "Arm soreness", low: "Very sore", high: "None" },
  { key: "energy", label: "Energy", low: "Drained", high: "Fresh" },
  { key: "stress", label: "Life stress", low: "Very high", high: "None" },
  { key: "mood", label: "Mood", low: "Poor", high: "Great" },
];

/** 4h or less scores 1, 8.5h or more scores 5, linear in between. */
export function sleepToRating(hours: number): number {
  return Math.min(5, Math.max(1, 1 + (hours - 4) * (4 / 4.5)));
}

/** Composite 0-100, or null when nothing scoreable was filled in. */
export function recoveryScore(e: RecoveryEntry): number | null {
  const parts: number[] = [];
  for (const f of RATING_FIELDS) {
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
