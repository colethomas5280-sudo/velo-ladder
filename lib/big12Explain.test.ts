import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abnormalFor,
  deliveryStatus,
  explainFlaw,
  sidesWanted,
} from "@/lib/big12Explain";
import { flawByKey } from "@/lib/big12";
import { NOT_TESTED, PAINFUL } from "@/lib/screen";

/* ------------------------------------------------------------------ *
 * What counts as an explanation
 *
 * The whole feature turns on this being strict. A rule that counted every
 * recorded answer would explain every flaw for every athlete, which reads
 * exactly like a working feature and tells a coach nothing.
 * ------------------------------------------------------------------ */

const sway = () => flawByKey("sway")!;

test("a normal finding explains nothing", () => {
  const got = abnormalFor("hip-45", { "hip-45.45-degree-angle:L": "greater" }, ["L"]);
  assert.deepEqual(got, []);
});

test("a limited finding explains, and names the side", () => {
  const got = abnormalFor("hip-45", { "hip-45.45-degree-angle:L": "less" }, ["L"]);
  assert.equal(got.length, 1);
  assert.equal(got[0].testKey, "hip-45");
  assert.equal(got[0].sideLabel, "Left");
  assert.equal(got[0].painful, false);
});

test("a skipped sub-test is an absence, not a finding", () => {
  const got = abnormalFor("hip-45", { "hip-45.45-degree-angle:L": NOT_TESTED }, ["L"]);
  assert.deepEqual(got, []);
});

test("a diagnostic sub-test never explains anything", () => {
  /*
   * Push-Off's first question records whether it was run on the mound or on
   * flat ground. It is context, it has no normal answer, and counting it
   * would make Short Stride look explained for every athlete ever screened.
   */
  const got = abnormalFor("push-off", { "push-off.surface": "flat" }, null);
  assert.deepEqual(got, [], "the surface question was read as a limitation");
});

test("pain explains, and stays an alert rather than becoming a plain cause", () => {
  const got = abnormalFor("hip-45", { "hip-45.45-degree-angle:L": PAINFUL }, ["L"]);
  assert.equal(got.length, 1);
  assert.equal(got[0].painful, true);
});

test("a front side cause asks for the leg opposite the throwing hand", () => {
  const cause = { label: "x", tests: ["hip-45"], side: "front" as const };
  assert.deepEqual(sidesWanted(cause, "R"), ["L"]);
  assert.deepEqual(sidesWanted(cause, "L"), ["R"]);
});

test("a backside cause asks for the throwing-hand side", () => {
  const cause = { label: "x", tests: ["hip-45"], side: "back" as const };
  assert.deepEqual(sidesWanted(cause, "R"), ["R"]);
});

test("with no hand recorded there is no front leg, so both sides show", () => {
  const cause = { label: "x", tests: ["hip-45"], side: "front" as const };
  assert.equal(sidesWanted(cause, ""), null);
});

test("a side marker against a test graded once still reports its finding", () => {
  /*
   * Sway's backside ankle cause maps to Ankle Rolling, which is graded ONCE.
   * A design that assumed every mapped test was sided would drop this, and
   * roughly half the mapping with it, looking like clean athletes.
   */
  const got = abnormalFor("ankle-rolling", { "ankle-rolling.lateral": "limited-right" }, ["R"]);
  assert.equal(got.length, 1, "a sided request silenced a test that has no sides");
});

test("a leg-side marker against a dominance-graded test shows both", () => {
  const cause = { label: "x", tests: ["lunge-extension"], side: "front" as const };
  assert.equal(sidesWanted(cause, "R"), null, "guessed which leg 'dominant' means");
});

test("a backside marker against a dominance-graded test still shows both", () => {
  const cause = { label: "x", tests: ["lunge-extension"], side: "back" as const };
  assert.equal(sidesWanted(cause, "R"), null, "'back' is a leg marker too, not the throwing arm");
});

test("a throwing-side cause resolves to the dominant side on a dominance-graded test", () => {
  /*
   * Per the spec's sides table, `throwing` names the throwing ARM, and a
   * dominance-graded test can answer that directly — Dominant is always
   * the throwing side, regardless of which hand it is. No current cause
   * pairs `throwing` with lunge-extension, but the next one that does must
   * not silently get both sides instead of the dominant one.
   */
  const cause = { label: "x", tests: ["lunge-extension"], side: "throwing" as const };
  assert.deepEqual(sidesWanted(cause, "R"), ["D"]);
  assert.deepEqual(sidesWanted(cause, "L"), ["D"]);
});

test("a side marker for a mixed cause never drops the dominance-graded test's findings", () => {
  /*
   * A cause naming both an lr test and a dominance test (e.g. one mapping
   * Heel Lift and Lunge w/ Extension together) hands the SAME side request
   * to both tests. Heel Lift can honour "L"; Lunge w/ Extension is graded
   * D/N and cannot. The request must degrade to "show both" for the
   * dominance test rather than filtering it to nothing just because a
   * sibling test in the same cause happened to answer to that request.
   */
  const got = abnormalFor("lunge-extension", { "lunge-extension.extension:D": "limited" }, ["L"]);
  assert.equal(got.length, 1, "a side request meant for a different test silently dropped this one");
});

