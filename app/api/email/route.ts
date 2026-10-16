import { getScope } from "@/lib/scope";
import { emailConfigured } from "@/lib/email";
import { json, unauthorized, forbidden } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether emailing invites is wired up, so the roster can label its button
 * correctly before anyone clicks it. Coach-only, and it reports a boolean —
 * never the API key or the sending address.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return json({ configured: emailConfigured() });
}
