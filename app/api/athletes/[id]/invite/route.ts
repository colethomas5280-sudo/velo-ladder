import { getScope } from "@/lib/scope";
import { createInvite, revokeInvite, INVITE_TTL_DAYS } from "@/lib/data";
import { json, unauthorized, forbidden, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Base URL for links we hand out. AUTH_URL is authoritative in production. */
function origin(request: Request): string {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

/** POST /api/athletes/[id]/invite — issue a fresh single-use invite link. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const token = await createInvite(id);
  if (!token) return notFound();

  return json({
    url: `${origin(request)}/join/${token}`,
    expiresInDays: INVITE_TTL_DAYS,
  });
}

/** DELETE — cancel an outstanding invite without setting a password. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  await revokeInvite(id);
  return json({ ok: true });
}
