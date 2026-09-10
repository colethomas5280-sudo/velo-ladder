import { getScope } from "@/lib/scope";
import { listLatestScreens } from "@/lib/data";
import { screenSummary } from "@/lib/screen";
import type { ScreenOverviewRow } from "@/lib/types";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every athlete's latest screen, reduced to a line each.
 *
 * Coach-only, and not because the findings are secret — an athlete sees their
 * own on their own page. It is cross-athlete, and the leaderboard is the only
 * cross-athlete read this app offers. Widening that is a product decision, not
 * a convenience for a roster view.
 *
 * The summary is computed here rather than shipped as raw findings, so a page
 * that only needs a dot and a count is not handed a whole screen to render it.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  return guard(async () => {
    const rows = await listLatestScreens();
    const out: ScreenOverviewRow[] = rows.map((r) => ({
      athleteId: r.athleteId,
      name: r.name,
      date: r.date,
      summary: r.date ? screenSummary(r.results) : null,
    }));
    return json(out);
  }, "Loading the screen overview failed");
}
