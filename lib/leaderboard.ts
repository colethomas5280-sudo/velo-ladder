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
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    return null; // 15+ still marked Youth: facility board only
  }

  return null;
}
