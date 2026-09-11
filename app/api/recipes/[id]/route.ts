import { getScope } from "@/lib/scope";
import { updateRecipe } from "@/lib/data";
import { parseRecipePatch } from "@/lib/recipeInput";
import { json, unauthorized, forbidden, notFound, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const parsed = parseRecipePatch(await request.json().catch(() => ({})));
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid recipe");

  return guard(async () => {
    const updated = await updateRecipe(id, parsed.value!);
    return updated ? json(updated) : notFound();
  }, "Saving the recipe failed");
}

/** Soft delete, like resources: an athlete may have been sent a link to it. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(async () => {
    const updated = await updateRecipe(id, { archived: true });
    return updated ? json({ ok: true }) : notFound();
  }, "Removing the recipe failed");
}
