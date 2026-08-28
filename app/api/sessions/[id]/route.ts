import { getScope, canSeeAthlete } from "@/lib/scope";
import { getSession, updateSession, deleteSession } from "@/lib/data";
import { validateSessionInput } from "@/lib/velo";
import { json, unauthorized, forbidden, notFound, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();

  const existing = await getSession(id);
  if (!existing) return notFound();
  if (!canSeeAthlete(scope, existing.athleteId)) return forbidden();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateSessionInput({ ...body, type: existing.type });
  if (!v.ok || !v.value) return badRequest(v.error || "Invalid session");

  const updated = await updateSession(id, {
    date: v.value.date,
    notes: v.value.notes ?? "",
    throws: v.value.throws,
  });
  return json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();

  const existing = await getSession(id);
  if (!existing) return notFound();
  if (!canSeeAthlete(scope, existing.athleteId)) return forbidden();

  await deleteSession(id);
  return json({ ok: true });
}
