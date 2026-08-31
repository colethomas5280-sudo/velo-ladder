import { getInvite, consumeInvite } from "@/lib/data";
import { json, notFound, badRequest } from "@/lib/http";
import { LEVELS, type Level, isValidBirthDate } from "@/lib/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public — no session required; the token is the credential. It only ever
 * reveals the invited athlete's own name and login email, and only while the
 * invite is unused and unexpired.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invite = await getInvite(token);
  if (!invite) return notFound();
  return json({ name: invite.name, email: invite.email });
}

/** Spend the invite: the athlete sets their own password. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: unknown;
    level?: unknown;
    birthDate?: unknown;
  };
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6)
    return badRequest("Password must be at least 6 characters");

  const level = LEVELS.includes(body.level as Level)
    ? (body.level as Level)
    : null;
  const birthDate = isValidBirthDate(body.birthDate) ? body.birthDate : null;

  const athlete = await consumeInvite(token, password, level, birthDate);
  if (!athlete)
    return notFound("This invite link has already been used or has expired");

  return json({ email: athlete.email, name: athlete.name });
}
