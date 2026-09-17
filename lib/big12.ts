/* ------------------------------------------------------------------ *
 * The Big 12
 *
 * OnBaseU's twelve delivery inefficiencies. The app already holds the other
 * half of that model, the physical movement screen, and OnBaseU's whole
 * method is that a physical limitation EXPLAINS a mechanical flaw. Both
 * halves land on the same record because Cole assesses them in one session.
 *
 * `causes` is RANKED. Index 0 is what Cole's source calls foremost, which is
 * not always the first one it lists. Some flaws touch ten of the sixteen
 * tests, and a flat list would print five explanations every time, which
 * says as much as printing none.
 *
 * A cause with no tests is KEPT. It is a cause OnBaseU names that this screen
 * cannot measure, and the honest record of that belongs here rather than in
 * someone's memory. Leg strength and power is named by six of the twelve and
 * has no screen test at all.
 *
 * `key` reaches the database and must never change. Everything else is copy.
 * ------------------------------------------------------------------ */

/** Which side of the body a cause is about, where the test can say. */
export type CauseSide = "front" | "back" | "throwing";

export interface Cause {
  /** Cole's own wording. Becomes the heading the report shows. */
  label: string;
  /** Screen test keys. Empty means the screen cannot answer this one. */
  tests: string[];
  side?: CauseSide;
}

export interface Flaw {
  key: string;
  label: string;
  description: string;
  /** The video procedure, so a coach can grade without the manual open. */
  howToSpot: string;
  causes: Cause[];
  /** Other flaw keys that can drive this one. Ranked. */
  causedBy?: string[];
}

