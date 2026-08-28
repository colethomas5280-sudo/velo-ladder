import { getScope } from "@/lib/scope";
import { json, unauthorized } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  return json({ role: scope.role, email: scope.email });
}
