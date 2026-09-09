import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenInput } from "@/lib/screenInput";
import {
  SCREEN_GROUPS,
  SCREEN_TESTS,
  NOT_TESTED,
  PAINFUL,
  subTestFindings,
  compareScreens,
  deviations,
  fieldKey,
  findingFor,
  isApplicable,
  screenCounts,
  screenFields,
  testMark,
  alerts,
  visibleScreen,
  type Results,
  type Finding,
  type ScreenTest,
} from "@/lib/screen";

const K = fieldKey;
const field = (key: string) => screenFields().find((x) => x.key === key)!;

/*
 * Machinery tests use this rather than a real test. Borrowing a real one as a
 * convenient example means the machinery's tests break every time that test is
 * rebuilt from the app — which happened three times before I moved them here.
 */
const sample: ScreenTest = {
  key: "smp",
  label: "Sample",
  group: "core",
  subTests: [
    {
      key: "q",
      label: "Q",
      bilateral: true,
      findings: [
        { key: "good", label: "Good", normal: true, severity: "green" },
        { key: "mid", label: "Middling", severity: "yellow" },
        { key: "bad", label: "Bad", severity: "red" },
      ],
    },
  ],
};
const SQ = { L: "smp.q:L", R: "smp.q:R" };

/* ------------------------------------------------------------------ *
 * The config itself — these guard the sheet, not the code
 * ------------------------------------------------------------------ */

test("every test belongs to a declared group", () => {
  const ids = new Set(SCREEN_GROUPS.map((g) => g.id));
  for (const t of SCREEN_TESTS)
    assert.ok(ids.has(t.group), `${t.key} is in unknown group ${t.group}`);
});

test("test and sub-test keys are unique where it matters", () => {
  const tests = SCREEN_TESTS.map((t) => t.key);
  assert.equal(new Set(tests).size, tests.length, "duplicate test key");
  for (const t of SCREEN_TESTS) {
    const subs = t.subTests.map((s) => s.key);
    assert.equal(new Set(subs).size, subs.length, `duplicate sub-test key in ${t.key}`);
    for (const s of t.subTests) {
      const keys = s.findings.map((x) => x.key);
      assert.equal(new Set(keys).size, keys.length, `duplicate finding in ${t.key}.${s.key}`);
    }
  }
});

