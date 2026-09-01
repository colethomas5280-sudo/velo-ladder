import type {
  RecoveryEntry,
  Setback,
  SetbackKind,
  TrainingSession,
  TrackerId,
} from "./types";
import { TRACKERS, daysBetween, sBestG, shiftDate, todayISO } from "./velo";

/* ------------------------------------------------------------------ *
 * Setback logic
 *
 * Three branches, from Cole's protocol:
 *
 *   soreness — athlete reports a sore arm. Expected after max-effort work,
 *              NOT a warning. Escalates only if it runs into a third day.
 *   cns      — a max-intent session lands materially below the athlete's own
 *              trailing 30-day average. Objective on purpose: athletes often
 *              feel fine right before a low-velo day.
 *   injury   — athlete reports pain rather than soreness. Never auto-clears;
 *              a coach has to review it before programming changes.
 *
 * Serious injury is deliberately absent. That is a medical decision and the
 * app should not model a return timeline for it.
 * ------------------------------------------------------------------ */

/** Facility default: percent below the 30-day average that trips the CNS flag. */
export const CNS_DEFAULT_PCT = 5;
/** Sessions needed before a CNS baseline means anything. */
const CNS_MIN_HISTORY = 3;
const CNS_WINDOW_DAYS = 30;
/** Consecutive VERY sore days before a full day off. */
const HEAVY_ESCALATE_DAY = 3;
/**
 * Consecutive LIGHT sore days before backing off to a recovery day. Higher than
 * the heavy threshold on purpose: a little sore for a couple of days running is
 * an ordinary training week, not a signal.
 */
const LIGHT_ESCALATE_DAY = 4;

/**
 * Arm readiness (1-5) is the branch discriminator. Entries logged before that
 * question existed carry the older good/sore/pain field, so read both.
 *
 *   1 pain, limiting movement  -> injury (stop)
 *   2 pain, not limiting       -> injury flag, recovery day
 *   3 no pain, very sore       -> soreness (recovery day)
 *   4 no pain, a little sore   -> soreness (hybrid day)
 *   5 no pain, no soreness     -> clear
 *
 * The old good/sore/pain field had no light/heavy split, and "sore" then meant
 * a recovery day — so it maps to `sore-heavy`. Reading those entries as merely
 * a little sore would retroactively prescribe more work than they were given.
 */
export type ArmState =
  | "clear"
  | "sore-light"
  | "sore-heavy"
  | "pain"
  | "pain-limiting";

export function armState(e: RecoveryEntry | undefined): ArmState | null {
  if (!e) return null;
  if (typeof e.armReadiness === "number") {
    if (e.armReadiness === 1) return "pain-limiting";
    if (e.armReadiness === 2) return "pain";
    if (e.armReadiness === 3) return "sore-heavy";
    if (e.armReadiness === 4) return "sore-light";
    return "clear";
  }
  if (e.armStatus === "pain") return "pain";
  if (e.armStatus === "sore") return "sore-heavy";
  if (e.armStatus === "good") return "clear";
  return null;
}

const isSore = (s: ArmState | null) => s === "sore-light" || s === "sore-heavy";

export interface Finding {
  kind: SetbackKind;
  detail: string;
  /** worst state this finding represents; stored on the flag it opens */
  severity?: ArmState;
}

export interface Guidance {
  /** headline state for the athlete */
  level: "clear" | "recovery" | "caution" | "stop";
  title: string;
  body: string;
  /** which branch produced this, for the coach view */
  kind: SetbackKind | null;
}

/** Best 5 oz of a session — the like-for-like number to trend. */
function sessionBenchmark(s: TrainingSession): number | null {
  const cfg = TRACKERS[s.type as TrackerId];
  const five = cfg.groups.find((g) => g.oz === 5);
  const v = five ? sBestG(s, five.keys) : null;
  if (v != null) return v;
  let best: number | null = null;
  for (const g of cfg.groups) {
    const x = sBestG(s, g.keys);
    if (x != null && (best == null || x > best)) best = x;
  }
  return best;
}

export interface SorenessRun {
  /** consecutive days ending at `asOf` with soreness of either severity */
  days: number;
  /** how sore they are on the most recent of those days */
  severity: "light" | "heavy" | null;
  /** any day in this run reported as very sore */
  hadHeavy: boolean;
  /** true once the run is long enough to stop being ordinary */
  escalated: boolean;
}

/**
 * How many consecutive days up to `asOf` the athlete has reported a sore arm,
 * and how sore they are today. A missing day breaks the run — we can't assume
 * anything about a day with no check-in.
 *
 * The run counts soreness of either severity, so a kid who is very sore for two
 * days and a little sore on the third is on day 3, not day 1. Severity is read
 * from the latest day only: that is what decides today's work.
 */
