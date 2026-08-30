import { getScope, canSeeAthlete } from "@/lib/scope";
import {
  getAthlete,
  listSessions,
  listRecovery,
  listSetbacks,
} from "@/lib/data";
import { guidance, CNS_DEFAULT_PCT } from "@/lib/setback";
import { json, unauthorized, forbidden, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today's guidance plus the athlete's open and recent flags. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();

  const athlete = await getAthlete(id);
  if (!athlete || athlete.archived) return notFound();

  const [sessions, entries, open, history] = await Promise.all([
    listSessions(id),
    listRecovery(id),
    listSetbacks(id, { openOnly: true }),
    listSetbacks(id),
  ]);

  return json({
    guidance: guidance(open, sessions, entries),
    open,
    history,
    cnsThresholdPct: athlete.cnsThresholdPct ?? CNS_DEFAULT_PCT,
    cnsIsDefault: athlete.cnsThresholdPct == null,
  });
}