export const BIG_12: Flaw[] = [
  {
    key: "sway",
    label: "Sway",
    description:
      "The head or body drifts away from the hitter during the leg lift. Posture looks different from one pitcher to the next, but it should hold from the first move to release, and a sway costs balance for everything after it. Stance is often the cause. Too wide and the head counterbalances toward second base, too narrow and it goes toward first, and an open or square stance can push the head back. Normally the back toe lines up with the middle of the front foot's arch.",
    howToSpot:
      "Film face-on. Freeze at the start of the pivot and draw a vertical line up from the inside of the back knee, past the head. Play forward to max leg lift. If the head or body has moved farther from the hitter, that's a sway.",
    causes: [
      { label: "Backside hip rotation", tests: ["hip-45", "toe-tap"], side: "back" },
      { label: "Backside ankle mobility", tests: ["ankle-rolling"], side: "back" },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Lower body stability", tests: ["side-step-walkout", "half-kneeling"] },
      { label: "Front side hip flexion", tests: [], side: "front" },
    ],
  },
  {
    key: "hanging-back",
    label: "Hanging Back",
    description:
      "He stays over the back foot instead of moving at the hitter. Lifting the stride leg should start him going right away. Hanging back is drifting away from the plate, staying straight up through the lift, or stopping at the top. Plenty of young pitchers are taught that pause, and it is not what the best big league pitchers do. They get from first move to front foot down in about a second, and hanging back stretches that out.",
    howToSpot:
      "Film face-on. At the pivot, draw a vertical line just outside the front hip. Play forward to max leg lift. The front hip should have crossed that line toward the hitter. If it hasn't, he's hanging back.",
    causes: [
      { label: "Hip mobility and stability", tests: ["hip-45", "toe-tap"] },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Backside ankle mobility", tests: ["ankle-rolling"], side: "back" },
      { label: "Leg strength and power", tests: [] },
      { label: "Front side hip flexion", tests: [], side: "front" },
    ],
  },
  {
    key: "closing-front-side",
    label: "Closing the Front Side",
    description:
      "The trunk and pelvis should stay roughly parallel to each other through the pitch. Closing the front side is breaking that by tilting one of them sideways, usually as the stride leg lifts. It costs balance and posture. Closing the back side is the same fault the other way, and it is not a problem unless it is extreme. If you see an extreme one, put it in the notes.",
    howToSpot:
      "Film face-on and stop at the bottom of the arm circle. Draw one line along the shoulders and another along the pelvis. Lines converging toward the hitter is closing the front side. Converging toward second base is closing the back side.",
    causes: [
      { label: "Spine and hip mobility", tests: ["hip-45", "pelvic-tilt", "wide-squat", "lunge-extension"] },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Hip and core stability", tests: ["half-kneeling", "side-step-walkout", "toe-tap", "wide-squat"] },
      { label: "Ankle plantarflexion", tests: ["heel-lift"] },
      { label: "Shoulder mobility", tests: ["lunge-extension"] },
    ],
  },
  {
    key: "getting-out-in-front",
    label: "Getting Out In Front",
    description:
      "The trunk or head gets ahead of the lower body too early, so the head moves at the plate before the body is ready. It usually means he isn't loading into the back hip, or isn't separating trunk from pelvis, and it costs a lot of velocity.",
    howToSpot:
      "Film face-on and go all the way to foot touch. Draw a vertical line centered on his head. Compare his belt buckle to that line. Buckle behind the line means he's out in front.",
    causes: [
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Thorax mobility and spine extension", tests: ["lunge-extension", "seated-trunk-rotation"] },
      { label: "Hip mobility and stability", tests: ["hip-45", "toe-tap"] },
      { label: "Leg strength and power", tests: [] },
    ],
  },
  {
    key: "late-riser",
    label: "Late Riser",
    description:
      "The throwing hand is still below the throwing elbow at foot touch. Most pitchers have the hand above the elbow by then, and that puts less stress on the elbow.",
    howToSpot:
      "Film face-on and stop at foot touch. Draw a horizontal line through the throwing elbow. Hand still below that line means he's a late riser.",
    causes: [
      { label: "Back shoulder external rotation", tests: ["shoulder-90-90"], side: "throwing" },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Spine extension", tests: ["lunge-extension"] },
      { label: "Back scapular stability", tests: [], side: "throwing" },
    ],
  },
  {
    key: "flying-open",
    label: "Flying Open",
    description:
      "The torso starts turning too early, which kills the separation between torso and pelvis. Just after foot touch you want the biggest gap between the two, normally 40 to 60 degrees. It doesn't matter whether he gets there with a big hip turn or a big shoulder turn, only that he gets there. Starting the torso before he's 70 percent of the way through his stride is flying open.",
    howToSpot:
      "Overhead with a drone is easiest, but the back view or down the line works. Go to foot touch and draw a line across the shoulders. If the shoulders start to unwind any time before foot touch, he's flying open.",
    causes: [
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Thorax mobility", tests: ["seated-trunk-rotation", "lunge-extension"] },
      { label: "Hip mobility and stability", tests: ["hip-45", "toe-tap"] },
      { label: "Shoulder mobility and stability", tests: [], side: "throwing" },
      { label: "Leg strength and power", tests: [] },
    ],
    causedBy: ["short-stride"],
  },
  {
    key: "early-extension",
    label: "Early Extension",
    description:
      "The hips start to extend, or the pelvis thrusts toward the third base line, before the front foot lands. The upper body lifts or tilts back to keep him balanced, and the posture goes. Pitchers often describe this as stepping closed or being off line off the mound. The arm ends up slinging across the body, because the body is in the way of it.",
    howToSpot:
      "Film from second base, down the line. In the stance, draw a vertical line over the back ankle, then go all the way to foot plant. The best pitchers keep the back hip sitting deep behind that line. If the pelvis moves in front of it, he early extended.",
    causes: [
      { label: "Backside hip mobility and stability", tests: ["hip-45", "toe-tap"], side: "back" },
      { label: "Backside ankle mobility", tests: ["ankle-rolling"], side: "back" },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
      { label: "Leg strength and power", tests: [] },
      { label: "Front side hip flexion", tests: [], side: "front" },
    ],
  },
  {
    key: "short-stride",
    label: "Short Stride",
    description:
      "A stride shorter than the distance from the top of his shoulder to the ground, which is roughly 5 to 6 of his own foot lengths. Distance is worth real velocity: a foot closer to the plate is about 3.5 mph to the hitter's eye.",
    howToSpot:
      "Film face-on and stop at foot plant. Measure from the front of the rubber to the toe of the lead foot. It should be at least 110 percent of his height standing tall. The best in the game are over 120 percent on video.",
    causes: [
      { label: "Hip mobility", tests: ["hip-45", "toe-tap", "wide-squat", "lunge-extension"] },
      { label: "Spine extension", tests: ["lunge-extension"] },
      { label: "Ankle plantarflexion", tests: ["heel-lift", "push-off"] },
      { label: "Ankle eversion", tests: ["ankle-rolling", "push-off"] },
      { label: "Lower limb reciprocal pattern", tests: ["lunge-extension", "half-kneeling"] },
      { label: "Balance", tests: ["heel-lift", "half-kneeling"] },
      { label: "Core and lower body stability", tests: ["half-kneeling", "side-step-walkout", "wide-squat", "toe-tap"] },
      { label: "Leg strength and power", tests: [] },
    ],
  },
  {
    key: "collapsing-front-knee",
    label: "Collapsing Front Knee",
    description:
      "The front knee keeps bending after foot plant. The most it bends should be at foot plant, and how much varies a lot: some pitchers are near 90 degrees and some barely bend at all. Either is fine. What matters is that it stops there, because a knee that keeps folding bleeds off the energy heading into the upper body.",
    howToSpot:
      "Film face-on. At foot plant, measure the front knee angle, then step slowly through to release. If the angle gets smaller at any point, he's collapsing. The best ones actually straighten it on the way to release.",
    causes: [
      { label: "Front side hip internal rotation", tests: ["hip-45", "toe-tap"], side: "front" },
      { label: "Lower body stability", tests: ["half-kneeling", "side-step-walkout", "wide-squat", "toe-tap"] },
      { label: "Tibia rotation", tests: [], side: "front" },
      { label: "Front side ankle mobility", tests: ["heel-lift", "ankle-rocking", "ankle-rolling"], side: "front" },
      { label: "Balance", tests: ["heel-lift", "half-kneeling"], side: "front" },
    ],
  },
  {
    key: "high-hand",
    label: "High Hand",
    description:
      "The throwing hand stays above the throwing elbow the whole way. Normally it drops to level with the elbow or below as the shoulder externally rotates into layback.",
    howToSpot:
      "Film face-on, or down the line. Go to maximum external rotation and draw a horizontal line through the elbow. If the ball is entirely above that line, he has a high hand.",
    causes: [
      { label: "Back shoulder external rotation", tests: ["shoulder-90-90"], side: "throwing" },
      { label: "Spine extension", tests: ["lunge-extension"] },
      { label: "Leg strength and power", tests: [] },
      { label: "Elbow mobility and stability", tests: ["forearm-80-80"], side: "throwing" },
      { label: "Back scapular stability", tests: [], side: "throwing" },
    ],
  },
  {
    key: "early-flexion",
    label: "Early Flexion",
    description:
      "Coming out of cocking into acceleration, the trunk should stay tall with a big arch in the lower back. As the arm uncocks and extends, the lower back flattens and the trunk folds forward to help the arm along. Early flexion is folding forward too soon, back in late cocking.",
    howToSpot:
      "Film face-on and go to maximum external rotation. The lower back should stay arched until the throwing hand reaches his ear. If it flattens early and the trunk tips forward before that, he has early flexion.",
    causes: [
      { label: "Spine extension", tests: ["pelvic-tilt", "lunge-extension"] },
      { label: "Front hip flexion", tests: [], side: "front" },
      { label: "Lower limb reciprocal pattern", tests: ["lunge-extension", "half-kneeling"] },
      { label: "Spine disassociation", tests: ["pelvic-rotation", "seated-trunk-rotation"] },
    ],
  },
  {
    key: "early-release",
    label: "Early Release",
    description:
      "He lets go of the ball too early. The release point ends up back behind where it should be, so the ball travels farther and the hitter gets longer to read it. Normally release is 8 to 12 inches in front of the big toe of the landing foot, about a quarter to a third of a second after the front foot lands. This one is usually a by-product of the other faults rather than its own problem, so look at what else is marked before working on it directly.",
    howToSpot:
      "Film face-on and stop at release. Draw a vertical line up from the front toe and measure from the hand to the line. The best in the world are 8 to 12 inches in front of it. Releasing behind that line is an early release.",
    causes: [],
    causedBy: ["short-stride", "high-hand", "early-extension"],
  },
];

/** Lookup by key, for reading a stored mark back. */
export function flawByKey(key: string): Flaw | undefined {
  return BIG_12.find((f) => f.key === key);
}

/** Every key that may be stored, for validation. */
export const FLAW_KEYS: ReadonlySet<string> = new Set(BIG_12.map((f) => f.key));