export function sorenessRun(
  entries: RecoveryEntry[],
  asOf: string,
): SorenessRun {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  let days = 0;
  let severity: "light" | "heavy" | null = null;
  let hadHeavy = false;

  for (let i = 0; i < 14; i++) {
    const state = armState(byDate.get(shiftDate(asOf, -i)));
    if (!isSore(state)) break;
    if (i === 0) severity = state === "sore-heavy" ? "heavy" : "light";
    if (state === "sore-heavy") hadHeavy = true;
    days++;
  }

  const limit = severity === "heavy" ? HEAVY_ESCALATE_DAY : LIGHT_ESCALATE_DAY;
  return { days, severity, hadHeavy, escalated: days >= limit };
}

/**
 * CNS check on the most recent session: is it materially below this athlete's
 * own trailing average? Returns null when there isn't enough history to say.
 */
export function cnsCheck(
  sessions: TrainingSession[],
  thresholdPct: number,
): { fired: boolean; detail: string } | null {
  if (!sessions.length) return null;
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const value = sessionBenchmark(latest);
  if (value == null) return null;

  const priors = sorted
    .slice(0, -1)
    .filter(
      (s) =>
        s.type === latest.type &&
        daysBetween(s.date, latest.date) <= CNS_WINDOW_DAYS &&
        daysBetween(s.date, latest.date) > 0,
    )
    .map(sessionBenchmark)
    .filter((v): v is number => v != null);

  if (priors.length < CNS_MIN_HISTORY) return null;
  const avg = priors.reduce((a, b) => a + b, 0) / priors.length;
  const dropPct = ((avg - value) / avg) * 100;
  const r = (n: number) => Math.round(n * 10) / 10;

  return {
    fired: dropPct >= thresholdPct,
    detail: `${r(value)} vs ${r(avg)} avg over ${priors.length} prior sessions (${dropPct >= 0 ? "-" : "+"}${r(Math.abs(dropPct))}%)`,
  };
}

/** Everything the data says should be open right now. */
export function evaluate(
  sessions: TrainingSession[],
  entries: RecoveryEntry[],
  thresholdPct: number,
  asOf: string = todayISO(),
): Finding[] {
  const out: Finding[] = [];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];

  const state = armState(latest);
  if (state === "pain" || state === "pain-limiting")
    out.push({
      kind: "injury",
      severity: state,
      detail:
        (state === "pain-limiting"
          ? `Pain limiting movement on ${latest!.date}`
          : `Pain reported ${latest!.date} (not limiting movement)`) +
        (latest!.notes ? ` — "${latest!.notes.slice(0, 140)}"` : ""),
    });

  /*
   * Being a little sore is the normal state of a kid in a throwing program, so
   * on its own it raises no flag — it would bury the coach's list in noise and
   * make the real ones easy to miss. It surfaces once it stops settling, or if
   * the run ever included a very sore day.
   *
   * That last condition matters: without it, easing from "very sore" to "a
   * little sore" would make an open flag vanish, which quietly rewards
   * under-reporting on exactly the question that has to stay honest.
   */
  const run = sorenessRun(entries, latest?.date ?? asOf);
  if (run.escalated || run.hadHeavy) {
    const label = run.severity === "heavy" ? "Very sore" : "A little sore";
    const easing = run.hadHeavy && run.severity === "light" ? ", easing" : "";
    const plural = `${run.days} day${run.days === 1 ? "" : "s"} running`;
    out.push({
      kind: "soreness",
      detail:
        `${label} ${plural}${easing}` +
        (run.escalated ? " — past the point where it should be settling" : ""),
    });
  }

  const cns = cnsCheck(sessions, thresholdPct);
  if (cns?.fired) out.push({ kind: "cns", detail: cns.detail });

  return out;
}

/**
 * What the athlete should read today. Priority order matters: an open injury
 * outranks everything, and soreness only escalates past day 2.
 */
