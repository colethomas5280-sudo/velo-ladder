import { getScope } from "@/lib/scope";
import { listAthleteOverview } from "@/lib/data";
import { json, unauthorized, forbidden } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return json(await listAthleteOverview());
}
