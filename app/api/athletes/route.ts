import { getScope } from "@/lib/scope";
import { listAthletes, createAthlete } from "@/lib/data";
import { visibleProfile } from "@/lib/profile";
import { json, unauthorized, forbidden, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role === "none") return json([]);

  // The list route serves athletes their own row too. Without this it shipped
  // `coachNotes` verbatim — the [id] route got the role filter, this one did
  // not. Run every row through `visibleProfile`, coach branch included, so
  // there is one response shape rather than two.
  const isCoach = scope.role === "coach";
  const rows = isCoach
    ? await listAthletes()
    : await listAthletes({ ids: scope.athleteIds });
  return json(
    rows.map((a) =>
      visibleProfile(a as unknown as Record<string, unknown>, isCoach),
    ),
  );
}

export async function POST(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("Athlete name is required");
  const hand = body?.hand === "R" || body?.hand === "L" ? body.hand : "";
  const inviteEmail =
    typeof body?.inviteEmail === "string" && body.inviteEmail.trim()
      ? body.inviteEmail.trim()
      : null;
  const password =
    typeof body?.password === "string" && body.password ? body.password : null;
  if (password && password.length < 6)
    return badRequest("Password must be at least 6 characters");
  if (password && !inviteEmail)
    return badRequest("An athlete needs an email to log in with a password");

  const athlete = await createAthlete({ name, hand, inviteEmail, password });
  return json(athlete, 201);
}