export function guidance(
  open: Setback[],
  sessions: TrainingSession[],
  entries: RecoveryEntry[],
  asOf: string = todayISO(),
): Guidance {
  const latestEntry = [...entries]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .pop();

  /*
   * An open injury flag outranks everything and never clears itself, so this
   * holds even on a day the athlete reports a clean arm — only the coach lifts
   * it. Pain that limits movement stops throwing outright; pain that doesn't
   * drops to recovery work rather than a shutdown, but the coach still has to
   * clear it before the athlete goes back to chasing numbers.
   */
  const injury = open.find((s) => s.kind === "injury");
  if (injury) {
    /*
     * Read the severity off the flag, not off today's check-in. An athlete who
     * reported pain that limits movement stays shut down until a coach clears
     * it — feeling better two days later is not the same as having been looked
     * at, and letting a milder answer soften the message would quietly teach
     * exactly the under-reporting this question depends on not happening.
     *
     * Flags opened before severity was recorded fall back to the old reading.
     */
    const limiting =
      injury.severity === "pain-limiting" ||
      (injury.severity == null && armState(latestEntry) === "pain-limiting");
    if (limiting)
      return {
        level: "stop",
        kind: "injury",
        title: "Stop throwing",
        body: "Pain that limits how you move isn't something to work around. No throwing until a trainer or doctor has looked at it — your coach clears this, not the app.",
      };
    return {
      level: "caution",
      kind: "injury",
      title: "Recovery day",
      body: "You flagged pain, not soreness. That doesn't get thrown through, but it isn't a reason to panic either — recovery work today. Your coach has been told and is the one who clears this, so keep checking in until they do.",
    };
  }

  if (open.some((s) => s.kind === "cns"))
    return {
      level: "caution",
      kind: "cns",
      title: "Deload week",
      body: "Your last max day came in well under your own normal. That's your nervous system, not your effort — usually training load, sleep debt, or a rough stretch of eating. Expect 3–7 days of lighter work before you chase a number again.",
    };

  /*
   * Soreness, graded. Being a little sore is not a reason to sit down — most
   * athletes reporting it just don't have a reference for what post-throwing
   * soreness feels like — so it buys a hybrid day, not a shutdown. Very sore
   * follows Cole's original progression: recovery, then their call, then off.
   */
  const run = sorenessRun(entries, latestEntry?.date ?? asOf);

  if (run.severity === "heavy") {
    if (run.escalated)
      return {
        level: "caution",
        kind: "soreness",
        title: "Take the day off",
        body: `Day ${run.days} of a sore arm. Two is normal after a hard day; three means it isn't settling on its own. Full day off, and tell your coach.`,
      };
    return {
      level: "recovery",
      kind: "soreness",
      title: run.days === 1 ? "Recovery day" : "Your call on intensity",
      body:
        run.days === 1
          ? "Sore after a hard day is exactly what's supposed to happen. Today is recovery work — don't chase a number."
          : "Second day sore. Throw, but pick your own comfortable effort rather than going after max.",
    };
  }

  if (run.severity === "light") {
    if (run.escalated)
      return {
        level: "caution",
        kind: "soreness",
        title: "Recovery day",
        body: `Day ${run.days} of a sore arm. It's only a little, but it should have settled by now — recovery work today instead of throwing, and tell your coach it's been hanging around.`,
      };
    return {
      level: "recovery",
      kind: "soreness",
      title: "Hybrid day",
      body: "A little sore after throwing is normal — it isn't a reason to shut down, and it isn't a reason to chase a number either. Plyos and catch play today, no ladder. Keep the arm moving without loading it.",
    };
  }

  // No flags: if they threw yesterday, today is still a recovery day.
  const threwYesterday = sessions.some(
    (s) => daysBetween(s.date, asOf) === 1,
  );
  if (threwYesterday)
    return {
      level: "recovery",
      kind: null,
      title: "Recovery day",
      body: "You threw max-intent yesterday. Today is recovery work by default — back on it tomorrow.",
    };

  return {
    level: "clear",
    kind: null,
    title: "Green light",
    body: "Nothing flagged. Go get after it.",
  };
}

/** Copy for the in-app explainer, kept beside the logic it describes. */
export const EXPLAINER = {
  title: "Why this score isn't judging you",
  intro:
    "Your recovery score isn't grading your effort. It's telling you which body showed up today — because \"I don't feel good\" means three completely different things depending on which one it is.",
  cards: [
    {
      n: "1",
      head: "Normal soreness",
      body: "You threw hard, so you're sore. That's not a problem to fix, that's your body doing exactly what it's supposed to do 1–2 days after a max-effort session. The tracker expects this. Push through it the way your program says to, not the way your ego wants to.",
    },
    {
      n: "2",
      head: "The CNS crash",
      body: "This one's sneaky, because you can feel completely fine walking in and still throw 5+ mph under your normal number. That's not you being soft, and it's not \"in your head\" — it's your nervous system telling you it hasn't recovered from training load, sleep debt, or a stretch of eating like garbage, even if your muscles don't feel tired. This is why the tracker watches your numbers instead of just asking how you feel.",
    },
    {
      n: "3",
      head: "Actually hurt",
      body: "Different from sore. A strain or a tweak doesn't get pushed through — it gets checked out and rebuilt on a real timeline. No shortcuts here, no exceptions.",
    },
  ],
  close:
    "Before every 100%-effort day, ask yourself: am I sore, am I gassed, or am I actually hurt? Answer that honestly and the tracker does its job — tells you to push, pull back, or shut it down.",
  kicker:
    "Your ceiling isn't built on the days you throw hard. It's built on whether you actually recover from them.",
};