test("every field key is globally unique", () => {
  // Sub-test and finding names repeat across tests, so the key has to carry
  // the test as well. Without that, Holding Pelvis and Holding Shoulders both
  // storing "improves" would collide.
  const keys = screenFields().map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("no finding key collides with the not-tested sentinel", () => {
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      for (const x of s.findings)
        assert.notEqual(x.key, NOT_TESTED, `${t.key}.${s.key} shadows the sentinel`);
});

test("every sub-test offers at least two findings", () => {
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      assert.ok(s.findings.length >= 2, `${t.key}.${s.key} has nothing to choose between`);
});

test("a dependent sub-test names a real sibling and a real finding of it", () => {
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests) {
      if (!s.dependsOn) continue;
      const parent = t.subTests.find((x) => x.key === s.dependsOn!.subTest);
      assert.ok(parent, `${t.key}.${s.key} depends on a sub-test that isn't there`);
      assert.ok(s.dependsOn.findings.length > 0, `${t.key}.${s.key} depends on nothing`);
      for (const key of s.dependsOn.findings)
        assert.ok(
          parent!.findings.some((x) => x.key === key),
          `${t.key}.${s.key} depends on "${key}", which ${parent!.key} doesn't offer`,
        );
      assert.equal(
        parent!.bilateral ?? false,
        s.bilateral ?? false,
        `${t.key}.${s.key} and its parent must be graded the same number of times`,
      );
    }
});

test("the screen covers exactly the tests it should", () => {
  /*
   * Sub-test counts move constantly as each test is rebuilt from the app, so
   * counting them proves nothing. The roster shouldn't move without someone
   * meaning it — this fails if a test goes missing AND if one appears
   * unannounced. Push-Off is two entries on purpose: mound and flat ground
   * are separate tests so a re-screen never compares one against the other.
   */
  assert.deepEqual(SCREEN_TESTS.map((t) => t.key).sort(), [
    "ankle-rocking",
    "ankle-rolling",
    "forearm-80-80",
    "half-kneeling",
    "heel-lift",
    "hip-45",
    "lunge-extension",
    "pelvic-rotation",
    "pelvic-tilt",
    "push-off-flat",
    "push-off-mound",
    "seated-trunk-rotation",
    "shoulder-90-90",
    "side-step-walkout",
    "toe-tap",
    "wide-squat",
    "windshield-wiper",
  ]);
});

test("no two tests share a key, and every one lands in a real group", () => {
  const ids = new Set(SCREEN_GROUPS.map((g) => g.id));
  for (const t of SCREEN_TESTS) assert.ok(ids.has(t.group), `${t.key} has no group`);
});

test("the two push-off variants are graded independently", () => {
  // Splitting them is pointless if their fields collide in storage.
  const mound = screenFields(SCREEN_TESTS.filter((t) => t.key === "push-off-mound"));
  const flat = screenFields(SCREEN_TESTS.filter((t) => t.key === "push-off-flat"));
  assert.ok(mound.length > 0 && flat.length > 0);
  for (const f of mound)
    assert.ok(!flat.some((x) => x.key === f.key), `${f.key} is shared between surfaces`);
});

/* ------------------------------------------------------------------ *
 * Applicability
 * ------------------------------------------------------------------ */

test("an ordinary field is always applicable", () => {
  assert.equal(isApplicable(field(K("hip-45", "45-degree-angle", "L")), {}), true);
});

test("arms down is only reached by breaking parallel", () => {
  const armsDown = field(K("wide-squat", "arms-down"));
  assert.equal(isApplicable(armsDown, {}), false, "blank parent must not open it");
  assert.equal(
    isApplicable(armsDown, { [K("wide-squat", "arms-in-front")]: "limited-squat" }),
    false,
  );
  assert.equal(
    isApplicable(armsDown, { [K("wide-squat", "arms-in-front")]: "good-squat" }),
    true,
  );
});

/*
 * Wide Squat is the only dependency today and it is graded once, so nothing
 * in the real config can tell whether the check is side-aware. It has to be:
 * a right leg that broke parallel says nothing about the left.
 */
const bilateralDep: ScreenTest = {
  key: "bt",
  label: "BT",
  group: "core",
  subTests: [
    {
      key: "parent",
      label: "Parent",
      bilateral: true,
      findings: [{ key: "yes", label: "Yes", normal: true }, { key: "no", label: "No" }],
    },
    {
      key: "child",
      label: "Child",
      bilateral: true,
      dependsOn: { subTest: "parent", findings: ["yes"] },
      findings: [{ key: "ok", label: "OK", normal: true }, { key: "bad", label: "Bad" }],
    },
  ],
};

test("a bilateral dependency is resolved per side", () => {
  const fields = screenFields([bilateralDep]);
  const results: Results = { "bt.parent:L": "yes", "bt.parent:R": "no" };
  const child = (side: string) => fields.find((f) => f.key === `bt.child:${side}`)!;
  assert.equal(isApplicable(child("L"), results), true, "left qualified");
  assert.equal(isApplicable(child("R"), results), false, "right did not");
});

test("a field that never happened is not counted as blank", () => {
  const results = { [K("wide-squat", "arms-in-front")]: "limited-squat" };
  const before = screenCounts({}).notApplicable;
  // Answering the parent the wrong way keeps Arms Down out of reach.
  assert.equal(screenCounts(results).notApplicable, before);
  assert.ok(before >= 1);
});

/* ------------------------------------------------------------------ *
 * Reading findings
 * ------------------------------------------------------------------ */

test("a stored finding resolves back to its config entry", () => {
  const f = screenFields([sample]).find((x) => x.key === SQ.R)!;
  const found = findingFor(f, { [SQ.R]: "mid" });
  assert.equal(found?.label, "Middling");
  assert.equal(found?.normal, undefined);
});

test("blank and not-tested both read as no finding", () => {
  const f = field(K("hip-45", "45-degree-angle", "R"));
  assert.equal(findingFor(f, {}), null);
  assert.equal(findingFor(f, { [f.key]: NOT_TESTED }), null);
});

test("a finding key that isn't in the config is ignored, not guessed at", () => {
  const f = field(K("hip-45", "45-degree-angle", "R"));
  assert.equal(findingFor(f, { [f.key]: "wildly-wrong" }), null);
});

/* ------------------------------------------------------------------ *
 * Deviations
 * ------------------------------------------------------------------ */

test("only non-normal findings count as deviations", () => {
  const d = deviations({ [SQ.L]: "good", [SQ.R]: "bad" }, [sample]);
  assert.equal(d.length, 1);
  assert.equal(d[0].field.side, "R");
  assert.equal(d[0].finding.label, "Bad");
});

test("a list with more than one passing answer treats both as passing", () => {
  /*
   * Held as a fixture. The real case was Ankle Rocking, whose 2019 column
   * shaded both Good Inversion and Good Eversion — but that turned out to be
   * the sheet squeezing two questions into one column, and the app asks them
   * separately. The capability stays because a future test may need it.
   */
  const t: ScreenTest = {
    key: "two", label: "Two", group: "core",
    subTests: [{
      key: "q", label: "Q",
      findings: [
        { key: "a", label: "A", normal: true },
        { key: "b", label: "B", normal: true },
        { key: "c", label: "C", severity: "red" },
      ],
    }],
  };
  assert.equal(deviations({ "two.q": "a" }, [t]).length, 0);
  assert.equal(deviations({ "two.q": "b" }, [t]).length, 0);
  assert.equal(deviations({ "two.q": "c" }, [t]).length, 1);
});

test("a blank screen has no deviations rather than fifty-two", () => {
  assert.deepEqual(deviations({}), []);
});

test("a deviation on a field that never happened is not reported", () => {
  const results: Results = {
    [K("wide-squat", "arms-in-front")]: "limited-squat",
    [K("wide-squat", "arms-down")]: "unstable",
  };
  // The stale answer stays in the row but must not be read back out.
  assert.deepEqual(
    deviations(results).map((d) => d.field.key),
    [K("wide-squat", "arms-in-front")],
  );
});

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

test("an untouched screen is all blank, not all normal", () => {
  // The form defaults its inputs to normal; the record must not pretend the
  // coach looked at everything they never touched.
  const c = screenCounts({});
  const fields = screenFields();
  const reachable = fields.filter((f) => !f.subTest.dependsOn).length;
  assert.equal(c.normal, 0);
  assert.equal(c.deviation, 0);
  assert.equal(c.blank, reachable, "everything askable is blank");
  assert.equal(c.notApplicable, fields.length - reachable, "every branch is closed");
});

test("counts separate normal, deviation and skipped", () => {
  const c = screenCounts({
    [K("hip-45", "45-degree-angle", "L")]: "greater",
    [K("hip-45", "45-degree-angle", "R")]: "less",
    [K("toe-tap", "hip-ir", "L")]: NOT_TESTED,
  });
  assert.equal(c.normal, 1);
  assert.equal(c.deviation, 1);
  assert.equal(c.notTested, 1);
});

/* ------------------------------------------------------------------ *
 * Severity roll-up
 * ------------------------------------------------------------------ */

const graded: ScreenTest = {
  key: "t",
  label: "T",
  group: "core",
  subTests: [
    {
      key: "a",
      label: "A",
      findings: [
        { key: "ok", label: "OK", normal: true, severity: "green" },
        { key: "mid", label: "Mid", severity: "yellow" },
        { key: "bad", label: "Bad", severity: "red" },
      ],
    },
    {
      key: "b",
      label: "B",
      findings: [
        { key: "ok", label: "OK", normal: true, severity: "green" },
        { key: "mid", label: "Mid", severity: "yellow" },
      ],
    },
  ],
};

test("a test takes the worst mark among its findings", () => {
  // Matches the OnBaseU app: Push-Off with two middle answers reads yellow.
  assert.equal(testMark(graded, { "t.a": "mid", "t.b": "mid" }), "yellow");
  assert.equal(testMark(graded, { "t.a": "bad", "t.b": "ok" }), "red");
  assert.equal(testMark(graded, { "t.a": "ok", "t.b": "ok" }), "green");
});

test("a mark is null while the mapping is unfilled, never a false green", () => {
  // A test still on 2019 wording has no severities. It must show no colour
  // rather than claiming everything is fine.
  const t: ScreenTest = {
    key: "u", label: "U", group: "core",
    subTests: [{ key: "q", label: "Q", findings: [{ key: "ok", label: "OK", normal: true }] }],
  };
  assert.equal(testMark(t, { "u.q": "ok" }), null);
});

/* ------------------------------------------------------------------ *
 * Re-screen comparison — the reason to keep history
 * ------------------------------------------------------------------ */

const hip = (l: string) => ({ [K("hip-45", "45-degree-angle", "L")]: l });

test("a deviation that cleared is reported as resolved", () => {
  const c = compareScreens(hip("less"), hip("greater"));
  assert.equal(c.resolved.length, 1);
  assert.equal(c.appeared.length, 0);
  assert.equal(c.persisting.length, 0);
});

test("a new deviation is reported as appeared", () => {
  const c = compareScreens(hip("greater"), hip("less"));
  assert.equal(c.appeared.length, 1);
  assert.equal(c.resolved.length, 0);
});

test("improvement short of normal is kept, not flattened to no change", () => {
  /*
   * A pelvis that goes from tilting in neither direction to only failing to
   * arch has genuinely improved — red to yellow. A comparison that asked
   * merely "normal or not" would report nothing moved, which is exactly the
   * athlete you would lose.
   */
  const key = K("pelvic-tilt", "tilt");
  const c = compareScreens({ [key]: "cannot-either" }, { [key]: "cannot-arch" });
  assert.equal(c.persisting.length, 1);
  assert.equal(c.persisting[0].before.label, "Cannot tilt in either direction");
  assert.equal(c.persisting[0].after.label, "Cannot arch the back");
});

test("two identical screens report nothing at all", () => {
  const r = hip("less");
  const c = compareScreens(r, r);
  assert.equal(c.resolved.length + c.appeared.length, 0);
  assert.equal(c.persisting.length, 1);
});

test("a screen compared against nothing shows every deviation as new", () => {
  const c = compareScreens({}, hip("less"));
  assert.equal(c.appeared.length, 1);
});

/* ------------------------------------------------------------------ *
 * Diagnostic sub-tests
 * ------------------------------------------------------------------ */

test("a sub-test needs a passing answer only if it can be reached clean", () => {
  /*
   * A follow-up you only see because something already went wrong has no
   * passing answer, and shouldn't: reaching Pelvic Rotation's "with
   * assistance" menu means the athlete was already limited, so its best
   * outcome is yellow. But a sub-test with no dependsOn is asked of everyone,
   * and one with nothing marked normal there is a config mistake.
   */
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests) {
      const normals = s.findings.filter((x) => x.normal).length;
      if (s.diagnostic)
        assert.equal(normals, 0, `${t.key}.${s.key} is diagnostic but marks a normal`);
      else if (!s.dependsOn)
        assert.ok(normals >= 1, `${t.key}.${s.key} is asked of everyone and grades nothing as normal`);
    }
});

