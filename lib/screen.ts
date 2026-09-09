/* ------------------------------------------------------------------ *
 * OnBaseU pitching movement screen
 *
 * The paper sheet records a FINDING per sub-test and shades the normal one;
 * the OnBaseU app then shows a green / yellow / red dot per test. So the
 * finding is the record and the colour is a label placed on top of it — which
 * is why `severity` below is optional. Screens can be captured now and graded
 * later without re-keying anything.
 *
 * `key` is what reaches the database and must never change. `label` is what a
 * coach reads and may change freely — OnBaseU rewording a test costs nothing.
 * ------------------------------------------------------------------ */

export type Severity = "green" | "yellow" | "red";

/**
 * What a test shows at a glance: a colour, or an alert.
 *
 * Pain is not the bad end of the scale, it is off the scale. The app already
 * makes this call once — a recovery check-in branches pain away from soreness
 * rather than grading it as worse soreness, and the resulting flag never
 * auto-clears. A painful finding on a screen behaves the same way: it replaces
 * the dot rather than colouring it, because "red" invites comparison with
 * other reds and this does not want comparing.
 */
export type TestMark = Severity | "alert";

/** Every sub-test can be skipped, so this is a value rather than an absence. */
export const NOT_TESTED = "not-tested";

/**
 * Pain is offered on every sub-test, so it lives here rather than being
 * repeated in thirty finding lists. A test added to the config gets it
 * automatically — the alternative depends on whoever adds the next one
 * remembering, and pain is the wrong thing to leave to memory.
 */
export const PAINFUL = "painful";

export interface Finding {
  key: string;
  label: string;
  /** The sheet's shaded option — the outcome the test is looking for. */
  normal?: boolean;
  /** From the OnBaseU app. Unset until the mapping is supplied. */
  severity?: Severity;
  /** Outside the colour scale entirely — shown as an alert, and it wins. */
  alert?: boolean;
}

export interface SubTest {
  key: string;
  label: string;
  /**
   * No answer here is a pass. Holding the pelvis or the shoulders tells you
   * WHY a movement is limited — mobility or stability — after the limitation
   * itself has already been graded. The sheet shades no normal for these, and
   * they must not be counted as deviations or coloured as failures.
   */
  diagnostic?: boolean;
  /** Graded once per side, as the sheet's L / R columns. */
  bilateral?: boolean;
  /**
   * Only performed when another sub-test came out one of a set of ways.
   * Several answers can lead to the same follow-up — on Pelvic Tilt, "cannot
   * arch" and "cannot flatten" both open the same motion-quality question.
   */
  dependsOn?: { subTest: string; findings: string[] };
  /** What to look for, from the OnBaseU procedure. Shown while grading. */
  help?: string;
  findings: Finding[];
}

export interface ScreenTest {
  key: string;
  label: string;
  group: string;
  subTests: SubTest[];
}

export interface ScreenGroup {
  id: string;
  title: string;
}

/** Offered on every sub-test, whatever its own list says. */
export const UNIVERSAL_FINDINGS: Finding[] = [
  { key: PAINFUL, label: "Painful", alert: true },
];

/** A sub-test's own findings plus the ones every sub-test offers. */
export function subTestFindings(subTest: SubTest): Finding[] {
  return [...subTest.findings, ...UNIVERSAL_FINDINGS];
}

export const SCREEN_GROUPS: ScreenGroup[] = [
  { id: "core", title: "Core Control" },
  { id: "rotation", title: "Rotation" },
  { id: "stride", title: "Stride" },
  { id: "posture", title: "Upright Posture" },
  { id: "arms", title: "Arms" },
];

/** Shorthand: a finding list where the first entry is the normal one. */
const f = (...items: [string, string][]): Finding[] =>
  items.map(([key, label], i) => ({ key, label, ...(i === 0 ? { normal: true } : {}) }));

/**
 * Push-Off, which runs identically on the mound and on flat ground. Defined
 * once and used by both variants: two copies would drift, and the whole point
 * of splitting the surfaces was to compare like with like.
 *
 * Stage one is a gate rather than a grade. The question is not really how far
 * they step with the back foot glued down — that is the opening piece. The
 * test is whether they can beat their own constrained number once the
 * constraint comes off, so the colour lives in stage two. Over six foot
 * lengths and five-to-six are equally acceptable baselines; failing to improve
 * on either is the finding.
 */
