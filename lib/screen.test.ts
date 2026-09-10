import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenInput } from "@/lib/screenInput";
import { PHASES } from "@/lib/profile";
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
  screenReport,
  screenSummary,
  asymmetries,
  asymmetryReport,
  sessionsOn,
  statusRank,
  retestPlan,
  clocksFor,
  spotSince,
  needsScreening,
  rescreenStanding,
  IN_SEASON,
  leadClock,
  dueRank,
  RETEST_CADENCE,
  standingScreen,
  covers,
  isFullScreen,
  fillNormal,
  testMark,
  alerts,
  visibleScreen,
  type Results,
  type Finding,
  type ScreenTest,
  type ReportStatus,
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

/*
 * Ten of the sixteen had no procedure text at all, which was fine while Cole
 * was the only person running the sheet and stopped being fine the moment it
 * wasn't. A test whose setup lives only in someone's head is a test that gets
 * run differently in six months.
 */
/*
 * A video link is optional, but a broken one is worse than none — an athlete
 * who taps it and lands nowhere stops tapping the rest.
 */
test("a linked video is a real, secure, absolute URL", () => {
  for (const t of SCREEN_TESTS) {
    if (!t.video) continue;
    assert.match(t.video, /^https:\/\/\S+$/, `${t.key}: not an https URL`);
    assert.doesNotThrow(() => new URL(t.video!), `${t.key}: not a parseable URL`);
  }
});

/*
 * Share links arrive carrying YouTube's ?si= token, which identifies who did
 * the sharing rather than what is being shared. The video id is the whole
 * address, so it comes off — no sense handing every athlete a tracking
 * parameter to follow a coaching video.
 */
test("no video link carries a tracking parameter", () => {
  for (const t of SCREEN_TESTS) {
    if (!t.video) continue;
    assert.equal(new URL(t.video).search, "", `${t.key}: ${t.video} has a query string`);
  }
});

/*
 * Sixteen of sixteen. Pinned as a count so a test added later has to be given
 * one or deliberately exempted, rather than quietly joining without.
 */
test("every test has a demonstration to watch", () => {
  const missing = SCREEN_TESTS.filter((t) => !t.video).map((t) => t.key);
  assert.deepEqual(missing, []);
});

test("no two tests point at the same video", () => {
  const links = SCREEN_TESTS.filter((t) => t.video).map((t) => t.video);
  assert.equal(new Set(links).size, links.length, "a link was pasted onto the wrong test");
});

test("every test says how to run it", () => {
  const silent = SCREEN_TESTS.filter((t) => !t.subTests.some((s) => s.help));
  assert.deepEqual(silent.map((t) => t.key), []);
});