test("a diagnostic answer is never a deviation", () => {
  const results: Results = {
    [K("ankle-rocking", "seated-holding", "L")]: "limited-eversion",
  };
  assert.deepEqual(deviations(results), []);
});

test("a diagnostic answer still records, and still compares", () => {
  // Not a failure, but a change in it is worth seeing on a re-screen.
  const t: ScreenTest = {
    key: "d", label: "D", group: "core",
    subTests: [{
      key: "why", label: "Why", diagnostic: true,
      findings: [{ key: "improves", label: "Improves" }, { key: "no", label: "No change" }],
    }],
  };
  const f = screenFields([t])[0];
  assert.equal(findingFor(f, { "d.why": "improves" })?.label, "Improves");
  assert.equal(deviations({ "d.why": "no" }, [t]).length, 0);
});

/* ------------------------------------------------------------------ *
 * Alerts and branching follow-ups
 * ------------------------------------------------------------------ */

/** Pelvic Tilt as the current app runs it, in miniature. */
const branching: ScreenTest = {
  key: "pt",
  label: "PT",
  group: "core",
  subTests: [
    {
      key: "tilt",
      label: "Tilt",
      findings: [
        { key: "both", label: "Can tilt both directions", normal: true, severity: "green" },
        { key: "cannot-arch", label: "Cannot arch", severity: "yellow" },
        { key: "cannot-flatten", label: "Cannot flatten", severity: "yellow" },
        { key: "neither", label: "Cannot tilt either direction", severity: "red" },
        { key: "painful", label: "Painful", alert: true },
      ],
    },
    {
      key: "quality-able",
      label: "Quality (able)",
      dependsOn: { subTest: "tilt", findings: ["both"] },
      findings: [
        { key: "smooth", label: "Smooth", normal: true, severity: "green" },
        { key: "shake", label: "Shake and bake", severity: "yellow" },
      ],
    },
    {
      key: "quality-limited",
      label: "Quality (limited)",
      // Two answers open the same follow-up, which is why dependsOn takes a list.
      dependsOn: { subTest: "tilt", findings: ["cannot-arch", "cannot-flatten"] },
      findings: [
        { key: "smooth", label: "Smooth", normal: true, severity: "yellow" },
        { key: "shake", label: "Shake and bake", severity: "red" },
      ],
    },
  ],
};

