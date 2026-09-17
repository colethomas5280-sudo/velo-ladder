import { getScope, canSeeAthlete } from "@/lib/scope";
import {
  listDeliveryScreens,
  upsertDeliveryScreen,
  deleteDeliveryScreen,
} from "@/lib/data";
import { visibleScreen } from "@/lib/screen";
import { parseDeliveryInput } from "@/lib/deliveryInput";
import { isCalendarDate, todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An athlete reads their own assessments; only a coach records or removes one.
 * Same rule as the movement screen, and for the same reason: this is
 * administered, not self-reported.
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
    const rows = await listDeliveryScreens(id);
    return json(rows.map((d) => visibleScreen(d, isCoach)));
  }, "Loading the delivery assessments failed");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const parsed = parseDeliveryInput(
    await request.json().catch(() => ({})),
    todayISO(),
  );
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid assessment");

  return guard(
    async () => json(await upsertDeliveryScreen(id, parsed.value!, scope.email), 201),
    "Saving the delivery assessment failed",
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
  if (!isCalendarDate(date)) return badRequest("date required");
  return guard(async () => {
    await deleteDeliveryScreen(id, date);
    return json({ ok: true });
  }, "Deleting the delivery assessment failed");
}