test("the questions that carry help are the ones a coach acts on", () => {
  // Gates and follow-ups need it; a diagnostic note doesn't describe a movement.
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      if (s.help)
        assert.ok(s.help.length > 40, `${t.key}.${s.key}: help too thin to be worth reading`);
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
    "push-off",
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

/*
 * Push-Off is ONE test. It used to be two, one per surface, and an athlete
 * only ever does one of them — so the other stayed permanently unscreened,
 * which meant no real screen could ever be complete and the quarterly clock
 * could never start for anybody.
 */
test("push-off is a single test, so a real screen can be complete", () => {
  assert.deepEqual(
    SCREEN_TESTS.filter((t) => t.key.startsWith("push-off")).map((t) => t.key),
    ["push-off"],
  );
  assert.equal(isFullScreen(fillNormal({})), true);
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
  /*
   * One blank, on purpose: where the push-off was run is context nothing can
   * guess, so marking a test normal deliberately leaves it for the coach.
   */
  assert.equal(counts.blank, 1);
  const blanks = screenFields()
    .filter((f) => !filled[f.key] && isApplicable(f, filled))
    .map((f) => f.key);
  assert.deepEqual(blanks, ["push-off.surface"]);
  assert.equal(counts.deviation, 0);
  for (const t of SCREEN_TESTS)
    assert.equal(testMark(t, filled), "green", `${t.key} should be green`);
});

/* ------------------------------------------------------------------ *
 * Re-screening: cleared vs never looked at
 * ------------------------------------------------------------------ */

test("a deviation re-screened clean is resolved", () => {
  const c = compareScreens({ [SQ.L]: "bad" }, { [SQ.L]: "good" }, [sample]);
  assert.equal(c.resolved.length, 1);
  assert.equal(c.unchecked.length, 0);
});

/*
 * The lie a re-screen must not tell. Nobody looked at that leg this time, and
 * reporting it as fixed hands the athlete a win he hasn't been given.
 */
test("a deviation nobody re-screened is unchecked, not resolved", () => {
  const c = compareScreens({ [SQ.L]: "bad" }, {}, [sample]);
  assert.equal(c.resolved.length, 0, "nothing was observed");
  assert.equal(c.unchecked.length, 1);
  assert.equal(c.unchecked[0].finding.key, "bad", "it keeps what it last said");
});

test("a deviation skipped on purpose is unchecked too", () => {
  const c = compareScreens({ [SQ.L]: "bad" }, { [SQ.L]: NOT_TESTED }, [sample]);
  assert.equal(c.unchecked.length, 1);
  assert.equal(c.resolved.length, 0);
});

/*
 * The exception. A follow-up exists only because the gate above it came up
 * limited, so a gate that screens clean retires the question outright — that
 * is cleared, not unchecked, even though nobody answered the follow-up.
 */
test("a deviation whose branch closed is resolved", () => {
  const before: Results = { "pt.tilt": "cannot-arch", "pt.quality-limited": "shake" };
  const after: Results = { "pt.tilt": "both", "pt.quality-able": "smooth" };
  const c = compareScreens(before, after, [branching]);
  assert.deepEqual(
    c.resolved.map((d) => d.field.key).sort(),
    ["pt.quality-limited", "pt.tilt"],
    "the gate cleared, and the question under it stopped applying",
  );
  assert.equal(c.unchecked.length, 0, "nothing here went unlooked-at");
});

/* ------------------------------------------------------------------ *
 * The report the panel renders
 * ------------------------------------------------------------------ */

test("the report leads with the worst test, not the first one", () => {
  const r = screenReport(
    { [SQ.L]: "mid", [SQ.R]: "good", "gtd.first": "fail" },
    null,
    [sample, gated],
  );
  assert.equal(r[0].test.key, "gtd", "red outranks yellow regardless of order");
  assert.equal(r[0].status, "red");
  assert.equal(r[1].status, "yellow");
});

test("tests of equal standing keep the order they are screened in", () => {
  // Both red, so only the tiebreak can decide — otherwise this asserts nothing.
  const results: Results = { [SQ.L]: "bad", "gtd.first": "fail" };
  assert.deepEqual(
    screenReport(results, null, [sample, gated]).map((x) => x.test.key),
    ["smp", "gtd"],
  );
  assert.deepEqual(
    screenReport(results, null, [gated, sample]).map((x) => x.test.key),
    ["gtd", "smp"],
    "the tiebreak follows the sheet, not the alphabet or the id",
  );
});

test("a test nobody ran sinks below a clean one", () => {
  const r = screenReport({ "gtd.first": "pass", "gtd.second": "ok" }, null, [
    sample,
    gated,
  ]);
  assert.equal(r[0].test.key, "gtd");
  assert.equal(r[0].status, "clean");
  assert.equal(r[1].status, "skipped", "nothing recorded is not the same as passing");
});

test("a test skipped on purpose still reads as skipped", () => {
  const r = screenReport({ [SQ.L]: NOT_TESTED, [SQ.R]: NOT_TESTED }, null, [sample]);
  assert.equal(r[0].status, "skipped");
  assert.equal(r[0].recorded, 2, "the skip itself was recorded");
});

test("a deviation with no colour yet is ungraded, not clean", () => {
  const uncoloured: ScreenTest = {
    key: "uc", label: "UC", group: "core",
    subTests: [
      { key: "q", label: "Q", findings: [
        { key: "good", label: "Good", normal: true },
        { key: "off", label: "Off" },
      ] },
    ],
  };
  const r = screenReport({ "uc.q": "off" }, null, [uncoloured]);
  assert.equal(r[0].status, "ungraded");
  assert.equal(r[0].mark, null, "and it still shows no mark");
  assert.equal(r[0].work.length, 1, "but the work is on the list");
});

test("the work list holds deviations only", () => {
  const r = screenReport({ [SQ.L]: "bad", [SQ.R]: "good" }, null, [sample]);
  assert.deepEqual(
    r[0].work.map((w) => w.field.key),
    [SQ.L],
  );
});

test("counts say how much of the test was actually recorded", () => {
  const r = screenReport({ [SQ.L]: "good" }, null, [sample]);
  assert.equal(r[0].recorded, 1);
  assert.equal(r[0].asked, 2, "the other side was asked and left blank");
});

test("with no previous screen nothing claims a direction", () => {
  const r = screenReport({ [SQ.L]: "bad" }, null, [sample]);
  assert.equal(r[0].work[0].trend, null);
  assert.equal(r[0].work[0].before, undefined);
});

test("a reading that got better, worse, or stayed put is named as such", () => {
  const trend = (before: string, after: string) =>
    screenReport({ [SQ.L]: after }, { [SQ.L]: before }, [sample])[0].work[0].trend;
  assert.equal(trend("bad", "mid"), "improved");
  assert.equal(trend("mid", "bad"), "worsened");
  assert.equal(trend("mid", "mid"), "unchanged");
});

test("a deviation that wasn't there last screen is new", () => {
  const r = screenReport({ [SQ.L]: "bad" }, { [SQ.L]: "good" }, [sample]);
  assert.equal(r[0].work[0].trend, "new");
});

/*
 * Two findings that carry no colour have no order between them, so the move
 * is reported as a change and nothing more. Calling it an improvement would
 * be inventing a direction the mapping never supplied.
 */
test("a move the scale can't rank is a change, not progress", () => {
  const uncoloured: ScreenTest = {
    key: "uc", label: "UC", group: "core",
    subTests: [
      { key: "q", label: "Q", findings: [
        { key: "good", label: "Good", normal: true },
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ] },
    ],
  };
  const r = screenReport({ "uc.q": "b" }, { "uc.q": "a" }, [uncoloured]);
  assert.equal(r[0].work[0].trend, "changed");
  assert.equal(r[0].work[0].before?.key, "a", "and it keeps what it moved from");
});

/*
 * And the half-ranked case, which is the one that bites: an ungraded finding
 * compares as less than every colour, so a reading moving from "no colour
 * yet" to RED reports as an improvement unless the missing rank is caught.
 */
test("a move onto the scale from nowhere is a change, not an improvement", () => {
  const half: ScreenTest = {
    key: "hf", label: "HF", group: "core",
    subTests: [
      { key: "q", label: "Q", findings: [
        { key: "good", label: "Good", normal: true, severity: "green" },
        { key: "plain", label: "Plain" },
        { key: "bad", label: "Bad", severity: "red" },
      ] },
    ],
  };
  assert.equal(
    screenReport({ "hf.q": "bad" }, { "hf.q": "plain" }, [half])[0].work[0].trend,
    "changed",
  );
  assert.equal(
    screenReport({ "hf.q": "plain" }, { "hf.q": "bad" }, [half])[0].work[0].trend,
    "changed",
    "and it doesn't read as progress in the other direction either",
  );
});

test("cleared and unchecked land on the test they belong to", () => {
  const r = screenReport(
    { [SQ.L]: "good", "gtd.first": "pass", "gtd.second": "ok" },
    { [SQ.L]: "bad", [SQ.R]: "bad", "gtd.first": "fail" },
    [sample, gated],
  );
  const smp = r.find((x) => x.test.key === "smp")!;
  const gtd = r.find((x) => x.test.key === "gtd")!;
  assert.deepEqual(smp.cleared.map((d) => d.field.key), [SQ.L]);
  assert.deepEqual(smp.unchecked.map((d) => d.field.key), [SQ.R]);
  assert.deepEqual(gtd.cleared.map((d) => d.field.key), ["gtd.first"]);
  assert.equal(gtd.unchecked.length, 0);
});

/*
 * On the real sheet: an athlete who passed everything gets a panel with no
 * work on it at all, and seventeen tests that say so.
 */
test("a clean screen produces a report with nothing to work on", () => {
  const r = screenReport(fillNormal({}));
  assert.equal(r.length, SCREEN_TESTS.length);
  assert.deepEqual(
    r.filter((x) => x.status !== "clean").map((x) => x.test.key),
    [],
  );
  assert.equal(r.reduce((n, x) => n + x.work.length, 0), 0);
});

test("an unrecorded screen is seventeen skipped tests, not seventeen passes", () => {
  const r = screenReport({});
  assert.deepEqual(
    r.filter((x) => x.status !== "skipped").map((x) => x.test.key),
    [],
  );
});

/* ------------------------------------------------------------------ *
 * One screen as a line on a roster
 * ------------------------------------------------------------------ */

test("a summary's worst is the head of the report, not a second opinion", () => {
  const results: Results = { [SQ.L]: "mid", [SQ.R]: "good", "gtd.first": "fail" };
  const report = screenReport(results, null, [sample, gated]);
  const summary = screenSummary(results, [sample, gated]);
  assert.equal(summary.worst, report[0].status, "the row and the panel must agree");
  assert.equal(summary.worst, "red");
});

test("a summary counts the tests with work on them, and names them", () => {
  const s = screenSummary({ [SQ.L]: "mid", "gtd.first": "fail" }, [sample, gated]);
  assert.equal(s.work, 2);
  assert.equal(s.clean, 0);
  // Named so the roster can date each one without rebuilding the report,
  // and in the report's order, so the worst is first here too.
  assert.deepEqual(s.failing, ["gtd", "smp"]);
});

test("a clean summary names nothing as failing", () => {
  assert.deepEqual(screenSummary(fillNormal({})).failing, []);
});

test("a clean screen summarises as clean, with nothing to work on", () => {
  const s = screenSummary(fillNormal({}));
  assert.equal(s.worst, "clean");
  assert.equal(s.work, 0);
  assert.equal(s.painful, 0);
  assert.equal(s.clean, SCREEN_TESTS.length);
});

test("an athlete nobody has screened summarises as skipped, not clean", () => {
  const s = screenSummary({});
  assert.equal(s.worst, "skipped", "no data is not a pass");
  assert.equal(s.clean, 0);
  assert.equal(s.skipped, SCREEN_TESTS.length);
  // Seventeen tests nobody ran is seventeen unknowns, not seventeen jobs.
  assert.equal(s.work, 0, "an unscreened athlete has no work list, only no data");
});

/*
 * Reachable only through a caller passing its own tests, which nothing does
 * today — pinned so the fallback stays honest rather than becoming a "clean"
 * that nobody notices.
 */
test("a summary of no tests at all is skipped, not clean", () => {
  assert.equal(screenSummary({}, []).worst, "skipped");
});

/* Pain outranks every colour on a roster the same way it does on a test. */
test("a painful reading takes the summary whatever else is on the screen", () => {
  const results = fillNormal({});
  results["hip-45.45-degree-angle:R"] = "less";
  assert.equal(screenSummary(results).worst, "red");
  results["toe-tap.hip-ir:L"] = PAINFUL;
  const s = screenSummary(results);
  assert.equal(s.worst, "alert");
  assert.equal(s.painful, 1);
});

test("statuses sort worst first, and skipped sits below clean", () => {
  const order: ReportStatus[] = ["skipped", "clean", "ungraded", "yellow", "red", "alert"];
  const ranked = [...order].sort((a, b) => statusRank(b) - statusRank(a));
  assert.deepEqual(ranked, ["alert", "red", "yellow", "ungraded", "clean", "skipped"]);
});

/* ------------------------------------------------------------------ *
 * Screen when fresh
 * ------------------------------------------------------------------ */

test("sessions on the screen's own day are the ones that matter", () => {
  const sessions = [
    { date: "2026-09-08", type: "mound" },
    { date: "2026-09-10", type: "mound" },
    { date: "2026-09-10", type: "pulldown" },
    { date: "2026-09-11", type: "mound" },
  ];
  assert.equal(sessionsOn(sessions, "2026-09-10").length, 2);
  assert.deepEqual(
    sessionsOn(sessions, "2026-09-10").map((s) => s.type),
    ["mound", "pulldown"],
  );
});

test("a day with nothing logged raises nothing", () => {
  assert.deepEqual(sessionsOn([{ date: "2026-09-08" }], "2026-09-10"), []);
  assert.deepEqual(sessionsOn([], "2026-09-10"), []);
});

/*
 * Deliberately same-day only. The app stores the day a session was logged,
 * not the hour, so the neighbouring days are a guess — and a warning that
 * fires on a screen taken two mornings later teaches the coach to dismiss it.
 */
test("the day either side is not the screen's day", () => {
  const sessions = [{ date: "2026-09-09" }, { date: "2026-09-11" }];
  assert.deepEqual(sessionsOn(sessions, "2026-09-10"), []);
});

/* ------------------------------------------------------------------ *
 * Side to side
 * ------------------------------------------------------------------ */

test("two sides that agree are not an asymmetry", () => {
  assert.deepEqual(asymmetries({ [SQ.L]: "good", [SQ.R]: "good" }, [sample]), []);
});

test("two sides that disagree are, and the worse one is named", () => {
  const [a] = asymmetries({ [SQ.L]: "good", [SQ.R]: "bad" }, [sample]);
  assert.equal(a.gap, 2, "green to red is two steps");
  assert.equal(a.worseSide, "R");
  assert.deepEqual(a.sides.map((s) => s.label), ["Left", "Right"]);
});

/*
 * The reason this exists at all. Two yellows and a green-plus-red both roll
 * up to yellow, and they are not the same athlete.
 */
test("a gap is visible where the roll-up shows none", () => {
  const evenly: Results = { [SQ.L]: "mid", [SQ.R]: "mid" };
  const lopsided: Results = { [SQ.L]: "good", [SQ.R]: "bad" };
  assert.equal(testMark(sample, evenly), "yellow");
  assert.equal(testMark(sample, lopsided), "red");
  assert.equal(asymmetries(evenly, [sample]).length, 0);
  assert.equal(asymmetries(lopsided, [sample]).length, 1);
});

/*
 * Asserts the outcome, not the guard that produces it: a lone reading is also
 * caught by the equality check, so the explicit length guard above it cannot
 * be reached and no mutation of it can fail this.
 */
test("one side unrecorded is neither symmetric nor asymmetric", () => {
  assert.deepEqual(asymmetries({ [SQ.L]: "bad" }, [sample]), [], "nothing to compare");
  assert.deepEqual(asymmetries({ [SQ.L]: "bad", [SQ.R]: NOT_TESTED }, [sample]), []);
});

test("a test graded once is never an asymmetry", () => {
  assert.deepEqual(asymmetries({ "gtd.first": "fail" }, [gated]), []);
});

test("a side that never happened isn't compared", () => {
  // Only the left leg qualified for the follow-up, so it has no counterpart.
  const results: Results = {
    "bt.parent:L": "yes",
    "bt.parent:R": "no",
    "bt.child:L": "bad",
  };
  const keys = asymmetries(results, [bilateralDep]).map((a) => a.subTest.key);
  assert.deepEqual(keys, ["parent"], "the parents differ; the child has no pair");
});

/*
 * Two answers that share a colour are still two answers. Flattening them to
 * "both yellow" is exactly the roll-up mistake this is here to avoid.
 */
test("sides that differ inside one colour are still an asymmetry", () => {
  const twoYellows: ScreenTest = {
    key: "ty", label: "TY", group: "core",
    subTests: [
      { key: "q", label: "Q", sides: "lr", findings: [
        { key: "good", label: "Good", normal: true, severity: "green" },
        { key: "a", label: "A", severity: "yellow" },
        { key: "b", label: "B", severity: "yellow" },
      ] },
    ],
  };
  const [a] = asymmetries({ "ty.q:L": "a", "ty.q:R": "b" }, [twoYellows]);
  assert.ok(a, "different findings, same colour");
  assert.equal(a.gap, 0, "no distance on the scale");
  assert.equal(a.worseSide, null, "and so neither side is worse");
});

test("dominance-graded tests are read side to side like any other", () => {
  const results: Results = {
    "lunge-extension.extension:D": "good",
    "lunge-extension.extension:N": "limited",
  };
  const [a] = asymmetries(results, SCREEN_TESTS);
  assert.deepEqual(a.sides.map((s) => s.label), ["Dominant", "Non-dominant"]);
  assert.equal(a.worseSide, "N");
});

test("with no previous screen a gap claims no direction", () => {
  const r = asymmetryReport({ [SQ.L]: "good", [SQ.R]: "bad" }, null, [sample]);
  assert.equal(r.standing[0].trend, null);
  assert.deepEqual(r.closed, []);
});

test("a gap that narrows, widens, or holds is named as such", () => {
  const trend = (before: [string, string], after: [string, string]) =>
    asymmetryReport(
      { [SQ.L]: after[0], [SQ.R]: after[1] },
      { [SQ.L]: before[0], [SQ.R]: before[1] },
      [sample],
    ).standing[0].trend;
  assert.equal(trend(["good", "bad"], ["good", "mid"]), "narrowed");
  assert.equal(trend(["good", "mid"], ["good", "bad"]), "widened");
  assert.equal(trend(["good", "bad"], ["good", "bad"]), "unchanged");
});

/*
 * The gap is the same two steps wide either way, but which side is weak has
 * flipped. Reporting that as unchanged is how it goes unnoticed.
 */
test("a gap the same width on the other side is a change, not a hold", () => {
  const r = asymmetryReport(
    { [SQ.L]: "bad", [SQ.R]: "good" },
    { [SQ.L]: "good", [SQ.R]: "bad" },
    [sample],
  );
  assert.equal(r.standing[0].trend, "changed");
  assert.equal(r.standing[0].beforeGap, 2, "and it was two steps before too");
});

test("a gap that wasn't there last time is new", () => {
  const r = asymmetryReport(
    { [SQ.L]: "good", [SQ.R]: "bad" },
    { [SQ.L]: "good", [SQ.R]: "good" },
    [sample],
  );
  assert.equal(r.standing[0].trend, "new");
});

/*
 * The payoff, and it drops off the standing list the moment it happens — a
 * closed gap is not an asymmetry any more. Reported separately or not at all.
 */
test("a gap that closed is reported, not silently dropped", () => {
  const r = asymmetryReport(
    { [SQ.L]: "good", [SQ.R]: "good" },
    { [SQ.L]: "good", [SQ.R]: "bad" },
    [sample],
  );
  assert.deepEqual(r.standing, [], "nothing stands");
  assert.equal(r.closed.length, 1, "but the athlete should still be told");
  assert.equal(r.closed[0].worseSide, "R", "and which side it was");
});

/* ------------------------------------------------------------------ *
 * The arm tests: symmetry is nice to have, not required
 * ------------------------------------------------------------------ */

test("exactly the three arm tests are marked throwing-arm-led", () => {
  assert.deepEqual(
    SCREEN_TESTS.filter((t) => t.throwingArmOnly).map((t) => t.key),
    ["shoulder-90-90", "windshield-wiper", "forearm-80-80"],
  );
});

/* What throws the baseball is the throwing arm. */
test("a weaker non-throwing shoulder is reported but not chased", () => {
  const results: Results = {
    "shoulder-90-90.external-rotation:L": "less",
    "shoulder-90-90.external-rotation:R": "greater",
  };
  const [a] = asymmetries(results, SCREEN_TESTS, "R");
  assert.equal(a.worseSide, "L", "the left is the weaker one");
  assert.equal(a.optional, true, "and a right-hander doesn't throw with it");
});

test("a weaker throwing shoulder is the same problem it always was", () => {
  const results: Results = {
    "shoulder-90-90.external-rotation:L": "greater",
    "shoulder-90-90.external-rotation:R": "less",
  };
  assert.equal(asymmetries(results, SCREEN_TESTS, "R")[0].optional, false);
});

test("the caveat follows the hand, not the side", () => {
  const results: Results = {
    "forearm-80-80.pronation:L": "lt-80",
    "forearm-80-80.pronation:R": "gte-80",
  };
  assert.equal(asymmetries(results, SCREEN_TESTS, "R")[0].optional, true);
  assert.equal(asymmetries(results, SCREEN_TESTS, "L")[0].optional, false);
});

/* A guess about which arm is which is worse than no caveat at all. */
test("with no throwing hand on file, nothing is waived", () => {
  const results: Results = {
    "windshield-wiper.arm-side:L": "lt-90",
    "windshield-wiper.arm-side:R": "gte-90",
  };
  assert.equal(asymmetries(results, SCREEN_TESTS)[0].optional, false);
  assert.equal(asymmetries(results, SCREEN_TESTS, null)[0].optional, false);
});

test("the caveat is only for the arm tests, not every sided one", () => {
  const results: Results = {
    "hip-45.45-degree-angle:L": "less",
    "hip-45.45-degree-angle:R": "greater",
  };
  assert.equal(
    asymmetries(results, SCREEN_TESTS, "R")[0].optional,
    false,
    "a hip is a hip whichever way they throw",
  );
});

test("a roster counts the gaps worth chasing, and the rest separately", () => {
  const results: Results = {
    "shoulder-90-90.external-rotation:L": "less",
    "shoulder-90-90.external-rotation:R": "greater",
    "hip-45.45-degree-angle:L": "less",
    "hip-45.45-degree-angle:R": "greater",
  };
  const s = screenSummary(results, SCREEN_TESTS, "R");
  assert.equal(s.asymmetries, 1, "the hip");
  assert.equal(s.optionalAsymmetries, 1, "the non-throwing shoulder");
});

test("a summary counts the gaps alongside the failures", () => {
  const s = screenSummary({ [SQ.L]: "good", [SQ.R]: "bad" }, [sample]);
  assert.equal(s.asymmetries, 1);
  assert.equal(screenSummary(fillNormal({})).asymmetries, 0, "a clean screen is level");
});

/* ------------------------------------------------------------------ *
 * The standing picture
 * ------------------------------------------------------------------ */

const screen = (date: string, results: Results) => ({ date, results });

test("a test nobody looked at is not covered, however much else was recorded", () => {
  assert.equal(covers({ [SQ.L]: "good", [SQ.R]: "good" }, sample), true);
  assert.equal(covers({ "gtd.first": "pass" }, sample), false);
});

/* The coach saying "skipped" is the opposite of the coach having looked. */
test("not-tested is not coverage", () => {
  assert.equal(covers({ [SQ.L]: NOT_TESTED, [SQ.R]: NOT_TESTED }, sample), false);
});

test("a full screen is one that looked at every test", () => {
  const both: Results = { [SQ.L]: "good", [SQ.R]: "good", "gtd.first": "pass", "gtd.second": "ok" };
  assert.equal(isFullScreen(both, [sample, gated]), true);
  assert.equal(isFullScreen({ [SQ.L]: "good" }, [sample, gated]), false, "gated untouched");
});

test("one screen stands on its own", () => {
  const st = standingScreen([screen("2026-01-01", { [SQ.L]: "bad" })], [sample]);
  assert.equal(st.results[SQ.L], "bad");
  assert.equal(st.from["smp"], "2026-01-01");
  assert.equal(st.last, "2026-01-01");
});

/*
 * The reason any of this exists. A spot-check of one test must not erase the
 * others — they were not looked at, which is not the same as not true.
 */
test("a spot-check leaves the tests it didn't touch standing", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", { [SQ.L]: "good", [SQ.R]: "good", "gtd.first": "fail" }),
      screen("2026-02-01", { "gtd.first": "pass", "gtd.second": "ok" }),
    ],
    [sample, gated],
  );
  assert.equal(st.results[SQ.L], "good", "January's sample reading still stands");
  assert.equal(st.results["gtd.first"], "pass", "February's gated reading replaced it");
  assert.equal(st.from["smp"], "2026-01-01");
  assert.equal(st.from["gtd"], "2026-02-01");
});