test("either limited answer opens the same follow-up", () => {
  const fields = screenFields([branching]);
  const limited = fields.find((f) => f.key === "pt.quality-limited")!;
  const able = fields.find((f) => f.key === "pt.quality-able")!;
  assert.equal(isApplicable(limited, { "pt.tilt": "cannot-arch" }), true);
  assert.equal(isApplicable(limited, { "pt.tilt": "cannot-flatten" }), true);
  assert.equal(isApplicable(limited, { "pt.tilt": "both" }), false);
  assert.equal(isApplicable(able, { "pt.tilt": "both" }), true);
  assert.equal(isApplicable(able, { "pt.tilt": "cannot-arch" }), false);
});

test("the same follow-up answer means different things down different branches", () => {
  /*
   * "Shake and bake" is yellow when the pelvis tilts fine and red when it
   * doesn't. Severity lives on the branch's own finding list, so the roll-up
   * needs no special case to get this right.
   */
  assert.equal(testMark(branching, { "pt.tilt": "both", "pt.quality-able": "shake" }), "yellow");
  assert.equal(
    testMark(branching, { "pt.tilt": "cannot-arch", "pt.quality-limited": "shake" }),
    "red",
  );
  assert.equal(testMark(branching, { "pt.tilt": "both", "pt.quality-able": "smooth" }), "green");
  assert.equal(
    testMark(branching, { "pt.tilt": "cannot-arch", "pt.quality-limited": "smooth" }),
    "yellow",
  );
  assert.equal(testMark(branching, { "pt.tilt": "neither" }), "red");
});

test("pain replaces the colour rather than outranking it", () => {
  // Not "worse than red" — off the scale. It wins even beside a red.
  assert.equal(testMark(branching, { "pt.tilt": "painful" }), "alert");
});

test("an alert wins wherever it sits among coloured findings", () => {
  const t: ScreenTest = {
    key: "x", label: "X", group: "core",
    subTests: [
      { key: "a", label: "A", findings: [{ key: "bad", label: "Bad", severity: "red" }] },
      { key: "b", label: "B", findings: [{ key: "ow", label: "Ow", alert: true }] },
    ],
  };
  assert.equal(testMark(t, { "x.a": "bad", "x.b": "ow" }), "alert");
});

test("alerts are listed separately from deviations", () => {
  const results: Results = { "pt.tilt": "painful" };
  assert.equal(alerts(results, [branching]).length, 1);
  assert.equal(alerts(results, [branching])[0].finding.label, "Painful");
});

test("an alert on a branch that never happened is not raised", () => {
  const t: ScreenTest = {
    key: "y", label: "Y", group: "core",
    subTests: [
      { key: "a", label: "A", findings: [{ key: "no", label: "No", normal: true }] },
      {
        key: "b", label: "B",
        dependsOn: { subTest: "a", findings: ["yes"] },
        findings: [{ key: "ow", label: "Ow", alert: true }],
      },
    ],
  };
  assert.equal(testMark(t, { "y.a": "no", "y.b": "ow" }), null);
  assert.equal(alerts({ "y.a": "no", "y.b": "ow" }, [t]).length, 0);
});

/* ------------------------------------------------------------------ *
 * What reaches an athlete
 * ------------------------------------------------------------------ */

test("a coach sees the screen whole", () => {
  const s = { id: "1", date: "2026-09-08", results: {}, notes: "guarding" };
  assert.deepEqual(visibleScreen(s, true), s);
});

test("the coach's note never reaches an athlete", () => {
  const s = { id: "1", date: "2026-09-08", results: {}, notes: "guarding" };
  const seen = visibleScreen(s, false);
  assert.equal("notes" in seen, false, "absent, not blanked");
  assert.equal(seen.id, "1");
});

test("the findings themselves are the athlete's to see", () => {
  const s = { id: "1", date: "2026-09-08", results: { a: "b" }, notes: "x" };
  assert.deepEqual(visibleScreen(s, false).results, { a: "b" });
});

test("stripping does not mutate the row it was given", () => {
  const s = { id: "1", date: "2026-09-08", results: {}, notes: "guarding" };
  visibleScreen(s, false);
  assert.equal(s.notes, "guarding", "the coach's own copy must survive");
});

test("an ungraded deviation shows no mark rather than the other side's green", () => {
  /*
   * The bug this exists to stop, found on a half-mapped Toe Tap: one leg
   * touches the bat, the other is short, and "short" has no colour yet.
   * Worst-of over the KNOWN severities returns the good side's green, and a
   * failing test reads as clean.
   *
   * Held as a fixture rather than a real test, because a real one stops
   * demonstrating it the moment its colours are filled in.
   */
  const t: ScreenTest = {
    key: "half", label: "Half", group: "core",
    subTests: [{
      key: "s", label: "S", bilateral: true,
      findings: [
        { key: "ok", label: "OK", normal: true, severity: "green" },
        { key: "bad", label: "Bad" }, // colour not supplied yet
        { key: "ow", label: "Ow", alert: true },
      ],
    }],
  };
  assert.equal(testMark(t, { "half.s:L": "ok", "half.s:R": "ok" }), "green");
  assert.equal(testMark(t, { "half.s:L": "ok", "half.s:R": "bad" }), null, "must not read green");
  // Pain still wins outright, mapping or no mapping.
  assert.equal(testMark(t, { "half.s:L": "ow", "half.s:R": "bad" }), "alert");
});

/* ------------------------------------------------------------------ *
 * Toe Tap, as the app runs it
 *
 * Every case asserted for BOTH sides. A per-side rule that is only ever
 * exercised on the right is a rule that works on the right.
 * ------------------------------------------------------------------ */

