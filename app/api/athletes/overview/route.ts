import { getScope } from "@/lib/scope";
import { listAthleteOverview } from "@/lib/data";
import { missingProfileFields } from "@/lib/profile";
import { json, unauthorized, forbidden } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  const rows = await listAthleteOverview();
  return json(
    rows.map((a) => ({ ...a, missing: missingProfileFields(a).length })),
  );
}
