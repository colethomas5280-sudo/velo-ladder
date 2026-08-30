import { getScope } from "@/lib/scope";
import { resolveSetback } from "@/lib/data";
import { json, unauthorized, forbidden, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a flag reviewed. Coach-only on purpose: this is the human checkpoint
 * that clears an injury flag, and an athlete must not be able to clear
 * themselves back into full-intent work.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  const updated = await resolveSetback(id, scope.email);
  if (!updated) return notFound("Already reviewed, or no such flag");
  return json(updated);
}
