import { getScope } from "@/lib/scope";
import { listVeloSources } from "@/lib/veloData";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Never let any response this route produces be cached — the 401, the 403,
 * a 500 from `guard`, or the 200 itself.
 *
 * The other coach-only routes in this repo set no cache headers at all, but
 * none of them serve data that is role-gated the way this ladder is. A
 * stale browser or shared cache must never hand one user's response to
 * another after a sign-out/sign-in swap, and that guarantee is only as good
 * as its weakest response — a cached 403 played back to a coach who has
 * since signed in properly is the same failure as a cached 200 would be,
 * even though no athlete data is in the body either way.
 */
function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/**
 * Coach only, enforced here rather than in the UI.
 *
 * This is the whole point of the feature: an athlete or a parent must never
 * receive these numbers, and hiding a nav link does not achieve that.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return noStore(unauthorized());
  if (scope.role !== "coach") return noStore(forbidden());
  return noStore(
    await guard(async () => json(await listVeloSources()), "Loading the velo sources failed"),
  );
}
