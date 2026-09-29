import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, evaluate, DISCLOSURES, type Hand, type PlacementInput } from "@/lib/veloPlacement";
import { OUTLIER_BUFFER_MPH } from "@/lib/veloConfig";
import type { VeloRange } from "@/lib/veloTypes";

/* ------------------------------------------------------------------ *
 * Placing a session against the ladder
 *
 * Pinned from the spec's table. The numbers are Cole's benchmarks, not this
 * module's to adjust: if a case here fails, the classifier is wrong, not the
 * expectation.
 *
 * Every fixture below is built from the real values in
 * db/velo-ladder-seed-data.json (the 16U, 13U, JUCO, D1 Power 4, MiLB AAA,
 * Rapsodo anchor, and Go Big rows). None of these bands are invented.
 * ------------------------------------------------------------------ */

/** Fills in the VeloRange fields this module never looks at, so each
 * fixture below only has to state the numbers that matter for its test. */
function mkRange(overrides: Partial<VeloRange> & Pick<VeloRange, "slug" | "level">): VeloRange {
  return {
    category: "",
    rowType: "primary",
    displayOrder: 0,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: null,
    notes: "",
    lastUpdated: "2026-09-25",
    notionUrl: "",
    sourceSlugs: [],
    ...overrides,
  };
}

// 16U (HS JV/Soph) Combined 69-85, elite reference 89, confidence Medium.
const SIXTEEN_U = mkRange({
  slug: "16u-hs-jv-soph",
  level: "16U (HS JV/Soph)",
  category: "High School",
  combinedLow: 69,
  combinedHigh: 85,
  eliteTrajectoryRef: 89,
  confidence: "Medium",
});

// 13U Combined 55-75, elite reference 72, confidence High.
const THIRTEEN_U = mkRange({
  slug: "13u",
  level: "13U",
  category: "Youth (13U-14U)",
  combinedLow: 55,
  combinedHigh: 75,
  eliteTrajectoryRef: 72,
  confidence: "High",
});

// JUCO: RHP 82-90, LHP 80-87, no combined, no elite reference, confidence Medium.
const JUCO = mkRange({
  slug: "juco",
  level: "JUCO",
  category: "College",
  rhpLow: 82,
  rhpHigh: 90,
  lhpLow: 80,
  lhpHigh: 87,
  confidence: "Medium",
});

// NCAA D1 Power 4: RHP 90-97, LHP 88-94, no combined, no elite reference, confidence Medium.
const D1_POWER_4 = mkRange({
  slug: "ncaa-d1-power-4",
  level: "NCAA D1 - Power 4",
  category: "College",
  rhpLow: 90,
  rhpHigh: 97,
  lhpLow: 88,
  lhpHigh: 94,
  confidence: "Medium",
});

// MiLB AAA: every bound null, confidence null.
const MILB_AAA = mkRange({
  slug: "milb-aaa",
  level: "MiLB - AAA",
  category: "Affiliated MiLB/MLB",
  confidence: null,
});

// The Rapsodo measured-average anchor row: not classifiable, rowType "anchor".
const RAPSODO_ANCHOR = mkRange({
  slug: "college-all-divisions-rapsodo",
  level: "College - All Divisions (Rapsodo Measured Avg)",
  category: "College",
  rowType: "anchor",
  rhpLow: 85,
  rhpHigh: 85,
  lhpLow: 83,
  lhpHigh: 83,
  confidence: "Medium",
});

// A Go Big tier row: not classifiable, rowType "secondary".
const GOBIG_TIER_1 = mkRange({
  slug: "gobig-tier-1",
  level: "College - Go Big Tier 1 (High D1 / Elite JUCO)",
  category: "College",
  rowType: "secondary",
  combinedLow: 84,
  combinedHigh: 95,
  confidence: "Unverified",
});

function session(range: VeloRange, hand: Hand | undefined, floor: number, sitting: number, peak: number) {
  const input: PlacementInput = { range, floor, sitting, peak };
  if (hand) input.hand = hand;
  return evaluate(input);
}

function okOrThrow<T extends { ok: boolean }>(r: T): T & { ok: true } {
  assert.equal(r.ok, true, "expected ok:true result");
  return r as T & { ok: true };
}

test("1: 16U, 74/79/83, sits in the upper half with a projectability gap", () => {
  // 16U Combined 69-85, midpoint 77, ref 89, Medium
  const r = okOrThrow(session(SIXTEEN_U, undefined, 74, 79, 83));
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
  assert.deepEqual(r.band, { kind: "Combined", low: 69, high: 85, midpoint: 77 });
  assert.equal(r.confidence, "Medium");
  assert.deepEqual(r.flags, ["PROJECTABILITY_GAP"]);
});

