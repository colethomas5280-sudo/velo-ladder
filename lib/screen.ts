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

import { daysBetween } from "./velo";

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
  /** Graded twice — left and right, or dominant and non-dominant. */
  sides?: SideSet;
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
 * Ankle Rocking and Ankle Rolling, per movement.
 *
 * Four interviews of identical shape — eversion, inversion, lateral tibial
 * rotation, medial tibial rotation — each a four-way gate with two branches
 * under it. Generated from one definition because four written-out copies
 * would not stay in step, and the two tests are the same procedure applied to
 * different movements.
 *
 * The grading rule is the same down every branch: if holding the knees
 * restores the movement it is a yellow, and anything still limited is a red.
 */
function ankleSubTests(spec: {
  /** Stable key stem — never change it, it is in the database. */
  key: string;
  /** The movement as the question asks it, e.g. "seated eversion (rolling in)". */
  question: string;
  /** The movement as an answer names it, e.g. "eversion". */
  noun: string;
}): SubTest[] {
  const { key, question, noun } = spec;
  return [
    {
      key,
      label: `How was ${question} without holding the knees?`,
      findings: [
        { key: "good-bilateral", label: `Good ${noun} bilaterally`, normal: true, severity: "green" },
        { key: "limited-right", label: `Limited ${noun} on the right` },
        { key: "limited-left", label: `Limited ${noun} on the left` },
        { key: "limited-bilateral", label: `Limited ${noun} bilaterally` },
      ],
    },
    {
      // One side was limited, so the question is only about that side.
      key: `${key}-held-one`,
      label: "Did holding the knee fix that side?",
      dependsOn: { subTest: key, findings: ["limited-right", "limited-left"] },
      findings: [
        { key: "fixed", label: "Holding the knee restored it", severity: "yellow" },
        { key: "still-limited", label: "Still limited when holding the knee", severity: "red" },
      ],
    },
    {
      // Both sides were limited, so holding can fix both, one, or neither.
      key: `${key}-held-both`,
      label: `How was ${noun} when holding the knees?`,
      dependsOn: { subTest: key, findings: ["limited-bilateral"] },
      findings: [
        { key: "normal", label: `Normal ${noun} when holding the knees`, severity: "yellow" },
        { key: "still-right", label: `Still limited ${noun} on the right`, severity: "red" },
        { key: "still-left", label: `Still limited ${noun} on the left`, severity: "red" },
        { key: "still-both", label: `Still limited ${noun} bilaterally`, severity: "red" },
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
        sides: "lr",
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
        sides: "lr",
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
        sides: "lr",
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
        sides: "lr",
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
        sides: "lr",
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
        sides: "lr",
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
        sides: "lr",
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
      ...ankleSubTests({ key: "eversion", question: "seated eversion (rolling in)", noun: "eversion" }),
      ...ankleSubTests({ key: "inversion", question: "seated inversion (rolling out)", noun: "inversion" }),
    ],
  },
  {
    // The same procedure as Ankle Rocking, applied to tibial rotation.
    key: "ankle-rolling",
    label: "Ankle Rolling Test",
    group: "stride",
    subTests: [
      ...ankleSubTests({
        key: "lateral",
        question: "seated lateral (turning out) tibial rotation",
        noun: "lateral rotation",
      }),
      ...ankleSubTests({
        key: "medial",
        question: "seated medial (turning in) tibial rotation",
        noun: "medial rotation",
      }),
    ],
  },
  {
    key: "half-kneeling",
    label: "Half-Kneeling Narrow Base",
    group: "posture",
    subTests: [
      {
        /*
         * One question, nothing branching off it. Graded once, with which
         * knee was down living in the answer rather than in a per-side grade.
         */
        key: "stability",
        label: "How was their half-kneeling stability?",
        findings: [
          { key: "stable", label: "Stable bilaterally", normal: true, severity: "green" },
          /*
           * No yellow on this test. Stable on both sides or not — one knee,
           * both knees and unable to get there all grade the same. It is the
           * only test on the screen with no middle ground, so the absence is
           * deliberate rather than a mapping still to be filled in.
           */
          { key: "unstable-right", label: "Unstable with the right knee down", severity: "red" },
          { key: "unstable-left", label: "Unstable with the left knee down", severity: "red" },
          { key: "unstable-bilateral", label: "Unstable bilaterally", severity: "red" },
          { key: "unable", label: "Unable to get into position", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "lunge-extension",
    label: "Lunge w/ Extension Test",
    group: "posture",
    subTests: [
      {
        /*
         * Graded dominant and non-dominant rather than left and right, because
         * handedness changes what this movement should look like.
         *
         * Not a gate: both questions are asked on both sides. The four answers
         * grade the quality of the position, not whether they reached it.
         */
        key: "starting-position",
        label: "Could they get into their starting position?",
        sides: "dominance",
        findings: [
          { key: "good", label: "Good starting position", normal: true, severity: "green" },
          { key: "limited-stride", label: "Limited stride", severity: "yellow" },
          { key: "limited-shoulder", label: "Limited shoulder flexion", severity: "yellow" },
          { key: "limited-both", label: "Limited stride and shoulders", severity: "red" },
        ],
      },
      {
        key: "extension",
        label: "How was their lunge with extension?",
        sides: "dominance",
        findings: [
          { key: "good", label: "Good spine or hip extension (past mid-knee)", normal: true, severity: "green" },
          { key: "limited", label: "Limited spine or hip extension", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "wide-squat",
    label: "Wide Squat Test",
    group: "posture",
    subTests: [
      {
        /*
         * A gate. A good squat is not green on its own — it earns the second
         * question, which is where the colour comes from. A limited squat
         * fails outright and there is nothing further to ask.
         */
        key: "arms-front",
        label: "How was their wide squat with arms out front?",
        help: "Feet shoulder width, toes straight ahead, arms out in front. Descend as deeply as possible with the heels down and the chest forward, looking for the thighs to break parallel.",
        findings: [
          { key: "good", label: "Good squat", normal: true },
          { key: "limited", label: "Limited squat", severity: "red" },
        ],
      },
      {
        key: "arms-down",
        label: "How was the squat when lowering the arms?",
        dependsOn: { subTest: "arms-front", findings: ["good"] },
        help: "From the bottom of the squat, lower the fists towards the floor inside the footprint and hold without losing control.",
        findings: [
          { key: "maintained", label: "Maintained stable squat when lowering arms", normal: true, severity: "green" },
          { key: "lost", label: "Loses stable squat when lowering arms", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "shoulder-90-90",
    label: "Shoulder 90/90",
    group: "arms",
    subTests: [
      {
        // Left and right rather than dominant and non-dominant: the app asks
        // it per shoulder, and how much weight to give the non-throwing side
        // is a reading of the result, not part of recording it.
        key: "external-rotation",
        label: "How far does the shoulder externally rotate?",
        sides: "lr",
        findings: [
          { key: "greater", label: "Greater than spine angle", normal: true, severity: "green" },
          { key: "equal", label: "Equal to spine angle", severity: "yellow" },
          { key: "less", label: "Less than spine angle", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "windshield-wiper",
    label: "Windshield Wiper Test",
    group: "arms",
    subTests: [
      {
        // The same movement measured two ways, each shoulder, so four
        // readings. Neither position gates the other.
        key: "arm-front",
        label: "How far does the shoulder internally rotate with the arm out front?",
        sides: "lr",
        findings: [
          { key: "gte-90", label: "Equal to or greater than 90\u00b0", normal: true, severity: "green" },
          { key: "lt-90", label: "Less than 90\u00b0", severity: "red" },
        ],
      },
      {
        key: "arm-side",
        label: "How far does the shoulder internally rotate with the arm out to the side?",
        sides: "lr",
        findings: [
          { key: "gte-90", label: "Equal to or greater than 90\u00b0", normal: true, severity: "green" },
          { key: "lt-90", label: "Less than 90\u00b0", severity: "red" },
        ],
      },
    ],
  },
  {
    key: "forearm-80-80",
    label: "Forearm 80/80 Test",
    group: "arms",
    subTests: [
      {
        // Two movements, each forearm, so four readings. Same questions on
        // both sides — the side comes from the column, not the wording.
        key: "supination",
        label: "How far does the forearm supinate?",
        sides: "lr",
        findings: [
          { key: "gte-80", label: "80\u00b0 or more of supination", normal: true, severity: "green" },
          { key: "lt-80", label: "Less than 80\u00b0 of supination", severity: "red" },
        ],
      },
      {
        key: "pronation",
        label: "How far does the forearm pronate?",
        sides: "lr",
        findings: [
          { key: "gte-80", label: "80\u00b0 or more of pronation", normal: true, severity: "green" },
          { key: "lt-80", label: "Less than 80\u00b0 of pronation", severity: "red" },
        ],
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

/**
 * Some tests are graded twice. Usually that is left and right — but Lunge with
 * Extension is graded dominant and non-dominant, because handedness changes
 * what the movement should look like.
 *
 * Stored as its own vocabulary rather than resolved to a side through the
 * athlete's throwing hand: a screen has to keep meaning what it meant if that
 * hand is later corrected in the profile.
 */
export const SIDE_SETS = {
  lr: [
    { key: "L", label: "Left" },
    { key: "R", label: "Right" },
  ],
  dominance: [
    { key: "D", label: "Dominant" },
    { key: "N", label: "Non-dominant" },
  ],
} as const;

export type SideSet = keyof typeof SIDE_SETS;
export type Side = string;

/** The sides a sub-test is graded on, or an empty list if graded once. */
export function sidesOf(subTest: SubTest): readonly { key: string; label: string }[] {
  return subTest.sides ? SIDE_SETS[subTest.sides] : [];
}

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
      const sides = sidesOf(subTest);
      if (sides.length)
        for (const side of sides)
          out.push({ key: fieldKey(test.key, subTest.key, side.key), test, subTest, side: side.key });
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

/**
 * Fill every blank, applicable reading with its normal finding.
 *
 * What "all normal" means on a screen a coach actually ran. It repeats,
 * because answering a gate normally OPENS the branch beneath it — a good wide
 * squat earns the arms-down question — and a single pass would leave the
 * newly-opened readings blank while claiming the test was complete.
 *
 * Sub-tests with no normal answer are left alone. The ankle follow-ups are
 * the case: you only reach them because something was limited, so there is no
 * normal to assert. They are unreachable from a normal gate anyway, and this
 * skips them rather than relying on that staying true.
 */
export function fillNormal(results: Results, tests: ScreenTest[] = SCREEN_TESTS): Results {
  const out = { ...results };
  const fields = screenFields(tests);
  // Each pass that changes anything fills at least one field, so this ends.
  for (let pass = 0; pass <= fields.length; pass++) {
    let changed = false;
    for (const field of fields) {
      if (out[field.key] || field.subTest.diagnostic) continue;
      if (!isApplicable(field, out)) continue;
      const normal = field.subTest.findings.find((x) => x.normal);
      if (!normal) continue;
      out[field.key] = normal.key;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
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
  /** Was a deviation last time, and was re-screened clean. */
  resolved: Deviation[];
  /** Still a deviation, though the finding itself may have moved. */
  persisting: { field: Field; before: Finding; after: Finding }[];
  /** Wasn't a deviation last time, is now. */
  appeared: Deviation[];
  /** Was a deviation last time and nobody looked this time. */
  unchecked: Deviation[];
}

/**
 * What changed between two screens. `persisting` keeps both findings rather
 * than collapsing to "still bad": Pelvic Tilt going from Both Limited to Hard
 * Time Arching Back is real progress, and a comparison that only asked
 * "normal or not" would report no change at all.
 *
 * A reading that was a deviation and is now BLANK is `unchecked`, not
 * resolved. Nothing was observed, and telling an athlete he has fixed
 * something nobody re-tested is the one lie a re-screen must not tell. A
 * reading whose branch has closed does count as resolved — the gate above it
 * came back clean, so the follow-up genuinely no longer applies.
 */
export function compareScreens(
  before: Results,
  after: Results,
  tests: ScreenTest[] = SCREEN_TESTS,
): ScreenChange {
  const change: ScreenChange = {
    resolved: [],
    persisting: [],
    appeared: [],
    unchecked: [],
  };
  const dev = (r: Results, field: Field): Finding | null => {
    if (!isApplicable(field, r)) return null;
    const finding = findingFor(field, r);
    return finding && !finding.normal ? finding : null;
  };
  for (const field of screenFields(tests)) {
    const b = dev(before, field);
    const a = dev(after, field);
    if (b && a) change.persisting.push({ field, before: b, after: a });
    else if (b && !a) {
      // Cleared, or simply not looked at — see the note above.
      const looked = !isApplicable(field, after) || !!findingFor(field, after);
      (looked ? change.resolved : change.unchecked).push({ field, finding: b });
    } else if (!b && a) change.appeared.push({ field, finding: a });
  }
  return change;
}

/* ------------------------------------------------------------------ *
 * Reading a screen back
 *
 * The panel is a work list, not a report card. It leads with what to do
 * something about, and it says what moved since last time — because the
 * second screen is the one that tells an athlete whether the work worked.
 * ------------------------------------------------------------------ */

/** How one reading moved between screens. */
export type Trend = "new" | "improved" | "worsened" | "changed" | "unchanged";

/**
 * A test's headline. Distinct from `TestMark` in two ways that matter to the
 * ordering: a test carrying deviations nobody has graded is `ungraded` rather
 * than nothing, and a test nobody ran is `skipped` rather than clean.
 */
export type ReportStatus = "alert" | "red" | "yellow" | "ungraded" | "clean" | "skipped";

export interface ReportReading {
  field: Field;
  finding: Finding;
  /** What this reading said last screen, when it was a deviation then too. */
  before?: Finding;
  /** Null when there is no previous screen to compare against. */
  trend: Trend | null;
}

export interface TestReport {
  test: ScreenTest;
  mark: TestMark | null;
  status: ReportStatus;
  /** Deviations standing now, in sheet order — the work. */
  work: ReportReading[];
  /** Deviations last screen that came back clean. */
  cleared: Deviation[];
  /** Deviations last screen that nobody re-screened. */
  unchecked: Deviation[];
  recorded: number;
  asked: number;
}

/** Where a finding sits on the scale, or null when it carries no colour. */
function rankOf(finding: Finding): number | null {
  if (finding.alert) return 4;
  if (finding.severity) return RANK[finding.severity] + 1;
  return null;
}

/**
 * Two findings that both lack a colour, or that differ without moving on the
 * scale, are "changed" rather than better or worse. Claiming a direction the
 * mapping doesn't support is how a work list turns into a horoscope.
 */
function trendOf(before: Finding | undefined, after: Finding): Trend {
  if (!before) return "new";
  if (before.key === after.key) return "unchanged";
  const b = rankOf(before);
  const a = rankOf(after);
  if (b == null || a == null) return "changed";
  if (a < b) return "improved";
  if (a > b) return "worsened";
  return "changed";
}

const STATUS_ORDER: Record<ReportStatus, number> = {
  alert: 5,
  red: 4,
  yellow: 3,
  ungraded: 2,
  clean: 1,
  skipped: 0,
};

/**
 * Every test, worst first, with what changed since the previous screen.
 *
 * Sorted by status rather than by the config order the coach screens in: the
 * point of the panel is that the first thing on it is the first thing to work
 * on. Ties keep sheet order, so the list doesn't reshuffle between screens
 * for no reason.
 */
export function screenReport(
  results: Results,
  previous: Results | null = null,
  tests: ScreenTest[] = SCREEN_TESTS,
): TestReport[] {
  const change = previous ? compareScreens(previous, results, tests) : null;
  const byTest = (list: Deviation[] | undefined, key: string) =>
    (list ?? []).filter((d) => d.field.test.key === key);
  const priorFinding = new Map<string, Finding>();
  for (const d of change?.persisting ?? [])
    priorFinding.set(d.field.key, d.before);

  const reports = tests.map((test): TestReport => {
    const counts = screenCounts(results, [test]);
    const recorded = counts.normal + counts.deviation + counts.notTested;
    const asked = recorded + counts.blank;
    const mark = testMark(test, results);
    const work = deviations(results, [test]).map(
      ({ field, finding }): ReportReading => {
        const before = priorFinding.get(field.key);
        return {
          field,
          finding,
          ...(before ? { before } : {}),
          trend: previous ? trendOf(before, finding) : null,
        };
      },
    );

    let status: ReportStatus;
    if (counts.normal + counts.deviation === 0) status = "skipped";
    else if (mark === "alert" || mark === "red" || mark === "yellow") status = mark;
    else if (work.length) status = "ungraded";
    else status = "clean";

    return {
      test,
      mark,
      status,
      work,
      cleared: byTest(change?.resolved, test.key),
      unchecked: byTest(change?.unchecked, test.key),
      recorded,
      asked,
    };
  });

  return reports
    .map((r, i) => ({ r, i }))
    .sort(
      (x, y) =>
        STATUS_ORDER[y.r.status] - STATUS_ORDER[x.r.status] || x.i - y.i,
    )
    .map(({ r }) => r);
}

/** Where a status sorts — worst first. Exported so a roster can share it. */
export function statusRank(status: ReportStatus): number {
  return STATUS_ORDER[status];
}

export interface ScreenSummary {
  /** The worst standing status on the screen. */
  worst: ReportStatus;
  /** Tests with something to work on. */
  work: number;
  /** Their keys, so a caller can date them without rebuilding the report. */
  failing: string[];
  /** Sided readings whose two sides disagree. */
  asymmetries: number;
  /** Tests flagged painful — counted separately, since pain isn't a rank. */
  painful: number;
  clean: number;
  skipped: number;
}

/**
 * One screen reduced to a line on a roster.
 *
 * `worst` comes off the head of the report rather than being recomputed,
 * so a row's dot and the panel it opens can never disagree about which
 * finding is the worst one.
 */
export function screenSummary(
  results: Results,
  tests: ScreenTest[] = SCREEN_TESTS,
): ScreenSummary {
  const reports = screenReport(results, null, tests);
  return {
    worst: reports[0]?.status ?? "skipped",
    work: reports.filter((r) => r.work.length).length,
    failing: reports.filter((r) => r.work.length).map((r) => r.test.key),
    asymmetries: asymmetries(results, tests).length,
    painful: reports.filter((r) => r.status === "alert").length,
    clean: reports.filter((r) => r.status === "clean").length,
    skipped: reports.filter((r) => r.status === "skipped").length,
  };
}

/* ------------------------------------------------------------------ *
 * Side to side
 *
 * In a rotational, single-side-dominant sport a lead-hip vs trail-hip or
 * dominant vs non-dominant gap says more than any one reading. Two shoulders
 * that both screen yellow are a different athlete from one that screens green
 * and one that screens red, and the worst-of roll-up reports both as yellow.
 *
 * So this reads the sides against each other rather than against the scale,
 * and the question it exists to answer is whether the gap is closing.
 * ------------------------------------------------------------------ */

export interface Asymmetry {
  test: ScreenTest;
  subTest: SubTest;
  /** Both sides, in the order the config declares them. */
  sides: { side: string; label: string; finding: Finding }[];
  /** Distance on the colour scale. Null when either side carries no colour. */
  gap: number | null;
  /** The side that came off worse, or null when they rank level. */
  worseSide: string | null;
}

/**
 * Every sided reading whose two sides disagree.
 *
 * Disagreement is by FINDING, not by colour: two different answers that
 * happen to share a colour are still two different answers, and flattening
 * them to "both yellow" is the roll-up mistake this exists to avoid. `gap`
 * then measures how far apart they are, which can be zero.
 */
export function asymmetries(
  results: Results,
  tests: ScreenTest[] = SCREEN_TESTS,
): Asymmetry[] {
  const out: Asymmetry[] = [];
  for (const test of tests) {
    for (const subTest of test.subTests) {
      const sideSet = sidesOf(subTest);
      if (!sideSet.length) continue;

      const read = sideSet
        .map((s) => {
          const field: Field = {
            key: fieldKey(test.key, subTest.key, s.key),
            test,
            subTest,
            side: s.key,
          };
          if (!isApplicable(field, results)) return null;
          const finding = findingFor(field, results);
          return finding ? { side: s.key, label: s.label, finding } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      /*
       * One side missing is not a symmetry and not an asymmetry — it's a gap
       * in the record, and claiming either would be inventing a reading.
       *
       * Belt and braces: the equality check below already drops a single
       * reading, since one finding always matches itself. Kept because the
       * rank comparison further down indexes both sides and would otherwise
       * depend on that coincidence holding.
       */
      if (read.length < 2) continue;
      if (read.every((r) => r.finding.key === read[0].finding.key)) continue;

      const ranks = read.map((r) => rankOf(r.finding));
      const rankable = ranks.every((r): r is number => r !== null);
      const gap = rankable ? Math.max(...ranks) - Math.min(...ranks) : null;
      const worseSide =
        rankable && ranks[0] !== ranks[1]
          ? read[ranks[0] > ranks[1] ? 0 : 1].side
          : null;

      out.push({ test, subTest, sides: read, gap, worseSide });
    }
  }
  return out;
}

/** How a side-to-side gap moved. */
export type GapTrend = "new" | "narrowed" | "widened" | "unchanged" | "changed";

export interface AsymmetryReport {
  standing: (Asymmetry & { trend: GapTrend | null; beforeGap: number | null })[];
  /** Sides that disagreed last check and read level now. */
  closed: Asymmetry[];
}

/**
 * Side-to-side gaps, and whether they are closing.
 *
 * A gap that closed no longer appears in `standing` — it isn't an asymmetry
 * any more — so it gets its own list. That is the one an athlete doing the
 * corrective work most wants to see, and dropping it would hide the payoff.
 */
export function asymmetryReport(
  results: Results,
  previous: Results | null = null,
  tests: ScreenTest[] = SCREEN_TESTS,
): AsymmetryReport {
  const now = asymmetries(results, tests);
  const before = previous ? asymmetries(previous, tests) : [];
  const key = (a: Asymmetry) => `${a.test.key}.${a.subTest.key}`;
  const beforeBy = new Map(before.map((a) => [key(a), a]));
  const nowKeys = new Set(now.map(key));

  return {
    standing: now.map((a) => {
      const was = beforeBy.get(key(a));
      if (!previous) return { ...a, trend: null, beforeGap: null };
      if (!was) return { ...a, trend: "new" as GapTrend, beforeGap: null };
      if (a.gap === null || was.gap === null)
        return { ...a, trend: "changed" as GapTrend, beforeGap: was.gap };
      const trend: GapTrend =
        a.gap < was.gap ? "narrowed" : a.gap > was.gap ? "widened" : "unchanged";
      return { ...a, trend, beforeGap: was.gap };
    }),
    closed: before.filter((a) => !nowKeys.has(key(a))),
  };
}

/* ------------------------------------------------------------------ *
 * The standing picture
 *
 * A screen stopped being the whole story the moment spot-checks existed. If
 * a coach rechecks three tests at four weeks, the other fourteen did not stop
 * being true — they were simply not looked at that day. So what an athlete
 * "has" is assembled per TEST from the most recent screen that covered it,
 * not read off the latest row.
 *
 * Per test rather than per reading, deliberately: you retest a test, not a
 * field. Merging field by field would pair a fresh right hip with a stale
 * left one and call the asymmetry between them real.
 * ------------------------------------------------------------------ */

/** Did this screen actually look at this test? */
export function covers(results: Results, test: ScreenTest): boolean {
  return screenFields([test]).some((f) => findingFor(f, results) !== null);
}

/**
 * A screen that looked at everything — the kind the quarterly clock counts.
 *
 * "Not tested" doesn't count as looking. It is the coach saying they skipped
 * it, which is exactly the thing a full screen isn't.
 */
export function isFullScreen(results: Results, tests: ScreenTest[] = SCREEN_TESTS): boolean {
  return tests.every((t) => covers(results, t));
}

export interface Standing {
  /** Latest readings, per test, assembled across screens. */
  results: Results;
  /** The readings each test held before those. */
  previous: Results;
  /** testKey → the date its current readings came from. */
  from: Record<string, string>;
  /** testKey → the date the previous readings came from. */
  previousFrom: Record<string, string>;
  /** The most recent screen that covered every test. */
  lastFull: string | null;
  /** The most recent screen of any kind. */
  last: string | null;
}

export function standingScreen(
  screens: { date: string; results: Results }[],
  tests: ScreenTest[] = SCREEN_TESTS,
): Standing {
  const standing: Standing = {
    results: {},
    previous: {},
    from: {},
    previousFrom: {},
    lastFull: null,
    last: null,
  };
  const ordered = [...screens].sort((a, b) => a.date.localeCompare(b.date));

  for (const screen of ordered) {
    standing.last = screen.date;
    if (isFullScreen(screen.results, tests)) standing.lastFull = screen.date;

    for (const test of tests) {
      // A screen that skipped this test leaves what was already known alone.
      if (!covers(screen.results, test)) continue;
      for (const field of screenFields([test])) {
        const held = standing.results[field.key];
        if (held !== undefined) standing.previous[field.key] = held;
        else delete standing.previous[field.key];
        const fresh = screen.results[field.key];
        if (fresh !== undefined) standing.results[field.key] = fresh;
        else delete standing.results[field.key];
      }
      if (standing.from[test.key])
        standing.previousFrom[test.key] = standing.from[test.key];
      standing.from[test.key] = screen.date;
    }
  }
  return standing;
}

/* ------------------------------------------------------------------ *
 * When to screen again
 *
 * Cole's cadence, and it is two clocks rather than one.
 *
 * The full sheet runs quarterly — 8-12 weeks lines up with training phases
 * and gives adaptation time; running seventeen tests more often than that is
 * chasing noise. What moves faster is the corrective work, so the tests an
 * athlete actually failed get spot-checked at 3-4 weeks alongside it. That
 * is the feedback loop: confirming the intervention is working without
 * re-running the whole battery.
 *
 * The two are independent. An athlete can be mid-quarter and still overdue a
 * spot-check, which is the common case and the whole point.
 * ------------------------------------------------------------------ */

export type RetestKind = "full" | "spot";

/** Not yet, inside the window, or past the end of it. */
export type DueState = "not-due" | "due" | "overdue";

export const RETEST_CADENCE: Record<RetestKind, { from: number; to: number }> = {
  full: { from: 56, to: 84 },
  spot: { from: 21, to: 28 },
};

export interface RetestDue {
  kind: RetestKind;
  state: DueState;
  from: number;
  to: number;
  /** Days since the screen this clock runs from; null when there isn't one. */
  days: number | null;
  /** The date it runs from. */
  since: string | null;
  /** What this retest would cover. */
  tests: ScreenTest[];
}

function dueState(kind: RetestKind, days: number | null): DueState {
  const { from, to } = RETEST_CADENCE[kind];
  // Never done is not "not yet" — it is the most overdue thing there is.
  if (days === null) return "overdue";
  return days < from ? "not-due" : days <= to ? "due" : "overdue";
}

/**
 * One clock, from the date it runs from.
 *
 * Split out so a roster can recompute against the viewer's own `today`. The
 * server ships the dates; the elapsed days are worked out in the browser, so
 * a coach who has travelled isn't reading yesterday's answer.
 */
export function retestState(
  kind: RetestKind,
  since: string | null,
  today: string,
): Omit<RetestDue, "tests"> {
  const days = since === null ? null : daysBetween(since, today);
  return { kind, state: dueState(kind, days), ...RETEST_CADENCE[kind], days, since };
}

/**
 * Both clocks for one athlete.
 *
 * The spot clock runs from the OLDEST of the failing tests, not the newest.
 * Rechecking the 90/90 a fortnight ago says nothing about a thoracic rotation
 * nobody has touched in six weeks, and taking the newest date would let the
 * one you just did hide the one you haven't.
 */
export function retestPlan(
  standing: Standing,
  today: string,
  tests: ScreenTest[] = SCREEN_TESTS,
): { full: RetestDue; spot: RetestDue | null } {
  const full: RetestDue = {
    ...retestState("full", standing.lastFull, today),
    tests,
  };

  const failing = screenReport(standing.results, null, tests)
    .filter((r) => r.work.length)
    .map((r) => r.test);
  if (!failing.length) return { full, spot: null };

  const dated = failing
    .map((t) => standing.from[t.key])
    .filter((d): d is string => !!d)
    .sort();
  const since = dated[0] ?? null;

  return { full, spot: { ...retestState("spot", since, today), tests: failing } };
}

/** Where a due state sorts on the roster — most pressing first. */
export function dueRank(state: DueState): number {
  return state === "overdue" ? 2 : state === "due" ? 1 : 0;
}

/**
 * Which of an athlete's two clocks speaks for them.
 *
 * The more pressing state wins. On a tie it is whichever opens sooner — an
 * athlete five days into a spot-check window is nearer a spot-check than a
 * full screen, and reporting the quarterly clock because it is the bigger job
 * tells them about the thing that ISN'T next.
 */
export function leadClock<T extends { state: DueState; days: number | null; from: number }>(
  full: T,
  spot: T | null,
): T {
  if (!spot) return full;
  const rank = dueRank(spot.state) - dueRank(full.state);
  if (rank !== 0) return rank > 0 ? spot : full;
  // Days until the window opens; already-open clocks go negative, which is
  // the right direction — more overdue is more pressing.
  const opens = (c: T) => (c.days === null ? -Infinity : c.from - c.days);
  return opens(spot) <= opens(full) ? spot : full;
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