test("the newest reading of a test wins, whatever order the screens arrive in", () => {
  const rows = [
    screen("2026-03-01", { [SQ.L]: "good" }),
    screen("2026-01-01", { [SQ.L]: "bad" }),
  ];
  assert.equal(standingScreen(rows, [sample]).results[SQ.L], "good");
  assert.equal(standingScreen([...rows].reverse(), [sample]).results[SQ.L], "good");
});

test("a retested test remembers what it said before", () => {
  const st = standingScreen(
    [screen("2026-01-01", { [SQ.L]: "bad" }), screen("2026-02-01", { [SQ.L]: "mid" })],
    [sample],
  );
  assert.equal(st.results[SQ.L], "mid");
  assert.equal(st.previous[SQ.L], "bad");
  assert.equal(st.previousFrom["smp"], "2026-01-01");
});

/*
 * A spot-check is not the previous reading of a test it didn't cover. Taking
 * "the screen before this one" would compare a hip against an ankle.
 */
test("a test's previous reading is its own, not whatever screen came before", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", { [SQ.L]: "bad", "gtd.first": "fail" }),
      screen("2026-02-01", { "gtd.first": "pass", "gtd.second": "ok" }),
      screen("2026-03-01", { [SQ.L]: "good" }),
    ],
    [sample, gated],
  );
  assert.equal(st.previous[SQ.L], "bad", "March compares against January, not February");
  assert.equal(st.previousFrom["smp"], "2026-01-01");
});