const toeTap = () => SCREEN_TESTS.find((x) => x.key === "toe-tap")!;
const TT = {
  L: K("toe-tap", "hip-ir", "L"),
  R: K("toe-tap", "hip-ir", "R"),
  HL: K("toe-tap", "holding-pelvis", "L"),
  HR: K("toe-tap", "holding-pelvis", "R"),
};

test("toe tap: reaching the bat on both sides is green", () => {
  assert.equal(testMark(toeTap(), { [TT.L]: "touches", [TT.R]: "touches" }), "green");
});

test("toe tap: short is yellow before the follow-up is answered", () => {
  assert.equal(testMark(toeTap(), { [TT.L]: "short", [TT.R]: "short" }), "yellow");
});

test("toe tap: reaching once the pelvis is held stays yellow, either side", () => {
  const right = { [TT.L]: "touches", [TT.R]: "short", [TT.HR]: "touches" };
  const left = { [TT.R]: "touches", [TT.L]: "short", [TT.HL]: "touches" };
  assert.equal(testMark(toeTap(), right), "yellow");
  assert.equal(testMark(toeTap(), left), "yellow");
});

test("toe tap: still short with the pelvis held is red, either side", () => {
  const right = { [TT.L]: "touches", [TT.R]: "short", [TT.HR]: "still-short" };
  const left = { [TT.R]: "touches", [TT.L]: "short", [TT.HL]: "still-short" };
  assert.equal(testMark(toeTap(), right), "red", "right leg");
  assert.equal(testMark(toeTap(), left), "red", "left leg");
});

test("toe tap: pain on either leg flags the test", () => {
  assert.equal(testMark(toeTap(), { [TT.L]: "touches", [TT.R]: "painful" }), "alert");
  assert.equal(testMark(toeTap(), { [TT.R]: "touches", [TT.L]: "painful" }), "alert");
});

test("toe tap: the follow-up belongs to the side that came up short", () => {
  const fields = screenFields([toeTap()]);
  const held = (side: string) => fields.find((f) => f.key === TT[side as "HL" | "HR"])!;
  const rightShort = { [TT.L]: "touches", [TT.R]: "short" };
  const leftShort = { [TT.R]: "touches", [TT.L]: "short" };
  assert.equal(isApplicable(held("HR"), rightShort), true);
  assert.equal(isApplicable(held("HL"), rightShort), false, "left leg was fine");
  assert.equal(isApplicable(held("HL"), leftShort), true);
  assert.equal(isApplicable(held("HR"), leftShort), false, "right leg was fine");
});

/* ------------------------------------------------------------------ *
 * Hip 45 — one question per hip, graded independently
 * ------------------------------------------------------------------ */

const hip45 = () => SCREEN_TESTS.find((x) => x.key === "hip-45")!;
const H = { L: K("hip-45", "45-degree-angle", "L"), R: K("hip-45", "45-degree-angle", "R") };

test("hip 45: each finding carries its own colour", () => {
  assert.equal(testMark(hip45(), { [H.L]: "greater", [H.R]: "greater" }), "green");
  assert.equal(testMark(hip45(), { [H.L]: "equal", [H.R]: "equal" }), "yellow");
  assert.equal(testMark(hip45(), { [H.L]: "less", [H.R]: "less" }), "red");
});

test("hip 45: the worse hip decides the test, whichever side it is", () => {
  assert.equal(testMark(hip45(), { [H.L]: "greater", [H.R]: "equal" }), "yellow", "right worse");
  assert.equal(testMark(hip45(), { [H.R]: "greater", [H.L]: "equal" }), "yellow", "left worse");
  assert.equal(testMark(hip45(), { [H.L]: "greater", [H.R]: "less" }), "red", "right worse");
  assert.equal(testMark(hip45(), { [H.R]: "greater", [H.L]: "less" }), "red", "left worse");
});

test("hip 45: pain on either hip flags the test", () => {
  assert.equal(testMark(hip45(), { [H.L]: "greater", [H.R]: "painful" }), "alert");
  assert.equal(testMark(hip45(), { [H.R]: "less", [H.L]: "painful" }), "alert", "beats a red");
});

test("hip 45: nothing opens a follow-up", () => {
  for (const s of hip45().subTests)
    assert.equal(s.dependsOn, undefined, `${s.key} should not branch`);
});

/* ------------------------------------------------------------------ *
 * Seated Trunk Rotation — trunk and neck, both sides, no branching
 * ------------------------------------------------------------------ */

const trunk = () => SCREEN_TESTS.find((x) => x.key === "seated-trunk-rotation")!;
const STR = {
  sL: K("seated-trunk-rotation", "spine-rotation", "L"),
  sR: K("seated-trunk-rotation", "spine-rotation", "R"),
  cL: K("seated-trunk-rotation", "cervical", "L"),
  cR: K("seated-trunk-rotation", "cervical", "R"),
};
const clean = { [STR.sL]: "greater", [STR.sR]: "greater", [STR.cL]: "touches", [STR.cR]: "touches" };

test("trunk rotation: a clean screen on all four readings is green", () => {
  assert.equal(testMark(trunk(), clean), "green");
});

test("trunk rotation: the worst reading decides, whichever side or part", () => {
  assert.equal(testMark(trunk(), { ...clean, [STR.sR]: "equal" }), "yellow", "right trunk");
  assert.equal(testMark(trunk(), { ...clean, [STR.sL]: "equal" }), "yellow", "left trunk");
  assert.equal(testMark(trunk(), { ...clean, [STR.sR]: "less" }), "red", "right trunk");
  assert.equal(testMark(trunk(), { ...clean, [STR.sL]: "less" }), "red", "left trunk");
});

test("trunk rotation: a short chin is red on either side", () => {
  for (const side of [STR.cL, STR.cR]) {
    assert.equal(deviations({ ...clean, [side]: "short" }).length, 1);
    assert.equal(testMark(trunk(), { ...clean, [side]: "short" }), "red");
  }
});

test("trunk rotation: neck and trunk are asked of everyone, not branched", () => {
  for (const s of trunk().subTests)
    assert.equal(s.dependsOn, undefined, `${s.key} should not branch`);
});

