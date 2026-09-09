import { getScope, canSeeAthlete } from "@/lib/scope";
import { listScreens, upsertScreen, deleteScreen } from "@/lib/data";
import { visibleScreen } from "@/lib/screen";
import { parseScreenInput } from "@/lib/screenInput";
import { todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An athlete reads their own screens; only a coach records or removes one.
 * Unlike the recovery check-in, which the athlete fills in themselves, a
 * screen is administered — there is no athlete-facing write path here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  const isCoach = scope.role === "coach";
  return guard(async () => {
    const screens = await listScreens(id);
    return json(screens.map((s) => visibleScreen(s, isCoach)));
  }, "Loading screens failed");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const parsed = parseScreenInput(
    await request.json().catch(() => ({})),
    todayISO(),
  );
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid screen");

  return guard(
    async () => json(await upsertScreen(id, parsed.value!, scope.email), 201),
    "Saving the screen failed",
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date required");
  return guard(async () => {
    await deleteScreen(id, date);
    return json({ ok: true });
  }, "Deleting the screen failed");
}