test("a screen that skipped a test doesn't count as its last full look", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", { [SQ.L]: "good", [SQ.R]: "good", "gtd.first": "pass", "gtd.second": "ok" }),
      screen("2026-02-01", { [SQ.L]: "bad" }),
    ],
    [sample, gated],
  );
  assert.equal(st.lastFull, "2026-01-01");
  assert.equal(st.last, "2026-02-01", "but it was still the last screen");
});

test("no screens at all leaves everything null, not empty-but-clean", () => {
  const st = standingScreen([], [sample]);
  assert.equal(st.last, null);
  assert.equal(st.lastFull, null);
  assert.deepEqual(st.results, {});
});

/* ------------------------------------------------------------------ *
 * When to screen again
 * ------------------------------------------------------------------ */

const FULL: Results = { [SQ.L]: "good", [SQ.R]: "good", "gtd.first": "pass", "gtd.second": "ok" };
const BAD: Results = { ...FULL, [SQ.L]: "bad" };
const PAIR = [sample, gated];

/*
 * Both intervals are whole weeks, because the roster prints them as weeks by
 * dividing by seven. Thirty days would render as "4.285714 weeks".
 */
test("the cadences divide into whole weeks", () => {
  for (const [kind, every] of Object.entries(RETEST_CADENCE)) {
    if (kind === "trigger") continue; // due when raised, no interval at all
    assert.equal(every % 7, 0, `${kind} lands mid-week`);
  }
});

