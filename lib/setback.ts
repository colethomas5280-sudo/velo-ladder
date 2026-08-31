import type {
  RecoveryEntry,
  Setback,
  SetbackKind,
  TrainingSession,
  TrackerId,
} from "./types";
import { TRACKERS, sBestG, todayISO } from "./velo";

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
/** Consecutive sore days before it stops being "expected". */
const SORENESS_ESCALATE_DAY = 3;

/**
 * Arm readiness (1-4) is the branch discriminator. Entries logged before that
 * question existed carry the older good/sore/pain field, so read both.
 *
 *   1 pain, limiting movement      -> injury (urgent)
 *   2 pain, not limiting movement  -> injury
 *   3 no pain, some soreness       -> soreness
 *   4 no pain, no soreness         -> clear
 */
export type ArmState = "clear" | "sore" | "pain" | "pain-limiting";

export function armState(e: RecoveryEntry | undefined): ArmState | null {
  if (!e) return null;
  if (typeof e.armReadiness === "number") {
    if (e.armReadiness === 1) return "pain-limiting";
    if (e.armReadiness === 2) return "pain";
    if (e.armReadiness === 3) return "sore";
    return "clear";
  }
  if (e.armStatus === "pain") return "pain";
  if (e.armStatus === "sore") return "sore";
  if (e.armStatus === "good") return "clear";
  return null;
}

export interface Finding {
  kind: SetbackKind;
  detail: string;
}

export interface Guidance {
  /** headline state for the athlete */
  level: "clear" | "recovery" | "caution" | "stop";
  title: string;
  body: string;
  /** which branch produced this, for the coach view */
  kind: SetbackKind | null;
}

const daysBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
};
const shiftDate = (iso: string, delta: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
};

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

/**
 * How many consecutive days up to `asOf` the athlete has reported a sore arm.
 * A missing day breaks the run — we can't assume anything about a day with
 * no check-in.
 */
export function sorenessRun(entries: RecoveryEntry[], asOf: string): number {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  let run = 0;
  for (let i = 0; i < 14; i++) {
    const e = byDate.get(shiftDate(asOf, -i));
    if (armState(e) === "sore") run++;
    else break;
  }
  return run;
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
      detail:
        (state === "pain-limiting"
          ? `Pain limiting movement on ${latest!.date}`
          : `Pain reported ${latest!.date} (not limiting movement)`) +
        (latest!.notes ? ` — "${latest!.notes.slice(0, 140)}"` : ""),
    });

  const run = sorenessRun(entries, latest?.date ?? asOf);
  if (run > 0)
    out.push({
      kind: "soreness",
      detail:
        run >= SORENESS_ESCALATE_DAY
          ? `Sore ${run} days running — past the point where it should be settling`
          : `Sore ${run} day${run === 1 ? "" : "s"} running`,
    });

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

  if (open.some((s) => s.kind === "injury")) {
    const limiting = armState(latestEntry) === "pain-limiting";
    return {
      level: "stop",
      kind: "injury",
      title: limiting ? "Stop throwing" : "Get it looked at",
      body: limiting
        ? "Pain that limits how you move isn't something to work around. No throwing until a trainer or doctor has looked at it — your coach clears this, not the app."
        : "You flagged pain, not soreness. That doesn't get thrown through. Sit down with a trainer or doctor before your next throwing day — your coach can clear this once it's been checked.",
    };
  }

  if (open.some((s) => s.kind === "cns"))
    return {
      level: "caution",
      kind: "cns",
      title: "Deload week",
      body: "Your last max day came in well under your own normal. That's your nervous system, not your effort — usually training load, sleep debt, or a rough stretch of eating. Expect 3–7 days of lighter work before you chase a number again.",
    };

  const run = sorenessRun(entries, latestEntry?.date ?? asOf);

  if (run >= SORENESS_ESCALATE_DAY)
    return {
      level: "caution",
      kind: "soreness",
      title: "Take the day off",
      body: `Day ${run} of a sore arm. Two is normal after a hard day; three means it isn't settling on its own. Full day off, and tell your coach.`,
    };

  if (run > 0)
    return {
      level: "recovery",
      kind: "soreness",
      title: run === 1 ? "Recovery day" : "Your call on intensity",
      body:
        run === 1
          ? "Sore after a hard day is exactly what's supposed to happen. Today is recovery work — don't chase a number."
          : "Second day sore. Throw, but pick your own comfortable effort rather than going after max.",
    };

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