/* ------------------------------------------------------------------ *
 * Pain, offered everywhere
 * ------------------------------------------------------------------ */

test("every sub-test in the config offers Painful", () => {
  // The reason it is universal rather than repeated: this holds for tests
  // added later without anyone remembering to add it.
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests) {
      const found = subTestFindings(s).find((x) => x.key === PAINFUL);
      assert.ok(found, `${t.key}.${s.key} cannot record pain`);
      assert.equal(found!.alert, true);
    }
});

test("no sub-test declares its own Painful", () => {
  // A local copy would shadow the universal one and could carry a colour,
  // putting pain back on the scale it was deliberately taken off.
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      assert.ok(
        !s.findings.some((x) => x.key === PAINFUL),
        `${t.key}.${s.key} declares its own painful`,
      );
});

test("pain is recordable on a follow-up, not just an opening question", () => {
  const held = field(K("toe-tap", "holding-pelvis", "R"));
  assert.equal(findingFor(held, { [held.key]: PAINFUL })?.alert, true);
});

test("pain flags the test wherever it is recorded", () => {
  const t = SCREEN_TESTS.find((x) => x.key === "seated-trunk-rotation")!;
  assert.equal(testMark(t, { ...clean, [STR.cR]: PAINFUL }), "alert", "beats a clean screen");
  assert.equal(
    testMark(t, { ...clean, [STR.sL]: "less", [STR.cR]: PAINFUL }),
    "alert",
    "beats a red",
  );
});

test("the validator accepts pain on any field", () => {
  const r = parseScreenInput(
    { date: "2026-09-08", results: { [K("hip-45", "45-degree-angle", "L")]: PAINFUL } },
    "2026-09-08",
  );
  assert.equal(r.ok, true);
});

/* ------------------------------------------------------------------ *
 * Side Step Walkout — one reading, no sides, no branching
 * ------------------------------------------------------------------ */

const walkout = () => SCREEN_TESTS.find((x) => x.key === "side-step-walkout")!;
const W = K("side-step-walkout", "distance");

test("side step walkout: each distance carries its own colour", () => {
  assert.equal(testMark(walkout(), { [W]: "greater" }), "green");
  assert.equal(testMark(walkout(), { [W]: "equal" }), "yellow");
  assert.equal(testMark(walkout(), { [W]: "less" }), "red");
});

test("side step walkout: pain flags it, and skipping leaves no mark", () => {
  assert.equal(testMark(walkout(), { [W]: PAINFUL }), "alert");
  assert.equal(testMark(walkout(), { [W]: NOT_TESTED }), null);
});

test("side step walkout is graded once, with nothing branching off it", () => {
  const fields = screenFields([walkout()]);
  assert.equal(fields.length, 1, "one reading, not a left and a right");
  assert.equal(fields[0].side, undefined);
  assert.equal(walkout().subTests[0].dependsOn, undefined);
});

/* ------------------------------------------------------------------ *
 * Push-Off — a gate, then a grade, on either surface
 * ------------------------------------------------------------------ */

for (const key of ["push-off-mound", "push-off-flat"] as const) {
  const test_ = () => SCREEN_TESTS.find((x) => x.key === key)!;
  const P = K(key, "planted");
  const R = K(key, "released");

  test(`${key}: falling short of five foot lengths fails outright`, () => {
    assert.equal(testMark(test_(), { [P]: "lt-5" }), "red");
    const released = screenFields([test_()]).find((f) => f.key === R)!;
    assert.equal(isApplicable(released, { [P]: "lt-5" }), false, "and asks nothing further");
  });

  test(`${key}: stage one is a gate, so stage two supplies the colour`, () => {
    // Both passing distances carry no colour of their own — five-to-six with
    // a good release is as green as over-six with one.
    assert.equal(testMark(test_(), { [P]: "gt-6", [R]: "gt-half" }), "green");
    assert.equal(testMark(test_(), { [P]: "5-to-6", [R]: "gt-half" }), "green");
    assert.equal(testMark(test_(), { [P]: "gt-6", [R]: "lt-half" }), "yellow");
    assert.equal(testMark(test_(), { [P]: "5-to-6", [R]: "none" }), "red");
  });

  test(`${key}: pain flags it and skipping leaves no mark`, () => {
    assert.equal(testMark(test_(), { [P]: PAINFUL }), "alert");
    assert.equal(testMark(test_(), { [P]: NOT_TESTED }), null);
  });
}

test("the two push-off surfaces are graded from separate answers", () => {
  // Sharing a sub-test definition must not mean sharing an athlete's results.
  const results = {
    [K("push-off-mound", "planted")]: "lt-5",
    [K("push-off-flat", "planted")]: "gt-6",
    [K("push-off-flat", "released")]: "gt-half",
  };
  assert.equal(testMark(SCREEN_TESTS.find((t) => t.key === "push-off-mound")!, results), "red");
  assert.equal(testMark(SCREEN_TESTS.find((t) => t.key === "push-off-flat")!, results), "green");
});

/* ------------------------------------------------------------------ *
 * Heel Lift — gate then grade, per side
 * ------------------------------------------------------------------ */

const heel = () => SCREEN_TESTS.find((x) => x.key === "heel-lift")!;
const HL = {
  hL: K("heel-lift", "height", "L"),
  hR: K("heel-lift", "height", "R"),
  qL: K("heel-lift", "quality", "L"),
  qR: K("heel-lift", "quality", "R"),
};

test("heel lift: a limited lift fails and asks nothing further, either side", () => {
  for (const [h, q] of [[HL.hR, HL.qR], [HL.hL, HL.qL]] as const) {
    assert.equal(testMark(heel(), { [h]: "limited" }), "red");
    const quality = screenFields([heel()]).find((f) => f.key === q)!;
    assert.equal(isApplicable(quality, { [h]: "limited" }), false);
  }
});

