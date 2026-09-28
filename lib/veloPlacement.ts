/* ------------------------------------------------------------------ *
 * Placing a session against the ladder
 *
 * Pure classification: given a benchmark row, a throwing hand, and a
 * session's floor (low), sitting (average), and peak (high) fastball
 * velocity, decide where the pitcher sits relative to that row's band.
 *
 * No React, no fetch, no database, no import of lib/veloData.ts. That is
 * what makes this testable in isolation, and it is what the spec asks for.
 *
 * The rule against saying "outlier" on the low side is about what the
 * PITCHER is called, not about every string in the disclosure list. The
 * percentile-scope disclosure below is a methodological caveat about what
 * the underlying data can and cannot support; it reads the same whether
 * the athlete is sitting 95 or 65, and it is attached to every
 * classification, including BELOW_AVERAGE and NOTABLY_BEHIND, exactly as
 * the spec's "Always" says.
 * ------------------------------------------------------------------ */

import type { VeloRange, VeloBand } from "@/lib/veloTypes";
import {
  OUTLIER_BUFFER_MPH,
  NOTABLY_BEHIND_BUFFER_MPH,
  PEAK_GAP_FLAG_MPH,
  FATIGUE_GAP_FLAG_MPH,
  MIN_MPH,
  MAX_MPH,
} from "@/lib/veloConfig";

/** Which arm the session was thrown from. */
export type Hand = "R" | "L";

export type Placement =
  | "OUTLIER_ELITE_TRAJECTORY"
  | "OUTLIER_ABOVE_RANGE"
  | "ABOVE_AVERAGE"
  | "AVERAGE_UPPER_HALF"
  | "AVERAGE_LOWER_HALF"
  | "BELOW_AVERAGE"
  | "NOTABLY_BEHIND"
  | "NO_DATA";

export type PlacementFlag = "PROJECTABILITY_GAP" | "FATIGUE_OR_CONSISTENCY" | "PEAK_ABOVE_BAND";

export interface PlacementInput {
  range: VeloRange;
  /** Required only when the row splits its band by hand. */
  hand?: Hand;
  /** The session's low fastball velocity. */
  floor: number;
  /** The session's average ("sitting") fastball velocity. Drives classification. */
  sitting: number;
  /** The session's high fastball velocity. */
  peak: number;
}

export interface PlacementResult {
  ok: true;
  placement: Placement;
  /** null only for NO_DATA, where the row has no usable band at all. */
  band: VeloBand | null;
  confidence: string | null;
  flags: PlacementFlag[];
  label: string;
  notes: string[];
  disclosures: string[];
}

export interface PlacementError {
  ok: false;
  error: string;
}

/** Every disclosure string lives here, verbatim, so the UI and the tests
 * render and assert against the exact same text rather than copies that
 * can drift apart. */
export const DISCLOSURES = {
  confidence: (confidence: string | null) =>
    `Row confidence: ${confidence}. This placement is only as certain as that rating.`,
  percentileScope:
    'Percentile-based outlier claims are only defensible for 13U and 18U (Eisenmann data). Elsewhere, "outlier" is a judgment call against a typical-range band, not a statistical claim.',
  outlierAboveRange: (buffer: number) => `The outlier line here is High + ${buffer} mph, an adjustable judgment call.`,
  eliteTrajectory:
    "The elite reference reflects the teenage velocity of pitchers who reached MLB; that sample skews toward tall, early-maturing pitchers.",
  belowRangeNormal: "Sitting below the range is common with late development and is not a red flag by itself.",
} as const;

const LABELS: Record<Placement, string> = {
  OUTLIER_ELITE_TRAJECTORY: "Elite trajectory outlier",
  OUTLIER_ABOVE_RANGE: "Outlier, above the range",
  ABOVE_AVERAGE: "Above average",
  AVERAGE_UPPER_HALF: "Average, upper half",
  AVERAGE_LOWER_HALF: "Average, lower half",
  BELOW_AVERAGE: "Below average",
  NOTABLY_BEHIND: "Notably behind for level",
  NO_DATA: "No data available for this level",
};

/**
 * Picks the band to place a session against.
 *
 * RHP band if hand is R and RHP bounds exist; LHP band if hand is L and LHP
 * bounds exist; otherwise Combined if it exists; otherwise null. Never
 * guesses a band the row does not have.
 */
export function bandFor(range: VeloRange, hand?: Hand): VeloBand | null {
  if (hand === "R" && range.rhpLow != null && range.rhpHigh != null) {
    return { kind: "RHP", low: range.rhpLow, high: range.rhpHigh, midpoint: (range.rhpLow + range.rhpHigh) / 2 };
  }
  if (hand === "L" && range.lhpLow != null && range.lhpHigh != null) {
    return { kind: "LHP", low: range.lhpLow, high: range.lhpHigh, midpoint: (range.lhpLow + range.lhpHigh) / 2 };
  }
  if (range.combinedLow != null && range.combinedHigh != null) {
    return {
      kind: "Combined",
      low: range.combinedLow,
      high: range.combinedHigh,
      midpoint: (range.combinedLow + range.combinedHigh) / 2,
    };
  }
  return null;
}

