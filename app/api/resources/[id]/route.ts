import { getScope } from "@/lib/scope";
import { updateResource } from "@/lib/data";
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
  if (scope.role !== "coach") return forbidden();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.title === "string" && !body.title.trim())
    return badRequest("Give it a title");

  const updated = await updateResource(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    body: typeof body.body === "string" ? body.body : undefined,
    link:
      body.link === undefined
        ? undefined
        : typeof body.link === "string"
          ? body.link
          : null,
    position: typeof body.position === "number" ? body.position : undefined,
  });
  if (!updated) return notFound();
  return json(updated);
}

/** Soft delete — keeps anything an athlete may have bookmarked recoverable. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  const updated = await updateResource(id, { archived: true });
  if (!updated) return notFound();
  return json({ ok: true });
}
