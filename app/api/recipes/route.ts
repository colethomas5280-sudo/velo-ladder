import { getScope } from "@/lib/scope";
import { listRecipes, createRecipe } from "@/lib/data";
import { parseNewRecipe } from "@/lib/recipeInput";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everyone signed in reads the recipes; only a coach adds one. */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  return guard(async () => json(await listRecipes()), "Loading recipes failed");
}

export async function POST(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const parsed = parseNewRecipe(await request.json().catch(() => ({})));
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid recipe");

  return guard(
    async () => json(await createRecipe(parsed.value!), 201),
    "Saving the recipe failed",
  );
}
