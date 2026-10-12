import { getScope } from "@/lib/scope";
import { smsConfigured } from "@/lib/sms";
import { json, unauthorized, forbidden } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether automated texting is wired up, so the roster can label its button
 * correctly before anyone clicks it. Coach-only, and it reports a boolean —
 * never the account SID, the token or the sending number.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return json({ configured: smsConfigured() });
}