test("heel lift: a good lift opens the quality question on that side only", () => {
  const rightGood = { [HL.hR]: "good", [HL.hL]: "limited" };
  const fields = screenFields([heel()]);
  const q = (key: string) => fields.find((f) => f.key === key)!;
  assert.equal(isApplicable(q(HL.qR), rightGood), true);
  assert.equal(isApplicable(q(HL.qL), rightGood), false, "the limited side ends there");
});

test("heel lift: quality supplies the colour once the gate is passed", () => {
  const both = { [HL.hL]: "good", [HL.hR]: "good" };
  assert.equal(testMark(heel(), { ...both, [HL.qL]: "straight-up", [HL.qR]: "straight-up" }), "green");
  assert.equal(testMark(heel(), { ...both, [HL.qL]: "straight-up", [HL.qR]: "rolls-outside" }), "red", "right");
  assert.equal(testMark(heel(), { ...both, [HL.qR]: "straight-up", [HL.qL]: "rolls-outside" }), "red", "left");
});

test("heel lift: a good lift alone leaves no mark until quality is answered", () => {
  assert.equal(testMark(heel(), { [HL.hL]: "good", [HL.hR]: "good" }), null);
});

test("heel lift: pain flags it on either side", () => {
  assert.equal(testMark(heel(), { [HL.hR]: PAINFUL }), "alert");
  assert.equal(testMark(heel(), { [HL.hL]: PAINFUL }), "alert");
});

test("push-off grades the improvement, not the constrained baseline", () => {
  /*
   * The point of the test: can they beat their own constrained number once
   * the constraint comes off. So a five-to-six baseline that improves well is
   * as green as an over-six one, and an over-six baseline that fails to
   * improve is as red as a five-to-six one that doesn't.
   */
  const t = SCREEN_TESTS.find((x) => x.key === "push-off-mound")!;
  const P = K("push-off-mound", "planted");
  const R = K("push-off-mound", "released");
  assert.equal(testMark(t, { [P]: "5-to-6", [R]: "gt-half" }), "green");
  assert.equal(testMark(t, { [P]: "gt-6", [R]: "gt-half" }), "green");
  assert.equal(testMark(t, { [P]: "gt-6", [R]: "none" }), "red", "a good baseline earns nothing");
  assert.equal(testMark(t, { [P]: "5-to-6", [R]: "none" }), "red");
});

/* ------------------------------------------------------------------ *
 * A canary over the whole config
 *
 * Pelvic Rotation regressed to "no mark" on every graded outcome and nothing
 * noticed, because its outcomes had only been checked by a throwaway script.
 * This walks every test in the config instead of trusting that each one got
 * its own block — including the seven not yet rebuilt, and any added later.
 * ------------------------------------------------------------------ */

/** Answer a test end to end, taking the nth option at each question. */
function answerFully(t: ScreenTest, pick: (f: Finding[]) => Finding): Results {
  const results: Results = {};
  // Repeat so branches opened by an answer get answered in turn.
  for (let pass = 0; pass < 4; pass++)
    for (const field of screenFields([t])) {
      if (!isApplicable(field, results) || results[field.key]) continue;
      results[field.key] = pick(field.subTest.findings).key;
    }
  return results;
}

test("a fully answered screen yields a mark wherever the colours exist", () => {
  for (const t of SCREEN_TESTS) {
    for (const pick of [
      (f: Finding[]) => f[0],
      (f: Finding[]) => f[f.length - 1],
    ]) {
      const results = answerFully(t, pick);
      // Only meaningful once every answer given carries a colour — the
      // unrebuilt tests still have none, and null is right for those.
      const graded = screenFields([t])
        .filter((f) => isApplicable(f, results))
        .every((f) => {
          const found = findingFor(f, results);
          return !found || found.severity || found.alert;
        });
      if (!graded) continue;
      assert.notEqual(
        testMark(t, results),
        null,
        `${t.key} answered end to end, every answer coloured, yet shows no mark`,
      );
    }
  }
});

test("a finding that opens a branch defers its colour rather than voiding it", () => {
  /*
   * The regression itself, in miniature. "Limited" carries no colour because
   * the branch it opens carries one. Treating that as an ungraded deviation
   * wiped the mark off every graded outcome of Pelvic Rotation.
   */
  const t: ScreenTest = {
    key: "def", label: "Def", group: "core",
    subTests: [
      {
        key: "gate", label: "Gate",
        findings: [
          { key: "ok", label: "OK", normal: true, severity: "green" },
          { key: "limited", label: "Limited" },
          { key: "orphan", label: "Orphan" },
        ],
      },
      {
        key: "branch", label: "Branch",
        dependsOn: { subTest: "gate", findings: ["limited"] },
        findings: [{ key: "worse", label: "Worse", severity: "red" }],
      },
      // A second reading that passes, so an ungraded answer on the gate has a
      // green sitting beside it to be wrongly promoted to.
      {
        key: "other", label: "Other",
        findings: [{ key: "fine", label: "Fine", normal: true, severity: "green" }],
      },
    ],
  };
  const clean = { "def.other": "fine" };
  assert.equal(testMark(t, { ...clean, "def.gate": "limited", "def.branch": "worse" }), "red");
  assert.equal(testMark(t, { ...clean, "def.gate": "limited" }), null, "branch unanswered");
  /*
   * "Orphan" opens nothing and carries no colour, so it is genuinely ungraded
   * and must not inherit the other reading's green. Deferral has to be keyed
   * on the specific finding — treating every answer on a branching sub-test
   * as deferred puts the false green straight back.
   */
  assert.equal(testMark(t, { ...clean, "def.gate": "orphan" }), null, "must not read green");
  /*
   * The coach picked "limited", answered the follow-up, then changed the
   * first answer. The stale branch reply stays stored on purpose, so that
   * changing back doesn't lose it — but it belongs to a finding that is no
   * longer selected, and must not be read as having resolved this one.
   */
  assert.equal(
    testMark(t, { ...clean, "def.gate": "orphan", "def.branch": "worse" }),
    null,
    "a stale branch answer must not resolve an unrelated finding",
  );
});

