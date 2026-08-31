import type { TrainingSession, TrackerId } from "./types";
import { TRACKERS, sBestG } from "./velo";

/* ------------------------------------------------------------------ *
 * Leaderboard bands
 *
 * A record keeps the band it was set at. That is the whole point of a
 * record board — a 14U record set at 14 stays a 14U record after the
 * athlete ages up, or the youth boards empty out as kids grow.
 *
 * Two mechanisms, each correct on its own terms. The upper levels are
 * program decisions, so they are stamped onto the session at save time.
 * The youth split is a fact about age, so it is derived from the birth
 * date against the SESSION date — never today's — which means entering a
 * birth date retroactively makes an athlete's whole history correct with
 * no backfill.
 * ------------------------------------------------------------------ */

/** The four values that are actually stored on an athlete or a session. */
export const LEVELS = ["Youth", "High School", "College", "Pro"] as const;
export type Level = (typeof LEVELS)[number];

/** Boards. 12U and 14U are derived at read time and never stored. */
export type Band = "12U" | "14U" | "High School" | "College" | "Pro";
export const BANDS: Band[] = ["12U", "14U", "High School", "College", "Pro"];

export interface LeaderboardAthlete {
  id: string;
  name: string;
  hand: string;
  /** "YYYY-MM-DD"; coach-visible only, never sent to the client */
  birthDate: string | null;
  level: Level | null;
}

/** Whole years old on `onDate`, counting a birthday that hasn't landed yet. */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

/**
 * True iff `value` is a real `YYYY-MM-DD` calendar day that is not in the
 * future. A shape-only regex (`/^\d{4}-\d{2}-\d{2}$/`) is not enough: it lets
 * `2009-99-99` through to die in Postgres, and `2103-06-15` through to a
 * negative age that lands an adult on the 12U board. One home for the date
 * semantics that both write paths (`/api/join`, `/api/athletes/[id]`) share.
 */
export function isValidBirthDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // round-trips only if the day actually exists (rejects 2009-02-30, 2009-99-99)
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  )
    return false;
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return dt.getTime() <= todayUTC;
}

/**
 * Which board one session belongs to, or null for facility-only.
 * Order matters: a stamped level is an override and always wins.
 */
export function bandForSession(
  athlete: LeaderboardAthlete,
  sessionLevel: string | null,
  sessionDate: string,
): Band | null {
  if (
    sessionLevel === "High School" ||
    sessionLevel === "College" ||
    sessionLevel === "Pro"
  )
    return sessionLevel;

  if (sessionLevel === "Youth") {
    if (!athlete.birthDate) return null;
    const age = ageOn(athlete.birthDate, sessionDate);
    // A mistyped birth date (e.g. a future year) yields a negative age; without
    // this floor `age <= 12` would put that session on the 12U board.
    if (age < 0) return null;
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    return null; // 15+ still marked Youth: facility board only
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

export interface BoardRow {
  rank: number;
  name: string;
  band: Band | null;
  hand: string;
  velocity: number;
  date: string;
  isYou: boolean;
}

export interface Board {
  key: "facility" | Band;
  title: string;
  rows: BoardRow[];
  /** the viewer's standing when they rank below the visible rows */
  you: { rank: number; velocity: number } | null;
}

export const FACILITY_LIMIT = 10;
export const BAND_LIMIT = 5;

interface Mark {
  athleteId: string;
  name: string;
  hand: string;
  band: Band | null;
  velocity: number;
  date: string;
}

/**
 * One row per athlete — their single best mark, not one row per session.
 * Without this, one athlete having a big day takes four of the top five
 * slots and it stops being a leaderboard. Ties go to whoever set it first.
 */
function rank(
  marks: Mark[],
  limit: number,
  viewer: Set<string>,
): Pick<Board, "rows" | "you"> {
  const best = new Map<string, Mark>();
  for (const m of marks) {
    const cur = best.get(m.athleteId);
    if (
      !cur ||
      m.velocity > cur.velocity ||
      (m.velocity === cur.velocity && m.date < cur.date)
    )
      best.set(m.athleteId, m);
  }

  const ranked = [...best.values()].sort(
    (a, b) =>
      b.velocity - a.velocity ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)),
  );

  const rows: BoardRow[] = ranked.slice(0, limit).map((m, i) => ({
    rank: i + 1,
    name: m.name,
    band: m.band,
    hand: m.hand,
    velocity: m.velocity,
    date: m.date,
    isYou: viewer.has(m.athleteId),
  }));

  const idx = ranked.findIndex((m) => viewer.has(m.athleteId));
  const you =
    idx >= limit ? { rank: idx + 1, velocity: ranked[idx].velocity } : null;

  return { rows, you };
}

/**
 * Boards for one tracker and weight. Reads velocities through `sBestG` and
 * the tracker's own `groups`, which is what guarantees a board number can
 * never disagree with the athlete's own PR tile: the primer rule and the
 * combined-5oz rule live in exactly one place.
 */
export function buildBoards(
  athletes: LeaderboardAthlete[],
  sessions: TrainingSession[],
  tracker: TrackerId,
  oz: number,
  viewerAthleteIds: string[],
): Board[] {
  const group = TRACKERS[tracker].groups.find((g) => g.oz === oz);
  if (!group) return [];

  const byId = new Map(athletes.map((a) => [a.id, a]));
  const viewer = new Set(viewerAthleteIds);
  const marks: Mark[] = [];

  for (const s of sessions) {
    if (s.type !== tracker) continue;
    const a = byId.get(s.athleteId);
    if (!a) continue;
    const velocity = sBestG(s, group.keys);
    if (velocity == null) continue;
    marks.push({
      athleteId: a.id,
      name: a.name,
      hand: a.hand,
      band: bandForSession(a, s.level, s.date),
      velocity,
      date: s.date,
    });
  }

  const boards: Board[] = [];
  const facility = rank(marks, FACILITY_LIMIT, viewer);
  if (facility.rows.length)
    boards.push({ key: "facility", title: "Facility record", ...facility });

  for (const band of BANDS) {
    const inBand = marks.filter((m) => m.band === band);
    if (!inBand.length) continue;
    boards.push({ key: band, title: band, ...rank(inBand, BAND_LIMIT, viewer) });
  }

  return boards;
}
