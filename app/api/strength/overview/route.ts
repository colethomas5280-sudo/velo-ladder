import { getScope } from "@/lib/scope";
import { listAllLiftDays, listLifts } from "@/lib/data";
import {
  STRENGTH_WINDOW,
  liftMenu,
  liftsEverDone,
  recentRecords,
} from "@/lib/strength";
import type { StrengthOverviewRow } from "@/lib/types";
import { shiftDate, todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every athlete's lifting, reduced to a line each.
 *
 * Coach-only, for the same reason the screen roster is: an athlete sees their
 * own log on their own page, and the leaderboard is the only cross-athlete
 * read this app offers.
 *
 * Records are worked out here rather than in the browser because they need
 * the whole history to be honest, and shipping every set of every day for
 * every athlete to draw one line per row is not a trade worth making. What
 * does go to the browser is `last` as a DATE — how long ago that was is the
 * viewer's own question, answered against the viewer's own today.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  return guard(async () => {
    /*
     * One cutoff for the whole response. Computing it per athlete inside the
     * loop would put rows either side of a midnight the request straddled.
     */
    const since = shiftDate(todayISO(), -STRENGTH_WINDOW);
    const menu = liftMenu(await listLifts());

    const out: StrengthOverviewRow[] = (await listAllLiftDays()).map((a) => ({
      athleteId: a.athleteId,
      name: a.name,
      last: a.days.length ? a.days[a.days.length - 1].date : null,
      recentDays: a.days.filter((d) => d.date >= since).length,
      lifts: liftsEverDone(menu, a.days).length,
      records: recentRecords(menu, a.days, since),
    }));
    return json(out);
  }, "Loading the strength overview failed");
}