/* ------------------------------------------------------------------ *
 * The two tests that had only ever been checked by script
 * ------------------------------------------------------------------ */

const tilt = () => SCREEN_TESTS.find((x) => x.key === "pelvic-tilt")!;
const PT = {
  t: K("pelvic-tilt", "tilt"),
  a: K("pelvic-tilt", "quality-tilting"),
  b: K("pelvic-tilt", "quality-limited"),
};

test("pelvic tilt: the same follow-up answer differs by branch", () => {
  assert.equal(testMark(tilt(), { [PT.t]: "can-tilt-both", [PT.a]: "smooth" }), "green");
  assert.equal(testMark(tilt(), { [PT.t]: "can-tilt-both", [PT.a]: "shake" }), "yellow");
  assert.equal(testMark(tilt(), { [PT.t]: "cannot-arch", [PT.b]: "smooth" }), "yellow");
  assert.equal(testMark(tilt(), { [PT.t]: "cannot-arch", [PT.b]: "shake" }), "red");
  assert.equal(testMark(tilt(), { [PT.t]: "cannot-flatten", [PT.b]: "shake" }), "red");
});

test("pelvic tilt: failing both directions ends it, and pain flags it", () => {
  assert.equal(testMark(tilt(), { [PT.t]: "cannot-either" }), "red");
  assert.equal(testMark(tilt(), { [PT.t]: PAINFUL }), "alert");
  assert.equal(testMark(tilt(), { [PT.t]: NOT_TESTED }), null);
});

const rot = () => SCREEN_TESTS.find((x) => x.key === "pelvic-rotation")!;
const PR = {
  r: K("pelvic-rotation", "rotation"),
  both: K("pelvic-rotation", "assist-bilateral"),
  right: K("pelvic-rotation", "assist-right"),
  left: K("pelvic-rotation", "assist-left"),
};

test("pelvic rotation: assistance decides a bilateral limitation", () => {
  assert.equal(testMark(rot(), { [PR.r]: "good-bilateral" }), "green");
  assert.equal(testMark(rot(), { [PR.r]: "limited-bilateral", [PR.both]: "improves-bilateral" }), "yellow");
  assert.equal(testMark(rot(), { [PR.r]: "limited-bilateral", [PR.both]: "no-improvement" }), "red");
  // Improving on only one side out of a bilateral limitation stays red.
  assert.equal(testMark(rot(), { [PR.r]: "limited-bilateral", [PR.both]: "improves-right" }), "red");
  assert.equal(testMark(rot(), { [PR.r]: "limited-bilateral", [PR.both]: "improves-left" }), "red");
});

test("pelvic rotation: a one-sided limitation is yellow either way, both sides", () => {
  for (const [gate, follow] of [["limited-right", PR.right], ["limited-left", PR.left]] as const) {
    assert.equal(testMark(rot(), { [PR.r]: gate, [follow]: "improves" }), "yellow");
    assert.equal(testMark(rot(), { [PR.r]: gate, [follow]: "no-improvement" }), "yellow");
  }
});

test("pelvic rotation: each limitation opens only its own follow-up", () => {
  const fields = screenFields([rot()]);
  const f = (k: string) => fields.find((x) => x.key === k)!;
  assert.equal(isApplicable(f(PR.right), { [PR.r]: "limited-right" }), true);
  assert.equal(isApplicable(f(PR.left), { [PR.r]: "limited-right" }), false);
  assert.equal(isApplicable(f(PR.both), { [PR.r]: "limited-right" }), false);
});

/* ------------------------------------------------------------------ *
 * Ankle Rocking — two movements, each with two branches
 * ------------------------------------------------------------------ */

const rocking = () => SCREEN_TESTS.find((x) => x.key === "ankle-rocking")!;

for (const move of ["eversion", "inversion"] as const) {
  const g = K("ankle-rocking", move);
  const one = K("ankle-rocking", `${move}-held-one`);
  const both = K("ankle-rocking", `${move}-held-both`);
  const other = move === "eversion" ? K("ankle-rocking", "inversion") : K("ankle-rocking", "eversion");
  const clean = { [other]: "good-bilateral" };

  test(`ankle rocking (${move}): holding the knee restores it, so yellow`, () => {
    for (const side of ["limited-right", "limited-left"]) {
      assert.equal(testMark(rocking(), { ...clean, [g]: side, [one]: "fixed" }), "yellow");
      assert.equal(testMark(rocking(), { ...clean, [g]: side, [one]: "still-limited" }), "red");
    }
  });

  test(`ankle rocking (${move}): anything still limited when held is red`, () => {
    assert.equal(testMark(rocking(), { ...clean, [g]: "limited-bilateral", [both]: "normal" }), "yellow");
    for (const still of ["still-right", "still-left", "still-both"])
      assert.equal(testMark(rocking(), { ...clean, [g]: "limited-bilateral", [both]: still }), "red", still);
  });

  test(`ankle rocking (${move}): one limitation opens one branch`, () => {
    const fields = screenFields([rocking()]);
    const f = (k: string) => fields.find((x) => x.key === k)!;
    assert.equal(isApplicable(f(one), { [g]: "limited-right" }), true);
    assert.equal(isApplicable(f(both), { [g]: "limited-right" }), false);
    assert.equal(isApplicable(f(both), { [g]: "limited-bilateral" }), true);
    assert.equal(isApplicable(f(one), { [g]: "limited-bilateral" }), false);
  });
}

test("ankle rocking: good on both movements is green", () => {
  assert.equal(
    testMark(rocking(), {
      [K("ankle-rocking", "eversion")]: "good-bilateral",
      [K("ankle-rocking", "inversion")]: "good-bilateral",
    }),
    "green",
  );
});
