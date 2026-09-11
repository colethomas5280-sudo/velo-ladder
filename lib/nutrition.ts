import { PROFILE_FIELDS } from "./profile";

/* ------------------------------------------------------------------ *
 * Eating to gain, as numbers
 *
 * Cole's rule: 20 calories per pound of bodyweight a day, and a gram of
 * protein per pound. Both are his, and both are deliberately simple enough
 * for an athlete to work out in his head — protein especially, since it is
 * just his bodyweight.
 *
 * Pure, so the page and the tests read the same arithmetic.
 * ------------------------------------------------------------------ */

/*
 * The same bounds the profile enforces on a bodyweight, read from the same
 * place. A calculator that accepts a weight the profile would refuse is two
 * answers to one question — and 1 lb produced a target of 0 calories, which
 * was enough to convince the page it had a weight and tear the input box out
 * from under whoever was still typing.
 */
const WEIGHT_FIELD = PROFILE_FIELDS.find((f) => f.key === "weightLb")!;
export const MIN_BODYWEIGHT_LB = WEIGHT_FIELD.min ?? 50;
export const MAX_BODYWEIGHT_LB = WEIGHT_FIELD.max ?? 500;

/** Daily calories per pound of bodyweight, for an athlete trying to gain. */
export const CALORIES_PER_LB = 20;

/** Daily protein in grams per pound. One to one, which is the point. */
export const PROTEIN_G_PER_LB = 1;

export interface DailyIntake {
  weightLb: number;
  calories: number;
  proteinG: number;
}

/**
 * What to eat in a day at a given bodyweight.
 *
 * Calories to the nearest 50: an athlete cannot eat to the calorie and a
 * figure like 3,715 pretends he can. Protein is left exact, because at one
 * gram per pound it IS his bodyweight and rounding it would break the only
 * thing making it memorable.
 */
export function intakeFor(weightLb: number): DailyIntake | null {
  if (!(weightLb >= MIN_BODYWEIGHT_LB && weightLb <= MAX_BODYWEIGHT_LB)) return null;
  return {
    weightLb,
    calories: Math.round((weightLb * CALORIES_PER_LB) / 50) * 50,
    proteinG: Math.round(weightLb * PROTEIN_G_PER_LB),
  };
}

/**
 * What one recipe is worth against a day, as a percentage.
 *
 * The reason the target sits on the same page as the shakes: "1,070 calories"
 * means little on its own, and "just under a third of your day" is the
 * sentence that makes an athlete drink it.
 */
export function shareOfDay(calories: number, intake: DailyIntake): number {
  return calories / intake.calories;
}

/**
 * A share in plain words: "about a third of your day".
 *
 * Snapped to the NEAREST simple fraction, so the boundaries sit at the
 * midpoints between them and not on round-looking numbers. A fifth is 20 and
 * a quarter is 25, so the line between them is 22.5 and not 22; a third is
 * 33.3 and 40 is 40, so that line is 36.7 and not 36. Both of mine were a
 * point out, which reads as the app rounding in whichever direction it feels
 * like.
 */
export function fmtShare(share: number): string {
  const pct = Math.round(share * 100);
  if (pct >= 45) return "about half your day"; // 40 | 50
  if (pct >= 37) return "about 40% of your day"; // 33.3 | 40
  if (pct >= 30) return "about a third of your day"; // 25 | 33.3
  if (pct >= 23) return "about a quarter of your day"; // 20 | 25
  if (pct >= 17) return "about a fifth of your day";
  return `about ${pct}% of your day`;
}
