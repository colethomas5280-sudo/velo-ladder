import { getScope, canSeeAthlete } from "@/lib/scope";
import { getAthlete, updateAthlete } from "@/lib/data";
import { json, unauthorized, forbidden, notFound, badRequest } from "@/lib/http";
import { visibleProfile } from "@/lib/profile";
import { parseProfilePatch } from "@/lib/profileInput";
import { todayISO } from "@/lib/velo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // The line that keeps coachNotes off an athlete's wire — stripped by role
  // server-side, not merely hidden in the UI.
  return json(visibleProfile(athlete as unknown as Record<string, unknown>, scope.role === "coach"));
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

  const isCoach = scope.role === "coach";
  if (!isCoach && !scope.athleteIds.includes(id)) return forbidden();

  // `target` is the row fetched above; the parser needs it to decide whether a
  // set-once field is still blank and therefore the athlete's to fill.
  const parsed = parseProfilePatch(
    body,
    isCoach,
    target as unknown as Record<string, unknown>,
  );
  if (!parsed.ok) return badRequest(parsed.error);

  // Coach-only controls that are not profile fields, carried over unchanged
  // from the branch this replaces.
  const extra: { cnsThresholdPct?: number | null } = {};
  if (isCoach && body.cnsThresholdPct !== undefined) {
    const raw = body.cnsThresholdPct;
    if (raw === null || raw === "") extra.cnsThresholdPct = null;
    else {
      const n = Number(raw);
      if (!(n > 0 && n <= 50))
        return badRequest("CNS band must be between 0 and 50 percent");
      extra.cnsThresholdPct = n;
    }
  }

  // Weight entered here is authored, not observed — record that, so the
  // profile can say where the number came from. A later check-in overwrites
  // both (Task 4). Clearing the weight clears its provenance too — a source
  // and date for a value that no longer exists is worse than nothing.
  const stamped =
    parsed.patch.weightLb === undefined
      ? {}
      : parsed.patch.weightLb === null
        ? { weightSource: null, weightAt: null }
        : { weightSource: "entered", weightAt: todayISO() };

  const updated = await updateAthlete(id, {
    ...parsed.patch,
    ...stamped,
    ...extra,
    password,
  });
  return json(visibleProfile(updated! as unknown as Record<string, unknown>, isCoach));
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