const PUSH_OFF_SUBTESTS: SubTest[] = [
  {
    key: "planted",
    label: "How far did they step with their back foot planted?",
    findings: [
      { key: "gt-6", label: "Greater than 6 foot lengths", normal: true },
      { key: "5-to-6", label: "5-6 foot lengths", normal: true },
      { key: "lt-5", label: "Less than 5 foot lengths", severity: "red" },
    ],
  },
  {
    key: "released",
    label: "How far did they step with the back foot released?",
    dependsOn: { subTest: "planted", findings: ["gt-6", "5-to-6"] },
    findings: [
      { key: "gt-half", label: "Greater than half a foot length increase", normal: true, severity: "green" },
      { key: "lt-half", label: "Increased, but less than half a foot length", severity: "yellow" },
      { key: "none", label: "No length increase", severity: "red" },
    ],
  },
];

/**
 * Ankle Rocking, per movement. Eversion and inversion are the same interview
 * twice over, so it is generated rather than written out: two copies of a
 * four-way gate with two branches under it would not stay in step.
 *
 * The grading rule is the same down both branches — if holding the knees
 * restores the movement it is a yellow, and anything still limited is a red.
 */
function ankleRockingSubTests(move: "eversion" | "inversion"): SubTest[] {
  const dir = move === "eversion" ? "eversion (rolling in)" : "inversion (rolling out)";
  const cap = move[0].toUpperCase() + move.slice(1);
  return [
    {
      key: move,
      label: `How was seated ${dir} without holding the knees?`,
      findings: [
        { key: "good-bilateral", label: `Good ${move} bilaterally`, normal: true, severity: "green" },
        { key: "limited-right", label: `Limited ${move} on the right` },
        { key: "limited-left", label: `Limited ${move} on the left` },
        { key: "limited-bilateral", label: `Limited ${move} bilaterally` },
      ],
    },
    {
      // One ankle was limited, so the question is only about that ankle.
      key: `${move}-held-one`,
      label: "Did holding the knee fix that ankle?",
      dependsOn: { subTest: move, findings: ["limited-right", "limited-left"] },
      findings: [
        { key: "fixed", label: "Holding the knee restored it", severity: "yellow" },
        { key: "still-limited", label: "Still limited when holding the knee", severity: "red" },
      ],
    },
    {
      // Both ankles were limited, so holding can fix both, one, or neither.
      key: `${move}-held-both`,
      label: `How was ${move} when holding the knees?`,
      dependsOn: { subTest: move, findings: ["limited-bilateral"] },
      findings: [
        { key: "normal", label: `Normal ${move} when holding the knees`, severity: "yellow" },
        { key: "still-right", label: `Still limited ${move} on the right`, severity: "red" },
        { key: "still-left", label: `Still limited ${move} on the left`, severity: "red" },
        { key: "still-both", label: `Still limited ${move} bilaterally`, severity: "red" },
      ],
    },
  ];
}

