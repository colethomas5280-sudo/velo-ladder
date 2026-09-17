import { getScope } from "@/lib/scope";
import { listAllDeliveryScreens } from "@/lib/data";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The roster card. Coach only, like the screen overview beside it. */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(
    async () => json(await listAllDeliveryScreens()),
    "Loading the delivery overview failed",
  );
}
