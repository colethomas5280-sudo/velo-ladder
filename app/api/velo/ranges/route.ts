import { getScope } from "@/lib/scope";
import { listVeloRanges } from "@/lib/veloData";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coach only, enforced here rather than in the UI.
 *
 * This is the whole point of the feature: an athlete or a parent must never
 * receive these numbers, and hiding a nav link does not achieve that.
 *
 * `Cache-Control: private, no-store` is added explicitly — the other
 * coach-only routes in this repo set no cache headers at all, but none of
 * them serve data that is role-gated the way this ladder is, so a shared
 * cache (or a stale browser cache after a sign-out/sign-in swap) must never
 * hand one user's response to another.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(async () => {
    const res = json(await listVeloRanges());
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }, "Loading the velo ladder failed");
}