export const SCREEN_TESTS: ScreenTest[] = [
  {
    key: "pelvic-tilt",
    label: "Pelvic Tilt",
    group: "core",
    subTests: [
      {
        /*
         * Graded once. The pelvis tilts forward and back in one plane, so
         * there is no side to split — unlike most of this screen, where
         * direction is either a per-side grade or an option in the list.
         */
        key: "tilt",
        label: "Tilt",
        help: "Athletic posture, arms crossed with hands resting on the shoulders. Tilt the pelvis forward to increase the arch, then back to flatten it. Expect minimal leg and knee movement and limited upper-body sway. Limitation can appear in one direction and not the other.",
        findings: [
          { key: "can-tilt-both", label: "Can tilt in both directions", normal: true, severity: "green" },
          { key: "cannot-arch", label: "Cannot arch the back", severity: "yellow" },
          { key: "cannot-flatten", label: "Cannot flatten the back", severity: "yellow" },
          { key: "cannot-either", label: "Cannot tilt in either direction", severity: "red" },
        ],
      },
      {
        key: "quality-tilting",
        label: "Motion quality",
        dependsOn: { subTest: "tilt", findings: ["can-tilt-both"] },
        help: "Watch the tilt itself rather than its range. Shaking through the movement suggests those muscles aren't used day to day.",
        findings: [
          { key: "smooth", label: "Smooth motion", normal: true, severity: "green" },
          { key: "shake", label: "Shake and bake (vibration)", severity: "yellow" },
        ],
      },
      {
        /*
         * Same two answers as above, one colour worse each. Shaking on a
         * pelvis that already won't tilt is a different finding from shaking
         * on one that will, which is why the branches carry their own
         * severities rather than sharing a list.
         */
        key: "quality-limited",
        label: "Motion quality",
        dependsOn: { subTest: "tilt", findings: ["cannot-arch", "cannot-flatten"] },
        findings: [
          { key: "smooth", label: "Smooth motion", severity: "yellow" },
          { key: "shake", label: "Shake and bake (vibration)", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "pelvic-rotation",
    label: "Pelvic Rotation",
    group: "core",
    subTests: [
      {
        /*
         * Graded once, not per side. Direction lives in the options —
         * "limited turning right" is an answer, not a right-hand column — so
         * each limitation opens the follow-up that belongs to it.
         */
        key: "rotation",
        label: "Rotation",
        help: "Athletic posture, feet shoulder width, arms crossed with hands on the front of each shoulder. Rotate the belt and below back and forth without moving the upper body — it should look like the twist with no shoulder motion. Watch for the pelvis shifting sideways rather than turning, and for the legs straightening and bending.",
        findings: [
          { key: "good-bilateral", label: "Good bilateral without assistance", normal: true, severity: "green" },
          { key: "limited-bilateral", label: "Limited without assistance" },
          { key: "limited-right", label: "Limited turning right without assistance" },
          { key: "limited-left", label: "Limited turning left without assistance" },
        ],
      },
      {
        key: "assist-bilateral",
        label: "With assistance",
        dependsOn: { subTest: "rotation", findings: ["limited-bilateral"] },
        help: "Hold their upper body stable for them and have them rotate again. Improving on both sides is the best outcome here; improving on only one is not.",
        findings: [
          { key: "improves-bilateral", label: "Improvement bilateral with assistance", severity: "yellow" },
          { key: "no-improvement", label: "No bilateral improvement with assistance", severity: "red" },
          { key: "improves-right", label: "Right rotation improvement with assistance", severity: "red" },
          { key: "improves-left", label: "Left rotation improvement with assistance", severity: "red" },
        ],
      },
      {
        /*
         * A one-sided limitation is yellow whether or not assistance helps, so
         * this follow-up records the mobility-or-stability answer without
         * changing the colour. Kept because it is what tells you which to
         * program for.
         */
        key: "assist-right",
        label: "With assistance (right)",
        dependsOn: { subTest: "rotation", findings: ["limited-right"] },
        findings: [
          { key: "improves", label: "Improvement with assistance", severity: "yellow" },
          { key: "no-improvement", label: "No improvement with assistance", severity: "yellow" },
        ],
      },
      {
        key: "assist-left",
        label: "With assistance (left)",
        dependsOn: { subTest: "rotation", findings: ["limited-left"] },
        findings: [
          { key: "improves", label: "Improvement with assistance", severity: "yellow" },
          { key: "no-improvement", label: "No improvement with assistance", severity: "yellow" },
        ],
      },
    ],
  },
  {
    key: "toe-tap",
    label: "Toe Tap Test",
    group: "rotation",
    subTests: [
      {
        /*
         * The app asks this twice — "how was hip internal rotation on the
         * right?" then the left — with the side written into each option.
         * Held here as one bilateral sub-test with side-neutral labels: the
         * same information, and it lets a re-screen say the left improved
         * while the right did not.
         */
        key: "hip-ir",
        label: "Hip internal rotation",
        bilateral: true,
        findings: [
          { key: "touches", label: "Touches the bat", normal: true, severity: "green" },
          { key: "short", label: "Short of the bat", severity: "yellow" },
        ],
      },
      {
        /*
         * Only the side that came up short opens this, and only that side —
         * `dependsOn` resolves per side, so a short right leg does not put the
         * question in front of a left leg that reached fine.
         */
        key: "holding-pelvis",
        label: "With the pelvis held",
        bilateral: true,
        dependsOn: { subTest: "hip-ir", findings: ["short"] },
        help: "Hold the pelvis steady and have them turn again. Reaching the bat now means the limit was stability; still coming up short means it is mobility.",
        findings: [
          { key: "touches", label: "Touches the bat with the pelvis held", severity: "yellow" },
          { key: "still-short", label: "Still short with the pelvis held", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "hip-45",
    label: "Hip 45 Test",
    group: "rotation",
    subTests: [
      {
        // Same question of each hip, no follow-up either way.
        key: "45-degree-angle",
        label: "45 Degree Angle",
        bilateral: true,
        findings: [
          { key: "greater", label: "Greater than 45\u00b0", normal: true, severity: "green" },
          { key: "equal", label: "Equal to 45\u00b0", severity: "yellow" },
          { key: "less", label: "Less than 45\u00b0", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "seated-trunk-rotation",
    label: "Seated Trunk Rotation",
    group: "rotation",
    subTests: [
      {
        key: "spine-rotation",
        label: "Spine rotation",
        bilateral: true,
        // Colours inferred from Hip 45, which uses this exact shape and was
        // confirmed green / yellow / red in order.
        findings: [
          { key: "greater", label: "Greater than 45\u00b0 turning", normal: true, severity: "green" },
          { key: "equal", label: "Equal to 45\u00b0 turning", severity: "yellow" },
          { key: "less", label: "Less than 45\u00b0 turning", severity: "red" },
        ],
      },
      {
        /*
         * Checked alongside the trunk, not after it — always asked, never a
         * follow-up. The head turns against the trunk: turning the body right
         * means looking back to the left.
         */
        key: "cervical",
        label: "Cervical rotation",
        bilateral: true,
        help: "As they rotate the trunk, have them look back the other way — turning right, they look left. Watch whether the chin reaches the collarbone.",
        findings: [
          { key: "touches", label: "Chin touches clavicle", normal: true, severity: "green" },
          { key: "short", label: "Chin short of clavicle", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "side-step-walkout",
    label: "Side Step Walkout Test",
    group: "stride",
    subTests: [
      {
        // Graded once — the athlete steps one way, so there is no side to split.
        key: "distance",
        label: "How far did the athlete side step?",
        // Colours inferred from Hip 45, which uses this same greater / equal /
        // less shape and was confirmed green, yellow, red in order.
        findings: [
          { key: "greater", label: "Greater than the ball", normal: true, severity: "green" },
          { key: "equal", label: "Equal to the ball", severity: "yellow" },
          { key: "less", label: "Less than the ball", severity: "red" },
        ],
      },
    ],
  },
  /*
   * Two tests, not one with a surface field. Held as a single test, a re-screen
   * could compare a mound push-off against a flat-ground one and report an
   * improvement that was only a change of surface. Split, the comparison is
   * like-for-like by construction, and doing only one of them this time simply
   * leaves the other with nothing to compare.
   */
  {
    key: "push-off-mound",
    label: "Push-Off Test (Mound)",
    group: "stride",
    subTests: PUSH_OFF_SUBTESTS,
  },
  {
    key: "push-off-flat",
    label: "Push-Off Test (Flat Ground)",
    group: "stride",
    subTests: PUSH_OFF_SUBTESTS,
  },
  {
    key: "heel-lift",
    label: "Heel Lift Test",
    group: "stride",
    subTests: [
      {
        key: "height",
        label: "What was the height of their heel lift?",
        bilateral: true,
        help: "Toes of the standing foot to the wall, the other foot behind it and then lifted clear. Balancing on the standing foot alone, lift that heel off the ground.",
        findings: [
          // A gate, like Push-Off's first stage: a good lift carries no colour
          // of its own and passes through to the quality question.
          { key: "good", label: "Good lift", normal: true },
          { key: "limited", label: "Limited lift", severity: "red" },
        ],
      },
      {
        key: "quality",
        label: "What was the quality of the heel lift?",
        bilateral: true,
        dependsOn: { subTest: "height", findings: ["good"] },
        findings: [
          { key: "straight-up", label: "Raises straight up", normal: true, severity: "green" },
          { key: "rolls-outside", label: "Rolls to outside of foot", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "ankle-rocking",
    label: "Ankle Rocking Test",
    group: "stride",
    subTests: [
      ...ankleRockingSubTests("eversion"),
      ...ankleRockingSubTests("inversion"),
    ],
  },
  {
    key: "ankle-rolling",
    label: "Ankle Rolling Test",
    group: "stride",
    subTests: [
      {
        key: "turning-in",
        label: "Seated Turning In",
        bilateral: true,
        findings: f(["gte-20", "20 degrees or more"], ["limited", "Limited (<20 degrees)"]),
      },
      {
        key: "turning-out",
        label: "Seated Turning Out",
        bilateral: true,
        findings: f(["gte-20", "20 degrees or more"], ["limited", "Limited (<20 degrees)"]),
      },
    ],
  },
  {
    key: "half-kneeling",
    label: "Half-Kneeling Narrow Base",
    group: "posture",
    subTests: [
      {
        key: "on-base-line",
        label: "On Base Line",
        bilateral: true,
        findings: f(
          ["good", "Good"],
          ["unstable", "Unstable"],
          ["unable", "Unable to Complete"],
        ),
      },
    ],
  },
  {
    key: "lunge-extension",
    label: "Lunge w/ Extension Test",
    group: "posture",
    subTests: [
      {
        key: "in-full-stride",
        label: "In Full Stride",
        bilateral: true,
        findings: f(
          ["can-get-in", "Can Get into Starting Position"],
          ["cant-get-in", "Can't Get into Starting Position"],
        ),
      },
      {
        key: "trying-to-extend",
        label: "Trying to Extend",
        bilateral: true,
        findings: f(
          ["good-extension", "Good Extension"],
          ["shoulders-dont-clear", "Shoulders Don't Clear Mid-Thigh"],
          ["lost-shoulder-flexion", "Lost Shoulder Flexion"],
        ),
      },
    ],
  },
  {
    key: "wide-squat",
    label: "Wide Squat Test",
    group: "posture",
    subTests: [
      {
        key: "arms-in-front",
        label: "Arms in Front",
        help: "Feet shoulder width, toes straight ahead, arms out front. Descend as deeply as possible with heels down and chest forward. Looking for the thighs to break parallel.",
        findings: f(["good-squat", "Good Squat"], ["limited-squat", "Limited Squat"]),
      },
      {
        key: "arms-down",
        label: "Arms Down",
        /*
         * Only performed if they broke parallel — the procedure says "if the
         * player breaks parallel, now have them lower their arms". Otherwise
         * this isn't unrecorded, it never happened.
         */
        dependsOn: { subTest: "arms-in-front", findings: ["good-squat"] },
        help: "From the bottom of the squat, lower the fists to the floor inside the footprint and hold without losing control.",
        findings: f(["stable", "Stable"], ["unstable", "Unstable"]),
      },
    ],
  },
  {
    key: "shoulder-90-90",
    label: "Shoulder 90/90",
    group: "arms",
    subTests: [
      {
        key: "standing-tall",
        label: "Standing Tall",
        bilateral: true,
        findings: f(
          ["greater-spine", "Greater than Spine Angle"],
          ["equal-spine", "Equal to Spine Angle"],
          ["less-spine", "Less than Spine Angle"],
        ),
      },
    ],
  },
  {
    key: "windshield-wiper",
    label: "Windshield Wiper Test",
    group: "arms",
    subTests: [
      {
        key: "in-front",
        label: "In Front",
        bilateral: true,
        findings: f(["gte-90", "= or > 90°"], ["lt-90", "< 90°"]),
      },
      {
        key: "at-side",
        label: "At Side",
        bilateral: true,
        findings: f(["gte-90", "= or > 90°"], ["lt-90", "< 90°"]),
      },
    ],
  },
  {
    key: "forearm-80-80",
    label: "Forearm 80/80 Test",
    group: "arms",
    subTests: [
      {
        key: "palm-towards",
        label: "Palm Towards (Curve)",
        bilateral: true,
        findings: f(["gte-80", "80 degrees or More"], ["lt-80", "Less than 80 Degrees"]),
      },
      {
        key: "palm-away",
        label: "Palm Away (Change-Up)",
        bilateral: true,
        findings: f(["gte-80", "80 degrees or More"], ["lt-80", "Less than 80 Degrees"]),
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Reading a screen
 *
 * A screen's `results` is a flat map of field key -> finding key. Field keys
 * carry the test as well as the sub-test, because finding and sub-test names
 * repeat across tests — "improves" appears under both Holding Pelvis and
 * Holding Shoulders, and an unqualified key would collide.
 * ------------------------------------------------------------------ */

export const SIDES = ["L", "R"] as const;
export type Side = (typeof SIDES)[number];

export type Results = Record<string, string>;

export function fieldKey(testKey: string, subTestKey: string, side?: Side): string {
  return side ? `${testKey}.${subTestKey}:${side}` : `${testKey}.${subTestKey}`;
}

export interface Field {
  key: string;
  test: ScreenTest;
  subTest: SubTest;
  side?: Side;
}

/** Every graded field on the sheet, in the order a coach works through it. */
export function screenFields(tests: ScreenTest[] = SCREEN_TESTS): Field[] {
  const out: Field[] = [];
  for (const test of tests)
    for (const subTest of test.subTests) {
      if (subTest.bilateral)
        for (const side of SIDES)
          out.push({ key: fieldKey(test.key, subTest.key, side), test, subTest, side });
      else out.push({ key: fieldKey(test.key, subTest.key), test, subTest });
    }
  return out;
}

/**
 * Wide Squat's Arms Down only happens if they broke parallel. A dependent
 * field with its condition unmet is not blank — it never took place, and a
 * form that leaves it selectable invites a reading that didn't occur.
 */
export function isApplicable(field: Field, results: Results): boolean {
  const dep = field.subTest.dependsOn;
  if (!dep) return true;
  const answer = results[fieldKey(field.test.key, dep.subTest, field.side)];
  return !!answer && dep.findings.includes(answer);
}

export function findingFor(field: Field, results: Results): Finding | null {
  const value = results[field.key];
  if (!value || value === NOT_TESTED) return null;
  return subTestFindings(field.subTest).find((x) => x.key === value) ?? null;
}

export interface Deviation {
  field: Field;
  finding: Finding;
}

/** Everything the athlete did that the test wasn't looking for. */
export function deviations(results: Results, tests: ScreenTest[] = SCREEN_TESTS): Deviation[] {
  const out: Deviation[] = [];
  for (const field of screenFields(tests)) {
    if (field.subTest.diagnostic) continue;
    if (!isApplicable(field, results)) continue;
    const finding = findingFor(field, results);
    if (finding && !finding.normal) out.push({ field, finding });
  }
  return out;
}

const RANK: Record<Severity, number> = { green: 0, yellow: 1, red: 2 };

/**
 * Has this answer handed its colour to a follow-up that actually supplied one?
 *
 * Such a finding carries no colour on purpose — "limited without assistance"
 * is not an ungraded deviation, it is a deferred one, and treating the two
 * alike wiped the mark off every graded outcome of Pelvic Rotation.
 *
 * But deferring to a follow-up nobody answered supplies nothing, and the test
 * would then inherit a green from some other reading. So the branch has to
 * have been answered with something that carries a colour, on this same side.
 */
function deferredAndResolved(
  test: ScreenTest,
  field: Field,
  finding: Finding,
  results: Results,
): boolean {
  const branches = test.subTests.filter(
    (s) =>
      s.dependsOn?.subTest === field.subTest.key &&
      s.dependsOn.findings.includes(finding.key),
  );
  return branches.some((s) => {
    const value = results[fieldKey(test.key, s.key, field.side)];
    if (!value) return false;
    const answered = subTestFindings(s).find((x) => x.key === value);
    return !!(answered?.severity || answered?.alert);
  });
}

/**
 * A test's mark is the worst of its findings, the way the OnBaseU app rolls it
 * up — except that an alert short-circuits, since pain is not a rank. Null
 * until the mapping is filled in, deliberately: an ungraded screen shows no
 * mark rather than a misleading green.
 */
export function testMark(test: ScreenTest, results: Results): TestMark | null {
  let worst: Severity | null = null;
  let ungraded = false;
  for (const field of screenFields([test])) {
    if (!isApplicable(field, results)) continue;
    const finding = findingFor(field, results);
    if (!finding) continue;
    // An alert is not a worse colour, so it does not compete on rank.
    if (finding.alert) return "alert";
    if (finding.severity) {
      if (!worst || RANK[finding.severity] > RANK[worst]) worst = finding.severity;
    } else if (
      !finding.normal &&
      !field.subTest.diagnostic &&
      !deferredAndResolved(test, field, finding, results)
    ) {
      /*
       * A deviation whose colour hasn't been supplied yet — and which defers
       * to nothing. Worst-of would quietly return the OTHER side's green and
       * call the test clean: one leg short of the bat reported as passing.
       * No mark is the honest answer until the mapping is filled in.
       */
      ungraded = true;
    }
  }
  return ungraded ? null : worst;
}

/** Every alerting finding on the screen — pain, and anything like it. */
export function alerts(results: Results, tests: ScreenTest[] = SCREEN_TESTS): Deviation[] {
  const out: Deviation[] = [];
  for (const field of screenFields(tests)) {
    if (!isApplicable(field, results)) continue;
    const finding = findingFor(field, results);
    if (finding?.alert) out.push({ field, finding });
  }
  return out;
}

export interface ScreenCounts {
  normal: number;
  deviation: number;
  notTested: number;
  blank: number;
  notApplicable: number;
}

export function screenCounts(results: Results, tests: ScreenTest[] = SCREEN_TESTS): ScreenCounts {
  const c: ScreenCounts = { normal: 0, deviation: 0, notTested: 0, blank: 0, notApplicable: 0 };
  for (const field of screenFields(tests)) {
    if (!isApplicable(field, results)) { c.notApplicable++; continue; }
    const value = results[field.key];
    if (!value) c.blank++;
    else if (value === NOT_TESTED) c.notTested++;
    else if (findingFor(field, results)?.normal) c.normal++;
    else c.deviation++;
  }
  return c;
}

export interface ScreenChange {
  /** Was a deviation last time, isn't now. */
  resolved: Deviation[];
  /** Still a deviation, though the finding itself may have moved. */
  persisting: { field: Field; before: Finding; after: Finding }[];
  /** Wasn't a deviation last time, is now. */
  appeared: Deviation[];
}

/**
 * What changed between two screens. `persisting` keeps both findings rather
 * than collapsing to "still bad": Pelvic Tilt going from Both Limited to Hard
 * Time Arching Back is real progress, and a comparison that only asked
 * "normal or not" would report no change at all.
 */
export function compareScreens(
  before: Results,
  after: Results,
  tests: ScreenTest[] = SCREEN_TESTS,
): ScreenChange {
  const change: ScreenChange = { resolved: [], persisting: [], appeared: [] };
  const dev = (r: Results, field: Field): Finding | null => {
    if (!isApplicable(field, r)) return null;
    const finding = findingFor(field, r);
    return finding && !finding.normal ? finding : null;
  };
  for (const field of screenFields(tests)) {
    const b = dev(before, field);
    const a = dev(after, field);
    if (b && a) change.persisting.push({ field, before: b, after: a });
    else if (b && !a) change.resolved.push({ field, finding: b });
    else if (!b && a) change.appeared.push({ field, finding: a });
  }
  return change;
}

/* ------------------------------------------------------------------ *
 * What an athlete may see
 * ------------------------------------------------------------------ */

/**
 * Strip the coach's notes before a screen reaches an athlete.
 *
 * The findings are theirs and seeing them is the point — that's the work
 * list. The note beside them is written while screening and is candid by
 * nature ("guarding, suspect he's protecting the shoulder"), which is the
 * same reason `coachNotes` never leaves the profile route. Deleted rather
 * than blanked, so a shape that shouldn't be there is absent rather than
 * empty, and stripped HERE rather than in the UI, because a field merely
 * hidden in markup is found in about ninety seconds.
 */
export function visibleScreen<T extends { notes?: string }>(
  screen: T,
  isCoach: boolean,
): Partial<T> {
  if (isCoach) return screen;
  const copy: Partial<T> = { ...screen };
  delete copy.notes;
  return copy;
}
