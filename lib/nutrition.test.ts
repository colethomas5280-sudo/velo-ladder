import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALORIES_PER_LB,
  MAX_BODYWEIGHT_LB,
  MIN_BODYWEIGHT_LB,
  PROTEIN_G_PER_LB,
  fmtShare,
  intakeFor,
  shareOfDay,
} from "@/lib/nutrition";
import { SEED_RECIPES } from "@/lib/recipes";

/* ------------------------------------------------------------------ *
 * Eating to gain
 *
 * Cole's rule: 20 calories a pound, a gram of protein a pound. Simple enough
 * that an athlete can redo it himself once he has gained ten pounds, which is
 * the point of it being a rule rather than a number he was handed.
 * ------------------------------------------------------------------ */

test("the rule is Cole's, and both halves are one number each", () => {
  assert.equal(CALORIES_PER_LB, 20);
  assert.equal(PROTEIN_G_PER_LB, 1);
});

test("a day is worked out from bodyweight", () => {
  const i = intakeFor(186)!;
  assert.equal(i.calories, 3700, "186 x 20 is 3720, to the nearest 50");
  assert.equal(i.proteinG, 186, "a gram a pound is just his bodyweight");
});

/*
 * Calories round to 50 because nobody eats to the calorie and 3,715 pretends
 * he can. Protein is left exact: at a gram a pound it IS his bodyweight, and
 * rounding it breaks the only thing making it memorable.
 */
test("calories round to something a person can aim at, protein does not", () => {
  assert.equal(intakeFor(163)!.calories, 3250, "3260 to the nearest 50");
  assert.equal(intakeFor(163)!.proteinG, 163);
  assert.equal(intakeFor(177)!.calories, 3550, "3540 to the nearest 50");
});

test("it scales with the athlete, which is what a rule per pound means", () => {
  assert.equal(intakeFor(200)!.calories / intakeFor(100)!.calories, 2);
});

test("no bodyweight means no target rather than a made-up one", () => {
  for (const w of [0, -10, NaN]) assert.equal(intakeFor(w), null, String(w));
});

/* ---------------- what a shake is worth ---------------- */

/*
 * The reason the target sits on the same page as the recipes. "1,070
 * calories" means little on its own; "about a quarter of your day" is the
 * sentence that gets it drunk.
 *
 * The words snap to the nearest simple fraction, not to the nearest round
 * percentage: a quarter is 25%, a third is 33%, so 29% is a quarter and 31%
 * is a third. I had this backwards first time and the test caught me.
 */
test("a recipe is measured against the day, not in the abstract", () => {
  const day = intakeFor(186)!; // 3,700
  assert.equal(fmtShare(shareOfDay(1070, day)), "about a quarter of your day");
  assert.equal(fmtShare(shareOfDay(1250, day)), "about a third of your day");
  assert.equal(fmtShare(shareOfDay(680, day)), "about a fifth of your day");
  assert.equal(fmtShare(shareOfDay(1850, day)), "about half your day");
});

test("the wording lands on whichever fraction is nearest", () => {
  const day = intakeFor(100)!; // 2,000, so calories read straight as percent
  assert.equal(fmtShare(shareOfDay(580, day)), "about a quarter of your day");
  assert.equal(fmtShare(shareOfDay(620, day)), "about a third of your day");
  assert.equal(fmtShare(shareOfDay(720, day)), "about a third of your day");
  assert.equal(fmtShare(shareOfDay(740, day)), "about 40% of your day");
  // The midpoints themselves, which is where being a point out showed.
  assert.equal(fmtShare(0.225), "about a quarter of your day", "22.5 rounds to 23");
  assert.equal(fmtShare(0.22), "about a fifth of your day");
});

test("the same shake is a bigger share of a smaller athlete's day", () => {
  const light = shareOfDay(1070, intakeFor(150)!);
  const heavy = shareOfDay(1070, intakeFor(210)!);
  assert.ok(light > heavy);
});

test("an odd share falls back to a plain percentage rather than a wrong word", () => {
  assert.match(fmtShare(0.11), /about 11% of your day/);
});

/* Three of Cole's shakes at a typical bodyweight, as a sanity check on the
 * whole chain: if one of these ever reads as half a day, something is off. */
test("Cole's shakes land where a big shake should against a day", () => {
  const day = intakeFor(180)!;
  for (const r of SEED_RECIPES) {
    if (r.calories == null) continue;
    const share = shareOfDay(r.calories, day);
    assert.ok(share > 0.15 && share < 0.45, `${r.title}: ${Math.round(share * 100)}%`);
  }
});

/* ---------------- a bodyweight has to be plausible ---------------- */

/*
 * Cole: "when I try to enter a number the first number is added and then the
 * box is closed."
 *
 * `intakeFor(1)` returned a target of ZERO calories, which is nonsense and
 * was still truthy enough to convince the page it had a weight. It then swapped
 * the input for the answer, mid-keystroke.
 */
test("an implausible bodyweight is not a bodyweight", () => {
  for (const w of [1, 7, 49, 501, 0, -5, NaN])
    assert.equal(intakeFor(w), null, `${w} lb`);
});

test("the bounds are the profile's own, not a second opinion", async () => {
  const { PROFILE_FIELDS } = await import("@/lib/profile");
  const field = PROFILE_FIELDS.find((f) => f.key === "weightLb")!;
  assert.equal(MIN_BODYWEIGHT_LB, field.min);
  assert.equal(MAX_BODYWEIGHT_LB, field.max);
});

test("the edges themselves are accepted", () => {
  assert.ok(intakeFor(MIN_BODYWEIGHT_LB));
  assert.ok(intakeFor(MAX_BODYWEIGHT_LB));
});

/* Never zero. A target of 0 calories was the tell that the guard was wrong. */
test("any accepted weight produces a target worth eating", () => {
  for (const w of [MIN_BODYWEIGHT_LB, 120, 186, 240, MAX_BODYWEIGHT_LB]) {
    const i = intakeFor(w)!;
    assert.ok(i.calories >= 900, `${w} lb -> ${i.calories} kcal`);
    assert.ok(i.proteinG > 0);
  }
});
