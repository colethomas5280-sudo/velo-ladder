import { consumeReset, getResetTarget } from "@/lib/passwordReset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: NO_STORE });
const expired = () => refuse("This reset link has expired or was already used", 404);

/**
 * Public: the token is the credential. A password that is too short is refused
 * BEFORE the token is touched, so a typo does not burn the link.
 *
 * A cheap indexed lookup (getResetTarget) runs before consumeReset, which
 * bcrypt-hashes first. Without it, a flood of junk tokens at this public
 * endpoint would cost one hash each. consumeReset stays the authority: if the
 * link is spent between the two calls it still returns null.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    password?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return refuse("Send a token and a password", 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (password.length < 6) return refuse("Password must be at least 6 characters", 400);

  if (!(await getResetTarget(token))) return expired();

  const done = await consumeReset(token, password);
  if (!done) return expired();
  return Response.json({ email: done.email }, { headers: NO_STORE });
}