test("the full clock is 8 weeks, the spot clock 4", () => {
  assert.equal(RETEST_CADENCE.full, 56);
  assert.equal(RETEST_CADENCE.spot, 28);
});

test("a clean athlete has a full clock and no spot clock", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR);
  assert.equal(plan.spot, null, "nothing to spot-check");
  assert.equal(plan.full.state, "not-due");
});

/*
 * An exact interval means there is no grace period to sit inside: due on the
 * day, late after it. That is what picking one number buys.
 */
test("the full clock is due on day 56 and late after it", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const at = (d: string) => retestPlan(st, d, PAIR).full.state;
  assert.equal(at("2026-02-25"), "not-due", "55 days");
  assert.equal(at("2026-02-26"), "due", "56 days");
  assert.equal(at("2026-02-27"), "overdue", "57 days");
});

test("the spot clock is due on day 28 and late after it", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const at = (d: string) => retestPlan(st, d, PAIR).spot!.state;
  assert.equal(at("2026-01-28"), "not-due", "27 days");
  assert.equal(at("2026-01-29"), "due", "28 days");
  assert.equal(at("2026-01-30"), "overdue", "29 days");
});

/* The common case, and the reason the clocks are independent. */
test("an athlete can be mid-quarter and overdue a spot-check", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-02-15", PAIR);
  assert.equal(plan.full.state, "not-due", "45 days against a 56-day interval");
  assert.equal(plan.spot!.state, "overdue", "but 45 days on a 28-day one");
});

test("a spot-check covers the failing tests, not the whole sheet", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR);
  assert.deepEqual(plan.spot!.tests.map((t) => t.key), ["smp"]);
  assert.deepEqual(plan.full.tests.map((t) => t.key), ["smp", "gtd"]);
});

/*
 * The roster builds its spot clock from a summary and the panel builds one
 * from a screen. They had separate copies of this that happened to agree; now
 * they share one, and this pins them together.
 */
