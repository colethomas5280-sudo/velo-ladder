import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { Scope } from "@/lib/types";

function coachEmails(): string[] {
  return (process.env.COACH_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve the signed-in user's scope. Returns null when not signed in
 * (callers turn that into a 401).
 *
 * Athlete claiming happens here: if a coach has pre-created an athlete row
 * with this user's email as invite_email, we link it on first look. This is
 * order-independent — works whether the athlete signed in first or was
 * added to the roster first.
 */
export async function getScope(): Promise<Scope | null> {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email?.toLowerCase();
  if (!userId || !email) return null;

  if (coachEmails().includes(email)) {
    return { role: "coach", userId, email, athleteIds: [] };
  }

  const owned = (await sql`
    SELECT id FROM athletes WHERE user_id = ${userId} AND archived = false
  `) as { id: string }[];
  if (owned.length) {
    return { role: "athlete", userId, email, athleteIds: owned.map((r) => r.id) };
  }

  const claimable = (await sql`
    SELECT id FROM athletes
    WHERE user_id IS NULL AND archived = false AND lower(invite_email) = ${email}
  `) as { id: string }[];
  if (claimable.length) {
    const ids = claimable.map((r) => r.id);
    await sql`UPDATE athletes SET user_id = ${userId} WHERE id = ANY(${ids}) AND user_id IS NULL`;
    return { role: "athlete", userId, email, athleteIds: ids };
  }

  return { role: "none", userId, email, athleteIds: [] };
}

export function canSeeAthlete(scope: Scope, athleteId: string): boolean {
  return scope.role === "coach" || scope.athleteIds.includes(athleteId);
}
