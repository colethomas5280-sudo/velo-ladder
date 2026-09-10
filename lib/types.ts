import type { ScreenSummary } from "./screen";

export type TrackerId = "mound" | "pulldown";
export type Hand = "" | "R" | "L";

/** Per-slot arrays: [80% primer, 100% #1, #2, #3, #4]. null = blank.
 *  Sessions logged before the 4th box exist as length-4 arrays. */
export type Throws = Record<string, (number | null)[]>;

export interface Athlete {
  id: string;
  name: string;
  hand: Hand;
  /** the email this athlete logs in with */
  inviteEmail: string | null;
  /** true once a password has been set (the hash itself is never sent to the client) */
  hasPassword: boolean;
  /** true while an unused invite link is outstanding (the token is never sent to the client) */
  hasInvite: boolean;
  /** percent below the 30-day average that trips the CNS flag; null = facility default */
  cnsThresholdPct: number | null;
  /** "YYYY-MM-DD"; coach-visible only, never sent to the leaderboard */
  birthDate: string | null;
  /** Youth | High School | College | Pro */
  level: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  heightIn: number | null;
  weightLb: number | null;
  /** "checkin" | "entered" — where weightLb came from */
  weightSource: string | null;
  weightAt: string | null;
  bats: string | null;
  school: string | null;
  hsGradYear: number | null;
  collegeGradYear: number | null;
  status: string | null;
  /** Training block — see PHASES. */
  phase: string | null;
  /** Date a re-screen was called for, by any trigger. Null when none stands. */
  rescreenSince: string | null;
  rescreenReason: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  emergencyContact: string | null;
  injuryNotes: string | null;
  /** coach only — stripped from an athlete's response by visibleProfile */
  coachNotes: string | null;
  archived: boolean;
}

export interface TrainingSession {
  id: string;
  athleteId: string;
  type: TrackerId;
  date: string; // YYYY-MM-DD
  notes: string;
  /** level stamped at save time; null for sessions logged before levels existed */
  level: string | null;
  throws: Throws;
}

export interface AthleteOverview extends Athlete {
  mound: number;
  pulldown: number;
  lastDate: string | null;
  /** count of still-blank required profile fields, computed in the overview route */
  missing: number;
}

export type Role = "coach" | "athlete" | "none";

export interface Scope {
  role: Role;
  email: string;
  /** Athlete rows this user owns (athlete role). Empty for coach/none. */
  athleteIds: string[];
}

export interface Resource {
  id: string;
  title: string;
  category: string;
  body: string;
  link: string | null;
  position: number;
  archived: boolean;
}

/** Daily recovery check-in. Every 1-5 rating: 5 is the good end. */
/** One OnBaseU movement screen. `results` maps field key -> finding key. */
export interface MovementScreen {
  id: string;
  athleteId: string;
  date: string;
  results: Record<string, string>;
  notes: string;
}

/**
 * One athlete's line on the Tests roster. `summary` is null until screened.
 *
 * Carries the dates both clocks run from rather than how due they are: the
 * elapsed days are worked out in the browser against the viewer's own today.
 */
export interface ScreenOverviewRow {
  athleteId: string;
  name: string;
  /** The most recent screen of any kind. */
  last: string | null;
  /** The most recent one that covered every test — what the full clock runs from. */
  lastFull: string | null;
  summary: ScreenSummary | null;
  /** The oldest failing test's last look — what the spot clock runs from. */
  spotSince: string | null;
  spotTests: number;
  /** A called re-screen that no screen has answered yet, and why. */
  called: { since: string; reason: string } | null;
  /** Training block — in-season pauses the full-screen clock. */
  phase: string | null;
}

export interface RecoveryEntry {
  id: string;
  athleteId: string;
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  energy: number | null;
  stress: number | null;
  mood: number | null;
  diet: number | null;
  /** 1-5 sleep band the athlete picked. Supersedes `sleepHours`. */
  sleepDuration: number | null;
  /** Bodyweight in lb. Tracked and trended, never scored. */
  bodyWeight: number | null;
  /** 1-5: 1 pain limiting, 2 pain, 3 very sore, 4 a little sore, 5 clear. */
  armReadiness: number | null;
  restingHr: number | null;
  hrv: number | null;
  armStatus: ArmStatus | null;
  notes: string;
}

/**
 * Retired: replaced by the `armReadiness` question. Kept because check-ins
 * logged before that still carry it, and `armState()` falls back to it.
 */
export type ArmStatus = "good" | "sore" | "pain";

export type SetbackKind = "soreness" | "cns" | "injury";

export interface Setback {
  id: string;
  athleteId: string;
  kind: SetbackKind;
  openedOn: string;
  resolvedOn: string | null;
  resolvedBy: string | null;
  detail: string;
  /**
   * How bad it was at its worst during this episode. Recorded on the flag so
   * guidance doesn't soften when the athlete later reports feeling better —
   * only a coach clearing the flag changes that. Null on flags opened before
   * this was tracked; those fall back to reading the latest check-in.
   */
  severity: string | null;
}
