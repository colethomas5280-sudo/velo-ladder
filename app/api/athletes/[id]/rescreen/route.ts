import { getScope } from "@/lib/scope";
import { callRescreen, getAthlete } from "@/lib/data";
import { json, unauthorized, forbidden, badRequest, notFound, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Call for a re-screen by hand.
 *
 * The third of Cole's triggers has no data behind it: a mechanical change
 * with the pitching coach is a conversation, not a row in this database. So
 * it is a button, and the reason is free text because "we changed his glove
 * side" is not a value anyone would have thought to add to a list.
 *
 * Coach only. An athlete deciding they need re-screening is a conversation
 * too, and it isn't this one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  if (!reason) return badRequest("Say why — it's what makes the flag readable later");

  return guard(async () => {
    if (!(await getAthlete(id))) return notFound();
    await callRescreen(id, reason);
    return json({ ok: true });
  }, "Calling the re-screen failed");
}
