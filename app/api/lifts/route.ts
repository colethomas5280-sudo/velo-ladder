import { getScope } from "@/lib/scope";
import { listLifts, createLift } from "@/lib/data";
import { MAX_LIFT_NAME, isLiftMode } from "@/lib/strength";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The lift menu. Everyone signed in reads it — an athlete's own log is
 * unreadable without it, since a logged day holds keys and nothing else.
 * Only a coach changes it.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  return guard(async () => json(await listLifts()), "Loading the lift menu failed");
}

export async function POST(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return badRequest("Give the lift a name");
  if (name.length > MAX_LIFT_NAME)
    return badRequest(`Keep the name under ${MAX_LIFT_NAME} characters`);
  if (b.mode !== undefined && !isLiftMode(b.mode))
    return badRequest("mode must be 'load' or 'reps'");

  return guard(
    async () =>
      json(
        await createLift({
          name,
          group: typeof b.group === "string" ? b.group : "",
          mode: isLiftMode(b.mode) ? b.mode : "load",
          help: typeof b.help === "string" ? b.help : "",
        }),
        201,
      ),
    "Adding the lift failed",
  );
}
