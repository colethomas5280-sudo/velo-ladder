import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenInput } from "@/lib/screenInput";
import {
  SCREEN_GROUPS,
  SIDE_SETS,
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
  fillNormal,
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
      sides: "lr",
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
        parent!.sides,
        s.sides,
        `${t.key}.${s.key} and its parent must be graded on the same sides`,
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

const gated: ScreenTest = {
  key: "gtd", label: "Gated", group: "core",
  subTests: [
    {
      key: "first", label: "First",
      findings: [
        { key: "pass", label: "Pass", normal: true },
        { key: "fail", label: "Fail", severity: "red" },
      ],
    },
    {
      key: "second", label: "Second",
      dependsOn: { subTest: "first", findings: ["pass"] },
      findings: [
        { key: "ok", label: "OK", normal: true, severity: "green" },
        { key: "no", label: "No", severity: "red" },
      ],
    },
  ],
};

test("a gated sub-test is reached only by the answer that opens it", () => {
  const second = screenFields([gated]).find((f) => f.key === "gtd.second")!;
  assert.equal(isApplicable(second, {}), false, "blank parent must not open it");
  assert.equal(isApplicable(second, { "gtd.first": "fail" }), false);
  assert.equal(isApplicable(second, { "gtd.first": "pass" }), true);
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
      sides: "lr",
      findings: [{ key: "yes", label: "Yes", normal: true }, { key: "no", label: "No" }],
    },
    {
      key: "child",
      label: "Child",
      sides: "lr",
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
  assert.equal(screenCounts({ "gtd.first": "fail" }, [gated]).notApplicable, 1);
  assert.equal(screenCounts({ "gtd.first": "pass" }, [gated]).notApplicable, 0);
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
  // The stale answer stays in the row but must not be read back out.
  const results: Results = { "gtd.first": "fail", "gtd.second": "no" };
  assert.deepEqual(
    deviations(results, [gated]).map((d) => d.field.key),
    ["gtd.first"],
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
 * Marking a test normal
 * ------------------------------------------------------------------ */

test("filling normal answers every blank reading of a test", () => {
  const filled = fillNormal({}, [sample]);
  assert.deepEqual(filled, { [SQ.L]: "good", [SQ.R]: "good" });
});

test("filling normal leaves an answer the coach already gave", () => {
  const filled = fillNormal({ [SQ.R]: "bad" }, [sample]);
  assert.equal(filled[SQ.R], "bad", "a recorded deviation must survive");
  assert.equal(filled[SQ.L], "good");
});

/*
 * The reason this repeats. A good wide squat is not the end of the test, it
 * is what earns the arms-down question — so one pass would fill the gate,
 * open a reading, and leave it blank while reporting the test complete.
 */
test("filling normal opens each gate and fills what appears beneath it", () => {
  assert.deepEqual(fillNormal({}, [gated]), { "gtd.first": "pass", "gtd.second": "ok" });
});

/*
 * And the reason it repeats rather than relying on one ordered pass: nothing
 * makes a sub-test appear after the one it depends on. Declared the other way
 * round, a single sweep would look at the branch before its gate was answered,
 * decide it never happened, and leave the test half-filled.
 */
test("filling normal fills a branch declared above its own gate", () => {
  const outOfOrder: ScreenTest = {
    key: "oo", label: "OO", group: "core",
    subTests: [
      { key: "second", label: "Second", dependsOn: { subTest: "first", findings: ["pass"] },
        findings: [{ key: "ok", label: "OK", normal: true }, { key: "no", label: "No" }] },
      { key: "first", label: "First",
        findings: [{ key: "pass", label: "Pass", normal: true }, { key: "fail", label: "Fail" }] },
    ],
  };
  assert.deepEqual(fillNormal({}, [outOfOrder]), { "oo.first": "pass", "oo.second": "ok" });
});

test("filling normal does not answer a branch that stayed shut", () => {
  const filled = fillNormal({ "gtd.first": "fail" }, [gated]);
  assert.equal("gtd.second" in filled, false, "that reading never happened");
});

test("filling normal respects which side opened the branch", () => {
  const filled = fillNormal({ "bt.parent:L": "yes", "bt.parent:R": "no" }, [bilateralDep]);
  assert.equal(filled["bt.child:L"], "ok");
  assert.equal("bt.child:R" in filled, false, "the right leg never earned it");
});

test("filling normal skips a sub-test with no normal answer", () => {
  const noNormal: ScreenTest = {
    key: "nn", label: "NN", group: "core",
    subTests: [
      { key: "q", label: "Q", findings: [
        { key: "a", label: "A", severity: "yellow" },
        { key: "b", label: "B", severity: "red" },
      ] },
    ],
  };
  assert.deepEqual(fillNormal({}, [noNormal]), {}, "nothing here is a pass to assert");
});

test("filling normal leaves diagnostic questions alone", () => {
  const withDiag: ScreenTest = {
    key: "dg", label: "DG", group: "core",
    subTests: [
      { key: "q", label: "Q", findings: [{ key: "good", label: "Good", normal: true }] },
      { key: "why", label: "Why", diagnostic: true,
        findings: [{ key: "held", label: "Held", normal: true }] },
    ],
  };
  assert.deepEqual(fillNormal({}, [withDiag]), { "dg.q": "good" });
});

test("filling normal does not mutate the results it was given", () => {
  const before: Results = {};
  fillNormal(before, [sample]);
  assert.deepEqual(before, {}, "the caller's object must be untouched");
});

/*
 * The whole point of the button, on the real sheet: an athlete who passed
 * everything comes out green everywhere, with no reading left blank and
 * nothing for the coach to hunt for.
 */
test("a screen marked normal throughout grades clean, with nothing left blank", () => {
  const filled = fillNormal({});
  assert.deepEqual(deviations(filled), [], "a clean screen has no deviations");
  assert.deepEqual(alerts(filled), [], "and nothing to flag");
  const counts = screenCounts(filled);
  assert.equal(counts.blank, 0, "every reachable reading is answered");
  assert.equal(counts.deviation, 0);
  for (const t of SCREEN_TESTS)
    assert.equal(testMark(t, filled), "green", `${t.key} should be green`);
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
      key: "s", label: "S", sides: "lr",
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
 * Ankle Rocking and Ankle Rolling
 *
 * The same interview four times over. Asserted for every movement of both
 * tests rather than for one and assumed for the rest — Ankle Rolling was
 * rewritten wholesale and not one test noticed, because it had none.
 * ------------------------------------------------------------------ */

const ANKLE: [string, string[]][] = [
  ["ankle-rocking", ["eversion", "inversion"]],
  ["ankle-rolling", ["lateral", "medial"]],
];

for (const [testKey, moves] of ANKLE) {
  const t = () => SCREEN_TESTS.find((x) => x.key === testKey)!;
  const allGood = Object.fromEntries(moves.map((m) => [K(testKey, m), "good-bilateral"]));

  test(`${testKey}: good on every movement is green`, () => {
    assert.equal(testMark(t(), allGood), "green");
  });

  for (const move of moves) {
    const g = K(testKey, move);
    const one = K(testKey, `${move}-held-one`);
    const both = K(testKey, `${move}-held-both`);

    test(`${testKey} (${move}): holding restores it, so yellow; still limited, red`, () => {
      for (const side of ["limited-right", "limited-left"]) {
        assert.equal(testMark(t(), { ...allGood, [g]: side, [one]: "fixed" }), "yellow", side);
        assert.equal(testMark(t(), { ...allGood, [g]: side, [one]: "still-limited" }), "red", side);
      }
    });

    test(`${testKey} (${move}): bilateral limitation grades on what is left`, () => {
      assert.equal(testMark(t(), { ...allGood, [g]: "limited-bilateral", [both]: "normal" }), "yellow");
      for (const still of ["still-right", "still-left", "still-both"])
        assert.equal(testMark(t(), { ...allGood, [g]: "limited-bilateral", [both]: still }), "red", still);
    });

    test(`${testKey} (${move}): a limitation opens its own branch only`, () => {
      const fields = screenFields([t()]);
      const f = (k: string) => fields.find((x) => x.key === k)!;
      assert.equal(isApplicable(f(one), { [g]: "limited-right" }), true);
      assert.equal(isApplicable(f(both), { [g]: "limited-right" }), false);
      assert.equal(isApplicable(f(both), { [g]: "limited-bilateral" }), true);
      assert.equal(isApplicable(f(one), { [g]: "limited-bilateral" }), false);
    });

    test(`${testKey} (${move}): a limitation with its branch unanswered shows no mark`, () => {
      // It must not inherit the other movement's green.
      assert.equal(testMark(t(), { ...allGood, [g]: "limited-right" }), null);
      assert.equal(testMark(t(), { ...allGood, [g]: "limited-bilateral" }), null);
    });

    test(`${testKey} (${move}): pain flags the test`, () => {
      assert.equal(testMark(t(), { ...allGood, [g]: PAINFUL }), "alert");
    });
  }

  test(`${testKey}: a clean screen asks nothing beyond its two questions`, () => {
    const open = screenFields([t()]).filter((f) => isApplicable(f, allGood));
    assert.deepEqual(open.map((f) => f.subTest.key).sort(), [...moves].sort());
  });

  test(`${testKey}: both movements limited means four questions, not two or six`, () => {
    // One side limited on the first movement, both sides on the second: each
    // opens its own branch and only its own.
    const results: Results = {
      [K(testKey, moves[0])]: "limited-right",
      [K(testKey, moves[1])]: "limited-bilateral",
    };
    const open = screenFields([t()])
      .filter((f) => isApplicable(f, results))
      .map((f) => f.subTest.key)
      .sort();
    assert.deepEqual(open, [
      moves[0],
      `${moves[0]}-held-one`,
      moves[1],
      `${moves[1]}-held-both`,
    ].sort());
  });
}


/* ------------------------------------------------------------------ *
 * Half-Kneeling Narrow Base — pass or fail, no middle
 * ------------------------------------------------------------------ */

const kneel = () => SCREEN_TESTS.find((x) => x.key === "half-kneeling")!;
const KN = K("half-kneeling", "stability");

test("half-kneeling: stable on both sides is the only pass", () => {
  assert.equal(testMark(kneel(), { [KN]: "stable" }), "green");
  for (const fail of ["unstable-right", "unstable-left", "unstable-bilateral", "unable"])
    assert.equal(testMark(kneel(), { [KN]: fail }), "red", fail);
});

test("half-kneeling offers no yellow at all", () => {
  // Deliberate, not an unfilled mapping: one knee, both knees and unable to
  // get into position all grade the same.
  const colours = kneel().subTests.flatMap((s) => s.findings.map((f) => f.severity));
  assert.equal(colours.includes("yellow"), false);
  assert.equal(colours.filter((c) => c === undefined).length, 0, "nothing left ungraded");
});

test("half-kneeling: one question, no branches, pain still flags it", () => {
  assert.equal(screenFields([kneel()]).length, 1);
  assert.equal(kneel().subTests[0].dependsOn, undefined);
  assert.equal(testMark(kneel(), { [KN]: PAINFUL }), "alert");
});

/* ------------------------------------------------------------------ *
 * Sides: left/right, or dominant/non-dominant
 * ------------------------------------------------------------------ */

test("a dominance-graded sub-test stores D and N, not L and R", () => {
  /*
   * Stored in its own vocabulary rather than resolved through the athlete's
   * throwing hand. A screen has to keep meaning what it meant if that hand is
   * later corrected in the profile — otherwise old screens silently swap sides.
   */
  const t: ScreenTest = {
    key: "dom", label: "Dom", group: "posture",
    subTests: [{
      key: "q", label: "Q", sides: "dominance",
      findings: [{ key: "ok", label: "OK", normal: true, severity: "green" }],
    }],
  };
  assert.deepEqual(screenFields([t]).map((f) => f.key), ["dom.q:D", "dom.q:N"]);
  assert.deepEqual(screenFields([t]).map((f) => f.side), ["D", "N"]);
});

test("each side set carries its own labels for the form", () => {
  assert.deepEqual(SIDE_SETS.lr.map((s) => s.label), ["Left", "Right"]);
  assert.deepEqual(SIDE_SETS.dominance.map((s) => s.label), ["Dominant", "Non-dominant"]);
});

test("a dominance branch resolves per side, like a left/right one", () => {
  const t: ScreenTest = {
    key: "db", label: "DB", group: "posture",
    subTests: [
      {
        key: "gate", label: "Gate", sides: "dominance",
        findings: [
          { key: "ok", label: "OK", normal: true, severity: "green" },
          { key: "no", label: "No" },
        ],
      },
      {
        key: "why", label: "Why", sides: "dominance",
        dependsOn: { subTest: "gate", findings: ["no"] },
        findings: [{ key: "bad", label: "Bad", severity: "red" }],
      },
    ],
  };
  const fields = screenFields([t]);
  const why = (side: string) => fields.find((f) => f.key === `db.why:${side}`)!;
  const results = { "db.gate:D": "no", "db.gate:N": "ok" };
  assert.equal(isApplicable(why("D"), results), true, "dominant side failed");
  assert.equal(isApplicable(why("N"), results), false, "non-dominant side was fine");
});

test("every sub-test graded on sides uses a declared side set", () => {
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      if (s.sides) assert.ok(s.sides in SIDE_SETS, `${t.key}.${s.key} has an unknown side set`);
});

/* ------------------------------------------------------------------ *
 * Lunge w/ Extension — two questions, graded dominant and non-dominant
 * ------------------------------------------------------------------ */

const lunge = () => SCREEN_TESTS.find((x) => x.key === "lunge-extension")!;
const LG = {
  sD: K("lunge-extension", "starting-position", "D"),
  sN: K("lunge-extension", "starting-position", "N"),
  eD: K("lunge-extension", "extension", "D"),
  eN: K("lunge-extension", "extension", "N"),
};
const lungeClean = { [LG.sD]: "good", [LG.sN]: "good", [LG.eD]: "good", [LG.eN]: "good" };

test("lunge: starting position grades on each side independently", () => {
  assert.equal(testMark(lunge(), lungeClean), "green");
  for (const side of [LG.sD, LG.sN]) {
    assert.equal(testMark(lunge(), { ...lungeClean, [side]: "limited-stride" }), "yellow", side);
    assert.equal(testMark(lunge(), { ...lungeClean, [side]: "limited-shoulder" }), "yellow", side);
    assert.equal(testMark(lunge(), { ...lungeClean, [side]: "limited-both" }), "red", side);
  }
});

test("lunge: the worse side decides the test", () => {
  assert.equal(
    testMark(lunge(), { ...lungeClean, [LG.sD]: "limited-stride", [LG.sN]: "limited-both" }),
    "red",
  );
});

test("lunge: both questions are asked on both sides, neither gates the other", () => {
  for (const s of lunge().subTests) {
    assert.equal(s.dependsOn, undefined, `${s.key} should not branch`);
    assert.equal(s.sides, "dominance");
  }
  assert.equal(screenFields([lunge()]).length, 4);
});

test("lunge: pain on either side flags the test", () => {
  assert.equal(testMark(lunge(), { ...lungeClean, [LG.sD]: PAINFUL }), "alert");
  assert.equal(testMark(lunge(), { ...lungeClean, [LG.eN]: PAINFUL }), "alert");
});

test("lunge: extension grades on each side, and the worst reading wins", () => {
  for (const side of [LG.eD, LG.eN])
    assert.equal(testMark(lunge(), { ...lungeClean, [side]: "limited" }), "red", side);
  // A clean starting position does not soften a failed extension.
  assert.equal(
    testMark(lunge(), { ...lungeClean, [LG.sD]: "limited-stride", [LG.eN]: "limited" }),
    "red",
  );
});

test("lunge has no findings left ungraded", () => {
  for (const s of lunge().subTests)
    for (const f of s.findings)
      assert.ok(f.severity, `${s.key} -> ${f.label} has no colour`);
});

/* ------------------------------------------------------------------ *
 * Wide Squat — a gate, then a grade, graded once
 * ------------------------------------------------------------------ */

const squat = () => SCREEN_TESTS.find((x) => x.key === "wide-squat")!;
const WS = { front: K("wide-squat", "arms-front"), down: K("wide-squat", "arms-down") };

test("wide squat: a limited squat fails outright and ends the test", () => {
  assert.equal(testMark(squat(), { [WS.front]: "limited" }), "red");
  const down = screenFields([squat()]).find((f) => f.key === WS.down)!;
  assert.equal(isApplicable(down, { [WS.front]: "limited" }), false);
});

test("wide squat: a good squat earns the second question, not a green", () => {
  // The gate carries no colour of its own — lowering the arms decides it.
  assert.equal(testMark(squat(), { [WS.front]: "good" }), null, "not green yet");
  assert.equal(testMark(squat(), { [WS.front]: "good", [WS.down]: "maintained" }), "green");
  assert.equal(testMark(squat(), { [WS.front]: "good", [WS.down]: "lost" }), "red");
});

test("wide squat offers no yellow, and is graded once", () => {
  const colours = squat().subTests.flatMap((s) => s.findings.map((f) => f.severity));
  assert.equal(colours.includes("yellow"), false);
  assert.equal(screenFields([squat()]).length, 2, "one reading each, no sides");
  for (const s of squat().subTests) assert.equal(s.sides, undefined);
});

test("wide squat: pain flags it at either question", () => {
  assert.equal(testMark(squat(), { [WS.front]: PAINFUL }), "alert");
  assert.equal(testMark(squat(), { [WS.front]: "good", [WS.down]: PAINFUL }), "alert");
});

/* ------------------------------------------------------------------ *
 * Shoulder 90/90 — one reading per shoulder
 * ------------------------------------------------------------------ */

const shoulder = () => SCREEN_TESTS.find((x) => x.key === "shoulder-90-90")!;
const SH = { L: K("shoulder-90-90", "external-rotation", "L"), R: K("shoulder-90-90", "external-rotation", "R") };

test("shoulder 90/90: each finding carries its own colour", () => {
  assert.equal(testMark(shoulder(), { [SH.L]: "greater", [SH.R]: "greater" }), "green");
  assert.equal(testMark(shoulder(), { [SH.L]: "equal", [SH.R]: "equal" }), "yellow");
  assert.equal(testMark(shoulder(), { [SH.L]: "less", [SH.R]: "less" }), "red");
});

test("shoulder 90/90: the worse shoulder decides the test, either side", () => {
  assert.equal(testMark(shoulder(), { [SH.L]: "greater", [SH.R]: "equal" }), "yellow");
  assert.equal(testMark(shoulder(), { [SH.R]: "greater", [SH.L]: "equal" }), "yellow");
  assert.equal(testMark(shoulder(), { [SH.L]: "greater", [SH.R]: "less" }), "red");
  assert.equal(testMark(shoulder(), { [SH.R]: "greater", [SH.L]: "less" }), "red");
});

test("shoulder 90/90: pain on either shoulder flags it, and nothing branches", () => {
  assert.equal(testMark(shoulder(), { [SH.L]: "greater", [SH.R]: PAINFUL }), "alert");
  assert.equal(shoulder().subTests[0].dependsOn, undefined);
  assert.equal(screenFields([shoulder()]).length, 2);
});

/* ------------------------------------------------------------------ *
 * Windshield Wiper — one movement, two positions, both shoulders
 * ------------------------------------------------------------------ */

const wiper = () => SCREEN_TESTS.find((x) => x.key === "windshield-wiper")!;
const WW = {
  fL: K("windshield-wiper", "arm-front", "L"),
  fR: K("windshield-wiper", "arm-front", "R"),
  sL: K("windshield-wiper", "arm-side", "L"),
  sR: K("windshield-wiper", "arm-side", "R"),
};
const wiperClean = Object.fromEntries(Object.values(WW).map((k) => [k, "gte-90"]));

test("windshield wiper: four clean readings is green", () => {
  assert.equal(testMark(wiper(), wiperClean), "green");
  assert.equal(screenFields([wiper()]).length, 4);
});

test("windshield wiper: any reading under 90 turns the test red", () => {
  // Asserted for all four, not one and assumed for the rest.
  for (const key of Object.values(WW))
    assert.equal(testMark(wiper(), { ...wiperClean, [key]: "lt-90" }), "red", key);
});

test("windshield wiper offers no yellow, and neither position gates the other", () => {
  const colours = wiper().subTests.flatMap((s) => s.findings.map((f) => f.severity));
  assert.equal(colours.includes("yellow"), false);
  for (const s of wiper().subTests) assert.equal(s.dependsOn, undefined);
});

test("windshield wiper: pain at any of the four readings flags it", () => {
  for (const key of Object.values(WW))
    assert.equal(testMark(wiper(), { ...wiperClean, [key]: PAINFUL }), "alert", key);
});

/* ------------------------------------------------------------------ *
 * The config is complete
 * ------------------------------------------------------------------ */

test("every finding is graded, or defers to a branch that grades it", () => {
  /*
   * All seventeen tests now come from the app rather than the 2019 sheet, so
   * an uncoloured finding is a mistake rather than a gap. The exception is a
   * gate: "good squat" and "limited without assistance" carry no colour
   * because the question they open supplies one.
   */
  const ungraded: string[] = [];
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      for (const f of s.findings) {
        if (f.severity || f.alert) continue;
        const defers = t.subTests.some(
          (x) => x.dependsOn?.subTest === s.key && x.dependsOn.findings.includes(f.key),
        );
        if (!defers) ungraded.push(`${t.key}.${s.key} -> ${f.label}`);
      }
  assert.deepEqual(ungraded, []);
});

test("every gate leads somewhere, and every branch has a gate", () => {
  for (const t of SCREEN_TESTS) {
    for (const s of t.subTests) {
      if (!s.dependsOn) continue;
      const parent = t.subTests.find((x) => x.key === s.dependsOn!.subTest);
      assert.ok(parent, `${t.key}.${s.key} branches off nothing`);
    }
    // A finding with no colour must open something, or it grades nothing.
    for (const s of t.subTests)
      for (const f of s.findings)
        if (!f.severity && !f.alert)
          assert.ok(
            t.subTests.some(
              (x) => x.dependsOn?.subTest === s.key && x.dependsOn.findings.includes(f.key),
            ),
            `${t.key}.${s.key} -> ${f.label} carries no colour and opens nothing`,
          );
  }
});
