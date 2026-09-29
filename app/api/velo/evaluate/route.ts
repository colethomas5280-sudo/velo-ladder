import { getScope } from "@/lib/scope";
import { listVeloRanges } from "@/lib/veloData";
import { evaluate, type Hand } from "@/lib/veloPlacement";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Never let any response this route produces be cached: the 401, the 403,
 * the 400s, a 500 from `guard`, or the 200 itself. Same helper, same reason
 * as the two GET routes beside it.
 */
function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/**
 * Places one session against one ladder row. Coach only.
 *
 * The classification and its coaching wording (the disclosures, the labels)
 * live in lib/veloPlacement.ts, which no client component may import. So the
 * browser sends three radar numbers and a row slug, and this route does the
 * rest: it looks the row up itself, and never takes band data from the
 * request, so a caller cannot place a session against a band of their own.
 *
 * The coach gate runs first, before the body is read and before any data is
 * loaded. A non-coach POST touches nothing.
 */
export async function POST(request: Request) {
  const scope = await getScope();
  if (!scope) return noStore(unauthorized());
  if (scope.role !== "coach") return noStore(forbidden());

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStore(badRequest("Send a JSON body with slug, hand, floor, sitting and peak."));
  }
  const { slug, hand, floor, sitting, peak } = body;
  if (typeof slug !== "string" || !slug) {
    return noStore(badRequest("A level is required."));
  }
  if (hand != null && hand !== "R" && hand !== "L") {
    return noStore(badRequest('hand must be "R" or "L" when given.'));
  }

  return noStore(
    await guard(async () => {
      const range = (await listVeloRanges()).find((r) => r.slug === slug);
      if (!range) return badRequest(`No such level: ${slug}`);

      const result = evaluate({
        range,
        hand: (hand ?? undefined) as Hand | undefined,
        // evaluate refuses anything that is not a finite number in range.
        floor: floor as number,
        sitting: sitting as number,
        peak: peak as number,
      });
      if (!result.ok) return badRequest(result.error);
      return json(result);
    }, "Placing the session failed"),
  );
}
