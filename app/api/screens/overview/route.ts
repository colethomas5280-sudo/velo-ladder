import { getScope } from "@/lib/scope";
import { listAllScreens } from "@/lib/data";
import {
  rescreenStanding,
  screenSummary,
  standingScreen,
  type Hand,
} from "@/lib/screen";
import type { ScreenOverviewRow } from "@/lib/types";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every athlete's standing screen, reduced to a line each.
 *
 * Coach-only, and not because the findings are secret — an athlete sees their
 * own on their own page. It is cross-athlete, and the leaderboard is the only
 * cross-athlete read this app offers. Widening that is a product decision, not
 * a convenience for a roster view.
 *
 * It ships the DATES both clocks run from rather than how due they are. The
 * elapsed days get worked out in the browser, so a coach who has travelled
 * isn't reading an answer computed in a server's timezone yesterday.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  return guard(async () => {
    const out: ScreenOverviewRow[] = (await listAllScreens()).map((a) => {
      const standing = standingScreen(a.screens);
      const call =
        a.rescreenSince !== null
          ? { since: a.rescreenSince, reason: a.rescreenReason ?? "Re-screen called" }
          : null;
      // A call already answered by a later screen is not reported at all.
      const called = rescreenStanding(call, standing) ? call : null;
      // Only "R" or "L" places the arm-test caveat; anything else waives nothing.
      const hand = a.hand === "R" || a.hand === "L" ? (a.hand as Hand) : null;
      if (!standing.last)
        return {
          athleteId: a.athleteId,
          name: a.name,
          last: null,
          lastFull: null,
          summary: null,
          spotSince: null,
          spotTests: 0,
          called,
        };

      const summary = screenSummary(standing.results, undefined, hand);
      /*
       * The spot clock runs from the OLDEST failing test — rechecking the one
       * you just did must not reset the clock on the one you have been
       * avoiding. Mirrors `retestPlan`, which the panel uses.
       */
      const failing = Object.entries(standing.from)
        .filter(([key]) => summary.failing.includes(key))
        .map(([, date]) => date)
        .sort();

      return {
        athleteId: a.athleteId,
        name: a.name,
        last: standing.last,
        lastFull: standing.lastFull,
        summary,
        spotSince: failing[0] ?? null,
        spotTests: summary.failing.length,
        called,
      };
    });
    return json(out);
  }, "Loading the screen overview failed");
}