test("both callers date the spot clock the same way", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", { ...FULL, [SQ.L]: "bad", "gtd.first": "fail" }),
      screen("2026-02-15", { "gtd.first": "fail" }),
    ],
    PAIR,
  );
  const viaPlan = retestPlan(st, "2026-02-20", PAIR).spot!.since;
  const viaSummary = spotSince(st, screenSummary(st.results, PAIR).failing);
  assert.equal(viaPlan, viaSummary);
  assert.equal(viaPlan, "2026-01-01", "the stale one, not the one just done");
});

test("a failing test nobody has a date for is skipped, not null", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  assert.equal(spotSince(st, ["never-screened", "smp"]), "2026-01-01");
  assert.equal(spotSince(st, ["never-screened"]), null, "nothing to date it from");
});

/*
 * The one that decides whether the spot clock is useful. Rechecking the thing
 * you just did must not reset the clock on the thing you have been avoiding.
 */
test("the spot clock runs from the oldest failing test, not the newest", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", { ...FULL, [SQ.L]: "bad", "gtd.first": "fail" }),
      screen("2026-02-15", { "gtd.first": "fail" }),
    ],
    PAIR,
  );
  const plan = retestPlan(st, "2026-02-20", PAIR);
  assert.equal(plan.spot!.since, "2026-01-01", "the sample test is the stale one");
  assert.equal(plan.spot!.state, "overdue");
});

test("an athlete who has never had a full screen is overdue one", () => {
  const st = standingScreen([screen("2026-01-01", { [SQ.L]: "good" })], PAIR);
  const plan = retestPlan(st, "2026-01-02", PAIR);
  assert.equal(plan.full.state, "overdue", "never done is not 'not yet'");
  assert.equal(plan.full.since, null);
  assert.equal(plan.full.days, null);
});

test("a spot-check that clears the last deviation retires the spot clock", () => {
  const st = standingScreen(
    [screen("2026-01-01", BAD), screen("2026-02-01", { [SQ.L]: "good", [SQ.R]: "good" })],
    PAIR,
  );
  assert.equal(retestPlan(st, "2026-03-01", PAIR).spot, null);
});

test("the nearer clock speaks for an athlete when neither is due yet", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-01-10", PAIR);
  assert.equal(plan.full.state, "not-due");
  assert.equal(plan.spot!.state, "not-due");
  assert.equal(
    leadClock(plan.full, plan.spot).kind,
    "spot",
    `9 days against ${RETEST_CADENCE.spot} beats 9 days against ${RETEST_CADENCE.full}`,
  );
});

test("a more pressing clock wins regardless of which is nearer", () => {
  // May is a SPOT-check — it covers sample only, so the last full screen
  // stays January and the quarterly clock keeps running.
  const st = standingScreen(
    [screen("2026-01-01", FULL), screen("2026-05-01", { [SQ.L]: "bad", [SQ.R]: "good" })],
    PAIR,
  );
  const plan = retestPlan(st, "2026-05-05", PAIR);
  assert.equal(plan.spot!.state, "not-due", "spot-checked four days ago");
  assert.equal(plan.full.state, "overdue", "but the full screen is four months old");
  assert.equal(leadClock(plan.full, plan.spot).kind, "full");
});

/*
 * Where the two rules pull apart, now that intervals are exact.
 *
 * They agree on every live clock: a due one sits at zero days remaining and
 * an overdue one goes negative, so "most pressing" and "soonest" say the same
 * thing. A PAUSED clock is the exception — it can be a hundred days past an
 * interval it is no longer counting, which reads as the most urgent thing on
 * the page unless the state is checked first.
 */
test("a paused clock loses to a live one it has 'waited' longer than", () => {
  const st = standingScreen(
    [
      screen("2026-01-01", BAD),
      screen("2026-04-05", { [SQ.L]: "bad", [SQ.R]: "good" }),
    ],
    PAIR,
  );
  const plan = retestPlan(st, "2026-04-11", PAIR, { phase: IN_SEASON });
  assert.equal(plan.full.state, "paused", "100 days, and not being counted");
  assert.equal(plan.spot!.state, "not-due", "spot-checked six days ago");
  assert.equal(
    leadClock(plan.full, plan.spot, plan.trigger).kind,
    "spot",
    "the one that is actually coming",
  );
});

test("an athlete with nothing to fix has only the one clock", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR);
  assert.equal(leadClock(plan.full, plan.spot).kind, "full");
});

/* ------------------------------------------------------------------ *
 * Re-screens called regardless of the clock
 * ------------------------------------------------------------------ */

test("a called re-screen stands until a screen answers it", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  assert.equal(rescreenStanding({ since: "2026-02-01", reason: "x" }, st), true);
});

/*
 * The reason it is a date. A flag raised before the last screen has already
 * been acted on, so it clears itself and nobody has to dismiss anything.
 */
test("a call already answered by a later screen doesn't stand", () => {
  const st = standingScreen([screen("2026-03-01", FULL)], PAIR);
  assert.equal(rescreenStanding({ since: "2026-02-01", reason: "x" }, st), false);
});

/*
 * A screen this morning and a call this afternoon read identically by date.
 * Calling that answered swallows a call the coach deliberately made — which
 * is what it did the first time this ran, and the call simply vanished.
 */
test("a call on the day of a screen still stands", () => {
  const st = standingScreen([screen("2026-02-01", FULL)], PAIR);
  assert.equal(rescreenStanding({ since: "2026-02-01", reason: "x" }, st), true);
});

test("a call on an athlete nobody has screened stands", () => {
  assert.equal(
    rescreenStanding({ since: "2026-02-01", reason: "x" }, standingScreen([], PAIR)),
    true,
  );
});

test("no call, nothing standing", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  assert.equal(rescreenStanding(null, st), false);
  assert.equal(retestPlan(st, "2026-02-01", PAIR).trigger, null);
});

test("a called re-screen is due the day it is raised, with no window", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR, {
    call: { since: "2026-02-01", reason: "Moved to In-season" },
  });
  assert.equal(plan.trigger!.state, "due", "raised today, due today");
  assert.equal(plan.trigger!.tests.length, PAIR.length, "and it runs the whole sheet");
});

/* "Regardless of the clock" is the point: it replaces them, not competes. */
test("a called re-screen leads even when neither clock is anywhere near due", () => {
  const st = standingScreen([screen("2026-01-25", FULL)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR, {
    call: { since: "2026-02-01", reason: "Back from an injury flag" },
  });
  assert.equal(plan.full.state, "not-due", "screened a week ago");
  assert.equal(
    leadClock(plan.full, plan.spot, plan.trigger).kind,
    "trigger",
  );
});

test("with nothing called, the clocks decide as before", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-02-15", PAIR);
  assert.equal(leadClock(plan.full, plan.spot, plan.trigger).kind, "spot");
});