test("a stale dependent finding does not survive a corrected gate answer", () => {
  /*
   * The screen itself hides and discounts a dependent sub-test once its
   * gate answer no longer opens it, but ScreenModal never deletes the
   * stale value from stored results. Recorded in sequence: Heel Lift's
   * height came back "good", quality was graded "rolls-outside", and then
   * the height was corrected to "limited". The quality reading is now
   * unreachable and must not explain anything, even though it is still
   * sitting in the results map.
   */
  const results = {
    "heel-lift.height:L": "limited",
    "heel-lift.quality:L": "rolls-outside",
  };
  const got = abnormalFor("heel-lift", results, ["L"]);
  assert.deepEqual(
    got.map((f) => f.findingLabel),
    ["Limited lift"],
    "the stale quality reading explained the flaw after its gate closed",
  );
});

test("the lead explanation is the highest-ranked cause that has one", () => {
  /*
   * Sway ranks backside hip rotation first and spine disassociation third.
   * With only the third abnormal, the third leads: rank picks among causes
   * that ACTUALLY have a finding, not among all of them.
   */
  const r = explainFlaw("sway", { "pelvic-rotation.rotation": "limited-bilateral" }, "R", new Set(["sway"]))!;
  assert.equal(r.lead?.cause.label, "Spine disassociation");
  assert.equal(r.unexplained, false);
});

test("a flaw with nothing behind it on this screen says so", () => {
  const r = explainFlaw("sway", {}, "R", new Set(["sway"]))!;
  assert.equal(r.lead, undefined);
  assert.equal(r.unexplained, true);
});

test("a test serving two causes is listed once, at its highest rank", () => {
  /*
   * Getting Out In Front names Seated Trunk Rotation under both spine
   * disassociation and thorax mobility. Printing it twice makes the report
   * look like two separate problems.
   */
  const r = explainFlaw(
    "getting-out-in-front",
    { "seated-trunk-rotation.spine-rotation:L": "less" },
    "R",
    new Set(["getting-out-in-front"]),
  )!;
  const all = [r.lead!, ...r.rest].flatMap((e) => e.findings.map((f) => f.testKey));
  assert.deepEqual(all, ["seated-trunk-rotation"]);
});

test("another flaw marked on the same screen is reported as a driver", () => {
  const r = explainFlaw("early-release", {}, "R", new Set(["early-release", "high-hand"]))!;
  assert.deepEqual(r.alsoMarked.map((f) => f.key), ["high-hand"]);
});

test("a flaw not marked on this screen is not reported as a driver", () => {
  const r = explainFlaw("early-release", {}, "R", new Set(["early-release"]))!;
  assert.deepEqual(r.alsoMarked, []);
});

test("an unknown flaw key resolves to nothing rather than throwing", () => {
  assert.equal(explainFlaw("not-a-flaw", {}, "R", new Set()), null);
});

test("a cause the screen cannot measure never counts as an explanation", () => {
  /*
   * Leg strength and power is named by six of the twelve and has no test.
   * It must not resolve to "explained" on the strength of being listed.
   */
  const r = explainFlaw("hanging-back", {}, "R", new Set(["hanging-back"]))!;
  assert.equal(r.unexplained, true);
  assert.ok(sway().causes.some((c) => c.tests.length === 0));
});

/* ------------------------------------------------------------------ *
 * The roster's one-line version
 *
 * The tests roster shows every athlete at a glance. Until now it knew
 * nothing about the delivery, so a pitcher Cole assessed and one he never
 * watched looked identical from there. Same three states as the report, and
 * derived in ONE place so the two cannot drift into disagreeing about the
 * same athlete on the same day.
 * ------------------------------------------------------------------ */

test("a screen with the delivery unassessed says so, whatever else is on it", () => {
  assert.deepEqual(deliveryStatus({}, false), { kind: "not-assessed", count: 0 });
});

test("assessed with nothing marked is clean, which is a result and not an absence", () => {
  assert.deepEqual(deliveryStatus({}, true), { kind: "clean", count: 0 });
});

test("assessed with marks counts them", () => {
  assert.deepEqual(deliveryStatus({ sway: true, "high-hand": true }, true), {
    kind: "marked",
    count: 2,
  });
});

test("an unticked flaw stored as false is not counted", () => {
  /*
   * The write path drops false rather than storing it, but a row written
   * before that rule, or by hand, must not inflate the count.
   */
  assert.deepEqual(deliveryStatus({ sway: true, "late-riser": false }, true), {
    kind: "marked",
    count: 1,
  });
});

test("a key that is not one of the twelve is not counted", () => {
  assert.deepEqual(deliveryStatus({ "sway-ish": true }, true), {
    kind: "clean",
    count: 0,
  });
});
