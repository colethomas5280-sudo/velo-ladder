import { getScope, canSeeAthlete } from "@/lib/scope";
import { getAthlete, updateAthlete } from "@/lib/data";
import { json, unauthorized, forbidden, notFound, badRequest } from "@/lib/http";
import { LEVELS, type Level, isValidBirthDate } from "@/lib/leaderboard";
import type { Hand } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isHand = (v: unknown): v is Hand => v === "R" || v === "L" || v === "";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  const athlete = await getAthlete(id);
  if (!athlete || athlete.archived) return notFound();
  return json(athlete);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();

  const target = await getAthlete(id);
  if (!target || target.archived) return notFound();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password =
    typeof body.password === "string" && body.password ? body.password : undefined;
  if (password && password.length < 6)
    return badRequest("Password must be at least 6 characters");

  if (scope.role === "coach") {
    const updated = await updateAthlete(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      hand: isHand(body.hand) ? body.hand : undefined,
      inviteEmail:
        body.inviteEmail === undefined
          ? undefined
          : String(body.inviteEmail || "") || null,
      // null clears the override and falls back to the facility default
      cnsThresholdPct:
        body.cnsThresholdPct === undefined
          ? undefined
          : body.cnsThresholdPct === null || body.cnsThresholdPct === ""
            ? null
            : Number(body.cnsThresholdPct) > 0 &&
                Number(body.cnsThresholdPct) <= 50
              ? Number(body.cnsThresholdPct)
              : undefined,
      level:
        body.level === undefined
          ? undefined
          : LEVELS.includes(body.level as Level)
            ? (body.level as Level)
            : null,
      birthDate:
        body.birthDate === undefined
          ? undefined
          : isValidBirthDate(body.birthDate)
            ? body.birthDate
            : null,
      password,
    });
    return json(updated);
  }

  // an athlete may change only their own hand and their own password
  if (scope.athleteIds.includes(id)) {
    const patch: { hand?: Hand; password?: string } = {};
    if (isHand(body.hand)) patch.hand = body.hand;
    if (password) patch.password = password;
    if (!Object.keys(patch).length) return forbidden();
    return json(await updateAthlete(id, patch));
  }
  return forbidden();
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const target = await getAthlete(id);
  if (!target) return notFound();
  await updateAthlete(id, { archived: true });
  return json({ ok: true });
}
