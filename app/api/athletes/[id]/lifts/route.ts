import { getScope, canSeeAthlete } from "@/lib/scope";
import { listLiftDays, upsertLiftDay, deleteLiftDay, listLifts } from "@/lib/data";
import { parseLiftInput } from "@/lib/liftInput";
import { liftMenu } from "@/lib/strength";
import { isCalendarDate, todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An athlete logs their own lifting, the way they log their own check-in and
 * unlike the movement screen, which is administered. They are the one holding
 * the phone in the weight room; a coach can write for them too, which is what
 * `canSeeAthlete` on the write path buys.
 *
 * Nothing here is coach-only, so there is no `visible…` filter: a lifting day
 * holds the athlete's own numbers and their own note.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  return guard(
    async () => json(await listLiftDays(id)),
    "Loading the lifting log failed",
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();

  // The menu comes from the database now, so what is loggable is whatever
  // the coach currently has on it.
  const menu = liftMenu(await listLifts());
  const parsed = parseLiftInput(
    await request.json().catch(() => ({})),
    todayISO(),
    menu,
  );
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid lifting day");

  return guard(
    async () => json(await upsertLiftDay(id, parsed.value!, scope.email), 201),
    "Saving the lifting day failed",
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!isCalendarDate(date)) return badRequest("date required");
  return guard(async () => {
    await deleteLiftDay(id, date);
    return json({ ok: true });
  }, "Deleting the lifting day failed");
}