test("2: JUCO RHP, 84/88/91, upper half with the peak above the band", () => {
  const r = okOrThrow(session(JUCO, "R", 84, 88, 91));
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
  assert.deepEqual(r.band, { kind: "RHP", low: 82, high: 90, midpoint: 86 });
  assert.deepEqual(r.flags, ["PEAK_ABOVE_BAND"]);
});

test("3: 16U, 85/89/92, is elite trajectory at exactly the reference", () => {
  // 89 >= ref 89 AND 89 > high 85, so the cap does not block it
  const r = okOrThrow(session(SIXTEEN_U, undefined, 85, 89, 92));
  assert.equal(r.placement, "OUTLIER_ELITE_TRAJECTORY");
});

test("4: JUCO RHP, sitting 91 is above average and 93 is an outlier", () => {
  const at = (sitting: number) => okOrThrow(session(JUCO, "R", sitting - 2, sitting, sitting + 2));
  assert.equal(at(91).placement, "ABOVE_AVERAGE");
  assert.equal(at(93).placement, "OUTLIER_ABOVE_RANGE"); // high 90 + buffer 3
});

test("5: 16U at 68 and 65 is below average, at 64 notably behind", () => {
  // low 69, buffer 5, so the line is 64
  const at = (sitting: number) => okOrThrow(session(SIXTEEN_U, undefined, sitting - 3, sitting, sitting + 3));
  assert.equal(at(68).placement, "BELOW_AVERAGE");
  assert.equal(at(65).placement, "BELOW_AVERAGE");
  assert.equal(at(64).placement, "NOTABLY_BEHIND");
});

test("6: D1 Power 4 at 92 reads differently for a lefty and a righty", () => {
  // LHP 88-94 midpoint 91 -> upper; RHP 90-97 midpoint 93.5 -> lower
  const left = okOrThrow(session(D1_POWER_4, "L", 89, 92, 95));
  const right = okOrThrow(session(D1_POWER_4, "R", 89, 92, 95));
  assert.equal(left.placement, "AVERAGE_UPPER_HALF");
  assert.equal(right.placement, "AVERAGE_LOWER_HALF");
});

test("7: MiLB AAA has no data and is not classified", () => {
  const r = okOrThrow(session(MILB_AAA, undefined, 88, 92, 96));
  assert.equal(r.placement, "NO_DATA");
});

test("8: a lefty on a 16U row uses Combined and says the sources do not split", () => {
  const r = okOrThrow(session(SIXTEEN_U, "L", 74, 79, 83));
  assert.equal(r.band?.kind, "Combined");
  assert.ok(r.notes.some((n) => n.includes("do not split by hand")));
});

test("9: D1 Power 4 with no hand is a validation error", () => {
  const r = session(D1_POWER_4, undefined, 90, 93, 96);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /hand/i);
});

test("10: the Rapsodo anchor and a Go Big tier are not classifiable", () => {
  const anchor = session(RAPSODO_ANCHOR, "R", 83, 85, 87);
  const secondary = session(GOBIG_TIER_1, undefined, 85, 88, 92);
  assert.equal(anchor.ok, false);
  assert.equal(secondary.ok, false);
});

test("11: a peak below the average is a validation error", () => {
  const r = session(SIXTEEN_U, undefined, 70, 80, 75);
  assert.equal(r.ok, false);
});

test("12: 13U at 73 is inside his band, so he is NOT called elite", () => {
  /*
   * 13U's elite ref (72) sits BELOW its own band high (75). Without the cap
   * this reads as elite trajectory while the pitcher is squarely inside the
   * normal range for his age. Cole capped it: being at the top of normal is
   * not elite.
   */
  const r = okOrThrow(session(THIRTEEN_U, undefined, 70, 73, 76));
  assert.equal(r.placement, "AVERAGE_UPPER_HALF"); // band 55-75, midpoint 65
});

test("13U at 75, the very top of the band, is still not elite", () => {
  const r = okOrThrow(session(THIRTEEN_U, undefined, 72, 75, 78));
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
});

test("13U at 76 IS elite, so the cap is a cap and not a removal", () => {
  const r = okOrThrow(session(THIRTEEN_U, undefined, 73, 76, 79));
  assert.equal(r.placement, "OUTLIER_ELITE_TRAJECTORY");
});