/**
 * The classification order. First match wins.
 *
 * Rule 1's second condition (`sitting > band.high`) is a cap the coach
 * added after seeing the data: a row's elite-trajectory reference can sit
 * below that row's own band high (13U's ref is 72, inside its 55-75 band),
 * and without the cap a pitcher squarely inside the normal range for his
 * age would get called an outlier on elite trajectory. Being at the top of
 * normal is not elite.
 */
function classify(range: VeloRange, band: VeloBand, sitting: number): Placement {
  if (range.eliteTrajectoryRef != null && sitting >= range.eliteTrajectoryRef && sitting > band.high) {
    return "OUTLIER_ELITE_TRAJECTORY";
  }
  if (range.eliteTrajectoryRef == null && sitting >= band.high + OUTLIER_BUFFER_MPH) {
    return "OUTLIER_ABOVE_RANGE";
  }
  if (sitting > band.high) {
    return "ABOVE_AVERAGE";
  }
  if (sitting >= band.low) {
    return sitting >= band.midpoint ? "AVERAGE_UPPER_HALF" : "AVERAGE_LOWER_HALF";
  }
  if (sitting <= band.low - NOTABLY_BEHIND_BUFFER_MPH) {
    return "NOTABLY_BEHIND";
  }
  return "BELOW_AVERAGE";
}

/** Flags are informational. They never change the classification above. */
function computeFlags(band: VeloBand, floor: number, sitting: number, peak: number): PlacementFlag[] {
  const flags: PlacementFlag[] = [];
  if (peak - sitting >= PEAK_GAP_FLAG_MPH) flags.push("PROJECTABILITY_GAP");
  if (sitting - floor >= FATIGUE_GAP_FLAG_MPH) flags.push("FATIGUE_OR_CONSISTENCY");
  if (peak > band.high) flags.push("PEAK_ABOVE_BAND");
  return flags;
}

const LOW_SIDE_PLACEMENTS = new Set<Placement>(["BELOW_AVERAGE", "NOTABLY_BEHIND"]);

function buildDisclosures(range: VeloRange, placement: Placement): string[] {
  const disclosures: string[] = [DISCLOSURES.confidence(range.confidence), DISCLOSURES.percentileScope];
  const lowSide = LOW_SIDE_PLACEMENTS.has(placement);

  if (placement === "OUTLIER_ABOVE_RANGE") disclosures.push(DISCLOSURES.outlierAboveRange(OUTLIER_BUFFER_MPH));
  if (placement === "OUTLIER_ELITE_TRAJECTORY") disclosures.push(DISCLOSURES.eliteTrajectory);
  if (lowSide) disclosures.push(DISCLOSURES.belowRangeNormal);

  return disclosures;
}

function isValidVelocity(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_MPH && value <= MAX_MPH;
}

/**
 * Places one session against one benchmark row.
 *
 * Validation, in order: the row must be a classifiable (primary) row;
 * floor, sitting, and peak must each be a finite number between MIN_MPH
 * and MAX_MPH with floor <= sitting <= peak; and a hand must be given when
 * the row splits its band by hand. A row with no usable band at all (every
 * bound null) is not an error, it is a NO_DATA result.
 */
export function evaluate(input: PlacementInput): PlacementResult | PlacementError {
  const { range, hand, floor, sitting, peak } = input;

  if (range.rowType !== "primary") {
    return { ok: false, error: `Row type "${range.rowType}" rows are not classifiable.` };
  }

  if (!isValidVelocity(floor) || !isValidVelocity(sitting) || !isValidVelocity(peak)) {
    return { ok: false, error: `floor, sitting, and peak must each be between ${MIN_MPH} and ${MAX_MPH} mph.` };
  }

  if (!(floor <= sitting && sitting <= peak)) {
    return { ok: false, error: "floor, sitting, and peak must satisfy floor <= sitting <= peak." };
  }

  const hasHandSpecificBands =
    (range.rhpLow != null && range.rhpHigh != null) || (range.lhpLow != null && range.lhpHigh != null);
  if (hasHandSpecificBands && !hand) {
    return { ok: false, error: "A throwing hand is required because this level's sources split by hand." };
  }

  const band = bandFor(range, hand);
  if (!band) {
    return {
      ok: true,
      placement: "NO_DATA",
      band: null,
      confidence: range.confidence,
      flags: [],
      label: LABELS.NO_DATA,
      notes: [],
      disclosures: [DISCLOSURES.confidence(range.confidence), DISCLOSURES.percentileScope],
    };
  }

  const placement = classify(range, band, sitting);
  const flags = computeFlags(band, floor, sitting, peak);
  const notes: string[] = [];
  if (hand && band.kind === "Combined") {
    notes.push("Sources for this row do not split by hand.");
  }

  return {
    ok: true,
    placement,
    band,
    confidence: range.confidence,
    flags,
    label: LABELS[placement],
    notes,
    disclosures: buildDisclosures(range, placement),
  };
}