/* ------------------------------------------------------------------ *
 * In-season: go light
 * ------------------------------------------------------------------ */

test("in-season the full sheet stops being scheduled", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  // 100 days: well past the 56-day interval, so overdue in any other block.
  assert.equal(retestPlan(st, "2026-04-11", PAIR).full.state, "overdue");
  assert.equal(
    retestPlan(st, "2026-04-11", PAIR, { phase: IN_SEASON }).full.state,
    "paused",
  );
});

test("the other blocks schedule it as normal", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  for (const phase of ["Off-season", "Build", null, undefined])
    assert.equal(
      retestPlan(st, "2026-04-11", PAIR, { phase }).full.state,
      "overdue",
      `${phase} should not pause it`,
    );
});

/* Favour spot-checks over full screens: the corrective work carries on. */
test("in-season the spot clock runs exactly as it always did", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-02-15", PAIR, { phase: IN_SEASON });
  assert.equal(plan.spot!.state, "overdue");
  assert.equal(leadClock(plan.full, plan.spot, plan.trigger).kind, "spot");
});

test("a paused clock never leads, not even over nothing at all", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const plan = retestPlan(st, "2026-04-11", PAIR, { phase: IN_SEASON });
  assert.equal(plan.spot, null, "nothing flagged, so nothing to spot-check");
  assert.equal(leadClock(plan.full, plan.spot, plan.trigger).state, "paused");
  assert.ok(dueRank("paused") < dueRank("not-due"), "it isn't coming, so it sorts last");
});

/*
 * In-season changes what gets SCHEDULED. A re-screen someone asked for is not
 * scheduled, and a season is exactly when a mechanical change happens.
 */
test("a called re-screen still stands in-season", () => {
  const st = standingScreen([screen("2026-01-01", FULL)], PAIR);
  const plan = retestPlan(st, "2026-02-01", PAIR, {
    phase: IN_SEASON,
    call: { since: "2026-02-01", reason: "New arm slot" },
  });
  assert.equal(plan.full.state, "paused");
  assert.equal(leadClock(plan.full, plan.spot, plan.trigger).kind, "trigger");
});

/*
 * Which is where the next full sheet comes from: moving the phase stamps a
 * call, so the season opens on a complete screen and closes with one.
 */
test("the phase Cole pauses on is one the profile actually offers", () => {
  assert.ok(
    (PHASES as readonly string[]).includes(IN_SEASON),
    "IN_SEASON must match a real phase or nothing will ever pause",
  );
});

/* ------------------------------------------------------------------ *
 * The clocks, from a roster row
 * ------------------------------------------------------------------ */

const row = (over: Partial<Parameters<typeof clocksFor>[0]> = {}) => ({
  lastFull: null,
  spotSince: null,
  spotTests: 0,
  called: null,
  phase: null,
  ...over,
});

/*
 * One rule, shared. The roster and the daily prompt disagreeing about who is
 * due would be the sort of bug nobody reports — they'd just stop trusting it.
 */
test("a row's clocks match the plan built from its screens", () => {
  const st = standingScreen([screen("2026-01-01", BAD)], PAIR);
  const plan = retestPlan(st, "2026-02-15", PAIR);
  const clocks = clocksFor(
    row({ lastFull: st.lastFull, spotSince: st.from["smp"], spotTests: 1 }),
    "2026-02-15",
    PAIR,
  );
  assert.equal(clocks.full.state, plan.full.state);
  assert.equal(clocks.spot!.state, plan.spot!.state);
  assert.equal(clocks.lead.kind, "spot");
});

/*
 * A row knows the count, not the list. Claiming the full sheet made the daily
 * prompt offer a "spot-check · 16 tests", which is the whole battery under
 * the name of the thing that is meant to avoid it.
 */
test("a row's spot clock doesn't claim tests it can't name", () => {
  const clocks = clocksFor(
    row({ lastFull: "2026-01-01", spotSince: "2026-01-01", spotTests: 2 }),
    "2026-02-15",
    PAIR,
  );
  assert.deepEqual(clocks.spot!.tests, []);
  assert.equal(clocks.full.tests.length, PAIR.length, "the full sheet still knows");
});

test("a row in-season has its full clock paused", () => {
  const clocks = clocksFor(
    row({ lastFull: "2026-01-01", phase: IN_SEASON }),
    "2026-04-11",
    PAIR,
  );
  assert.equal(clocks.full.state, "paused");
  assert.equal(clocks.lead.state, "paused");
});

test("a called re-screen leads a row, whatever the clocks say", () => {
  const clocks = clocksFor(
    row({ lastFull: "2026-04-10", called: { since: "2026-04-11", reason: "x" } }),
    "2026-04-11",
    PAIR,
  );
  assert.equal(clocks.lead.kind, "trigger");
});

/* The prompt only opens on this, so a false positive is a modal for nothing. */
test("only a due or overdue clock asks anything of anybody", () => {
  const fresh = clocksFor(row({ lastFull: "2026-04-10" }), "2026-04-11", PAIR);
  assert.equal(needsScreening(fresh.lead), false, "screened yesterday");

  const paused = clocksFor(
    row({ lastFull: "2026-01-01", phase: IN_SEASON }),
    "2026-04-11",
    PAIR,
  );
  assert.equal(needsScreening(paused.lead), false, "in-season and quiet");

  const stale = clocksFor(row({ lastFull: "2026-01-01" }), "2026-04-11", PAIR);
  assert.equal(needsScreening(stale.lead), true);
});

/*
 * An athlete nobody has ever screened has no lastFull, which reads as overdue
 * — so the prompt greets a brand-new athlete asking to be screened. That is
 * the right answer: they do need one.
 */
test("an athlete with no screen at all needs screening", () => {
  assert.equal(needsScreening(clocksFor(row(), "2026-04-11", PAIR).lead), true);
});

