import { getScope } from "@/lib/scope";
import { updateLift, liftUsage } from "@/lib/data";
import { MAX_LIFT_NAME, isLiftMode } from "@/lib/strength";
import {
  json,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  guard,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.name === "string" && !b.name.trim())
    return badRequest("Give the lift a name");
  if (typeof b.name === "string" && b.name.trim().length > MAX_LIFT_NAME)
    return badRequest(`Keep the name under ${MAX_LIFT_NAME} characters`);
  if (b.mode !== undefined && !isLiftMode(b.mode))
    return badRequest("mode must be 'load' or 'reps'");

  /*
   * Changing how a lift is read re-reads its whole history: a bench press
   * switched to `reps` would start charting reps for every session ever
   * logged against it. Allowed — a lift set up wrong has to be fixable — but
   * refused once there is history to reinterpret, where the honest move is a
   * new lift rather than a silent rewrite of the old one.
   */
  if (isLiftMode(b.mode)) {
    const used = await liftUsage(key);
    if (used > 0) {
      const current = await updateLift(key, {});
      if (!current) return notFound();
      if (current.mode !== b.mode)
        return badRequest(
          `${current.name} already has ${used} session${used === 1 ? "" : "s"} ` +
            `logged against it. Changing how it's measured would re-read all of ` +
            `them — add it as a new lift instead.`,
        );
    }
  }

  return guard(async () => {
    const updated = await updateLift(key, {
      name: typeof b.name === "string" ? b.name : undefined,
      group: typeof b.group === "string" ? b.group : undefined,
      mode: isLiftMode(b.mode) ? b.mode : undefined,
      help: typeof b.help === "string" ? b.help : undefined,
      position: typeof b.position === "number" ? b.position : undefined,
      archived: typeof b.archived === "boolean" ? b.archived : undefined,
    });
    if (!updated) return notFound();
    return json(updated);
  }, "Saving the lift failed");
}

/**
 * Soft delete, always. A lift with history behind it cannot be removed
 * without orphaning it, and one without history is cheap enough to keep —
 * so the menu hides it and every session that used it still reads.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(async () => {
    const updated = await updateLift(key, { archived: true });
    if (!updated) return notFound();
    return json({ ok: true });
  }, "Removing the lift failed");
}
