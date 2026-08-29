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
 * Resolve the signed-in user's scope from their email. Returns null when
 * not signed in (callers turn that into a 401).
 */
export async function getScope(): Promise<Scope | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;

  if (coachEmails().includes(email)) {
    return { role: "coach", email, athleteIds: [] };
  }

  const owned = (await sql`
    SELECT id FROM athletes
    WHERE archived = false AND lower(invite_email) = ${email}
  `) as { id: string }[];
  if (owned.length) {
    return { role: "athlete", email, athleteIds: owned.map((r) => r.id) };
  }

  return { role: "none", email, athleteIds: [] };
}

export function canSeeAthlete(scope: Scope, athleteId: string): boolean {
  return scope.role === "coach" || scope.athleteIds.includes(athleteId);
}