test("due states sort most pressing first", () => {
  const order = (["not-due", "due", "overdue"] as const)
    .slice()
    .sort((a, b) => dueRank(b) - dueRank(a));
  assert.deepEqual(order, ["overdue", "due", "not-due"]);
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

test("every graded sub-test in the config offers Painful", () => {
  // The reason it is universal rather than repeated: this holds for tests
  // added later without anyone remembering to add it. Diagnostic sub-tests
  // are the exception — a movement can hurt, a note of where it was run
  // can't.
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests) {
      if (s.diagnostic) continue;
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

const push = () => SCREEN_TESTS.find((x) => x.key === "push-off")!;
const P = K("push-off", "planted");
const R = K("push-off", "released");
const SURF = K("push-off", "surface");

test("push-off: falling short of five foot lengths fails outright", () => {
  assert.equal(testMark(push(), { [P]: "lt-5" }), "red");
  const released = screenFields([push()]).find((f) => f.key === R)!;
  assert.equal(isApplicable(released, { [P]: "lt-5" }), false, "and asks nothing further");
});

test("push-off: stage one is a gate, so stage two supplies the colour", () => {
  // Both passing distances carry no colour of their own — five-to-six with
  // a good release is as green as over-six with one.
  assert.equal(testMark(push(), { [P]: "gt-6", [R]: "gt-half" }), "green");
  assert.equal(testMark(push(), { [P]: "5-to-6", [R]: "gt-half" }), "green");
  assert.equal(testMark(push(), { [P]: "gt-6", [R]: "lt-half" }), "yellow");
  assert.equal(testMark(push(), { [P]: "5-to-6", [R]: "none" }), "red");
});

test("push-off: pain flags it and skipping leaves no mark", () => {
  assert.equal(testMark(push(), { [P]: PAINFUL }), "alert");
  assert.equal(testMark(push(), { [P]: NOT_TESTED }), null);
});

/* Where it was run is context, not a grade — it must not colour anything. */
test("push-off: the surface is recorded without being marked", () => {
  const clean = { [SURF]: "mound", [P]: "gt-6", [R]: "gt-half" };
  assert.equal(testMark(push(), clean), "green");
  assert.equal(testMark(push(), { ...clean, [SURF]: "flat" }), "green");
  assert.deepEqual(deviations(clean, [push()]), [], "neither surface is a deviation");
});

test("push-off: the surface is never guessed by marking the test normal", () => {
  const filled = fillNormal({}, [push()]);
  assert.equal(SURF in filled, false, "nothing here knows where he threw");
  assert.equal(filled[P], "gt-6");
});

test("push-off: an unrecorded surface still leaves the test asked and answered", () => {
  assert.equal(covers({ [P]: "gt-6", [R]: "gt-half" }, push()), true);
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
  assert.equal(testMark(heel(), { ...both, [HL.qL]: "straight-up", [HL.qR]: "rolls-outside" }), "yellow", "right");
  assert.equal(testMark(heel(), { ...both, [HL.qR]: "straight-up", [HL.qL]: "rolls-outside" }), "yellow", "left");
});

/*
 * Cole, revising his own earlier call while running the sheet: rolling to the
 * outside is worth working on, not a failed test. The red on this one belongs
 * to a limited lift and to nothing else.
 */
test("heel lift: only a limited lift is a red", () => {
  const reds = heel()
    .subTests.flatMap((st) => st.findings)
    .filter((f) => f.severity === "red")
    .map((f) => f.key);
  assert.deepEqual(reds, ["limited"]);
  assert.equal(testMark(heel(), { [HL.hL]: "limited", [HL.hR]: "good", [HL.qR]: "straight-up" }), "red");
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
  const t = push();
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

    /*
     * The two branches used to say the same thing two ways — "Holding the
     * knee restored it" against "Normal eversion when holding the knees" —
     * so a coach reading down the form had to work out they were one finding.
     */
    test(`${testKey} (${move}): both branches name the movement the same way`, () => {
      const label = (sub: string, key: string) =>
        t()
          .subTests.find((x) => x.key === sub)!
          .findings.find((f) => f.key === key)!.label;

      for (const [sub, keys] of [
        [`${move}-held-one`, ["fixed", "still-limited"]],
        [`${move}-held-both`, ["normal", "still-right", "still-left", "still-both"]],
      ] as [string, string[]][])
        for (const k of keys)
          assert.match(
            label(sub, k),
            new RegExp(move),
            `${sub}.${k} doesn't say which movement it's about`,
          );

      assert.equal(
        label(`${move}-held-one`, "fixed").replace("that knee", "the knees"),
        label(`${move}-held-both`, "normal"),
        "the one-sided and bilateral yellows should read alike",
      );
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
   * Every test now comes from the app rather than the 2019 sheet, so an
   * uncoloured finding is a mistake rather than a gap. Two exceptions: a
   * gate, whose colour comes from the question it opens, and a DIAGNOSTIC
   * sub-test, which records context rather than a grade — where the push-off
   * was run is not something that can be green.
   */
  const ungraded: string[] = [];
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests) {
      if (s.diagnostic) continue;
      for (const f of s.findings) {
        if (f.severity || f.alert) continue;
        const defers = t.subTests.some(
          (x) => x.dependsOn?.subTest === s.key && x.dependsOn.findings.includes(f.key),
        );
        if (!defers) ungraded.push(`${t.key}.${s.key} -> ${f.label}`);
      }
    }
  assert.deepEqual(ungraded, []);
});

/* The exemption above is only worth having if something actually uses it. */
test("a diagnostic sub-test isn't offered a painful answer", () => {
  const surface = SCREEN_TESTS.find((t) => t.key === "push-off")!.subTests.find(
    (s) => s.key === "surface",
  )!;
  assert.deepEqual(
    subTestFindings(surface).map((f) => f.key),
    ["mound", "flat"],
    "where a test was run has no painful answer",
  );
  // Every graded sub-test still gets it.
  const graded = SCREEN_TESTS.flatMap((t) => t.subTests).filter((s) => !s.diagnostic);
  for (const s of graded)
    assert.ok(
      subTestFindings(s).some((f) => f.key === PAINFUL),
      `${s.key} lost its painful option`,
    );
});

test("a diagnostic sub-test records context rather than a grade", () => {
  const diagnostic = SCREEN_TESTS.flatMap((t) =>
    t.subTests.filter((s) => s.diagnostic).map((s) => `${t.key}.${s.key}`),
  );
  assert.deepEqual(diagnostic, ["push-off.surface"]);
  for (const t of SCREEN_TESTS)
    for (const s of t.subTests)
      if (s.diagnostic)
        for (const f of s.findings) {
          assert.equal(f.severity, undefined, `${f.label} should carry no colour`);
          assert.notEqual(f.normal, true, `${f.label} is not a pass either`);
        }
});

test("every gate leads somewhere, and every branch has a gate", () => {
  for (const t of SCREEN_TESTS) {
    for (const s of t.subTests) {
      if (!s.dependsOn) continue;
      const parent = t.subTests.find((x) => x.key === s.dependsOn!.subTest);
      assert.ok(parent, `${t.key}.${s.key} branches off nothing`);
    }
    // A finding with no colour must open something, or it grades nothing —
    // unless the sub-test is diagnostic, which grades nothing on purpose.
    for (const s of t.subTests)
      if (!s.diagnostic)
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
