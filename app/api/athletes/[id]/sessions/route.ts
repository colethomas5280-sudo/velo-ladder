import { getScope, canSeeAthlete } from "@/lib/scope";
import { getAthlete, listSessions, createSession } from "@/lib/data";
import { validateSessionInput } from "@/lib/velo";
import { json, unauthorized, forbidden, notFound, badRequest } from "@/lib/http";

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
  return json(await listSessions(id));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();

  const athlete = await getAthlete(id);
  if (!athlete || athlete.archived) return notFound();

  const body = await request.json().catch(() => null);
  const v = validateSessionInput(body);
  if (!v.ok || !v.value) return badRequest(v.error || "Invalid session");

  const created = await createSession({
    athleteId: id,
    type: v.value.type,
    date: v.value.date,
    notes: v.value.notes ?? "",
    throws: v.value.throws,
    createdBy: scope.userId,
  });
  return json(created, 201);
}
