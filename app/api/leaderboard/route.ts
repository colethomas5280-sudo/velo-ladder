import { getScope } from "@/lib/scope";
import { listLeaderboardData } from "@/lib/data";
import { buildBoards } from "@/lib/leaderboard";
import { TRACKER_IDS } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one cross-athlete read in the app. It deliberately does NOT relax
 * `canSeeAthlete` — an athlete still cannot open anyone else's page. This
 * returns only what a record board needs: name, band, hand, velocity, date.
 * Never athlete IDs, birth dates, invite emails, or session contents.
 */
export async function GET(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role === "none") return forbidden();

  const url = new URL(request.url);
  const tracker = (url.searchParams.get("tracker") ?? "mound") as TrackerId;
  const ozRaw = url.searchParams.get("oz") ?? "5";
  const oz = Number(ozRaw);

  // Fail loudly rather than quietly showing the wrong board.
  if (!TRACKER_IDS.includes(tracker))
    return badRequest("tracker must be mound or pulldown");
  if (![5, 6, 7, 4, 3].includes(oz)) return badRequest("oz must be 5, 6, 7, 4 or 3");

  return guard(async () => {
    const { athletes, sessions } = await listLeaderboardData();
    return json(buildBoards(athletes, sessions, tracker, oz, scope.athleteIds));
  }, "Loading the leaderboard failed");
}
