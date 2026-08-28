import { getScope } from "@/lib/scope";
import { getAthlete, updateAthlete } from "@/lib/data";
import { json, unauthorized, forbidden, notFound } from "@/lib/http";
import type { Hand } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isHand = (v: unknown): v is Hand => v === "R" || v === "L" || v === "";

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

  if (scope.role === "coach") {
    const updated = await updateAthlete(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      hand: isHand(body.hand) ? body.hand : undefined,
      inviteEmail:
        body.inviteEmail === undefined
          ? undefined
          : String(body.inviteEmail || "") || null,
    });
    return json(updated);
  }

  // an athlete may change only their own throwing hand
  if (scope.athleteIds.includes(id) && isHand(body.hand)) {
    return json(await updateAthlete(id, { hand: body.hand }));
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