test("a velocity outside 30 to 110 is refused", () => {
  const at = (sitting: number) => session(SIXTEEN_U, undefined, sitting - 2, sitting, sitting + 2);
  assert.equal(at(120).ok, false);
  assert.equal(at(20).ok, false);
});

test("every result carries the row's confidence and the percentile disclosure", () => {
  const r = okOrThrow(session(JUCO, "R", 84, 88, 91));
  assert.ok(r.disclosures.some((d) => d.includes("only as certain as that rating")));
  assert.ok(r.disclosures.some((d) => d.includes("only defensible for 13U and 18U")));
});

test("a below-average result says late development is not a red flag", () => {
  const r = okOrThrow(session(SIXTEEN_U, undefined, 65, 68, 71));
  assert.ok(r.disclosures.some((d) => d.includes("not a red flag by itself")));
});

test("the low side is never called an outlier", () => {
  /*
   * The guide is explicit: on the low end, do not use "outlier" to describe
   * the PITCHER. Several sources say sitting below the range is normal, and
   * outlier language there risks pathologising a late developer.
   *
   * That is a rule about the label and about the classification-specific
   * disclosures (the ones that exist because of where this particular
   * result landed). It is not a rule about the standing percentile-scope
   * caveat, which is a methodological note about what the underlying data
   * can and cannot support and reads identically no matter where the
   * pitcher sits. That caveat is exempt here by name, not filtered out
   * because it happens to fail the check.
   */
  const at = (sitting: number) => okOrThrow(session(SIXTEEN_U, undefined, sitting - 3, sitting, sitting + 3));
  const all = [at(64), at(65), at(68)];
  for (const r of all) {
    const classificationSpecific = r.disclosures.filter((d) => d !== DISCLOSURES.percentileScope);
    for (const text of [r.label, ...classificationSpecific]) assert.ok(!/outlier/i.test(text), text);
  }
});

test("a NOTABLY_BEHIND result still carries the percentile caveat and the not-a-red-flag disclosure", () => {
  // 16U low 69, buffer 5: sitting 64 is NOTABLY_BEHIND.
  const r = okOrThrow(session(SIXTEEN_U, undefined, 61, 64, 67));
  assert.equal(r.placement, "NOTABLY_BEHIND");
  assert.ok(r.disclosures.includes(DISCLOSURES.percentileScope));
  assert.ok(r.disclosures.includes(DISCLOSURES.belowRangeNormal));
});

test("a session that fades across the outing flags fatigue or consistency, without changing the placement", () => {
  // 16U Combined 69-85, midpoint 77: floor 70, sitting 79 (9 mph above floor,
  // past the 6 mph FATIGUE_GAP_FLAG_MPH line), peak 81. The gap is a flag,
  // not a rule: the placement is driven by sitting alone and stays
  // AVERAGE_UPPER_HALF, same as case 1's floor-74 version of this session.
  const r = okOrThrow(session(SIXTEEN_U, undefined, 70, 79, 81));
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
  assert.deepEqual(r.flags, ["FATIGUE_OR_CONSISTENCY"]);
});

test("an OUTLIER_ABOVE_RANGE result discloses the adjustable buffer line", () => {
  // JUCO RHP high 90 + buffer 3, same threshold as case 4's 93 mph check.
  const r = okOrThrow(session(JUCO, "R", 91, 93, 95));
  assert.equal(r.placement, "OUTLIER_ABOVE_RANGE");
  assert.ok(r.disclosures.includes(DISCLOSURES.outlierAboveRange(OUTLIER_BUFFER_MPH)));
});

test("an OUTLIER_ELITE_TRAJECTORY result discloses the sample-skew caveat", () => {
  // 16U at 89, same fixture as case 3.
  const r = okOrThrow(session(SIXTEEN_U, undefined, 85, 89, 92));
  assert.equal(r.placement, "OUTLIER_ELITE_TRAJECTORY");
  assert.ok(r.disclosures.includes(DISCLOSURES.eliteTrajectory));
});

/* ------------------------------------------------------------------ *
 * bandFor, directly
 * ------------------------------------------------------------------ */

test("bandFor returns null rather than guessing when a row has no usable band", () => {
  assert.equal(bandFor(MILB_AAA, undefined), null);
});

test("bandFor prefers the hand-specific band when it exists", () => {
  assert.deepEqual(bandFor(JUCO, "L"), { kind: "LHP", low: 80, high: 87, midpoint: 83.5 });
});
