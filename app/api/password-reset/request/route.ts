import { after } from "next/server";
import { requestReset } from "@/lib/passwordReset";
import { sendResetEmail, emailConfigured } from "@/lib/email";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Public, because someone who cannot sign in has no session. So it must tell a
 * stranger nothing: every request, whatever it was, gets this one answer. The
 * lookup, the claim and the email run AFTER the response goes out (after()),
 * which also stops response time from revealing whether an athlete exists.
 *
 * Nothing in the log or the response may contain a token.
 */
const ANSWER = () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body?.email === "string" ? body.email : "";
  const origin = appOrigin(request);

  /*
   * In production the link's origin must come from AUTH_URL. Without it
   * appOrigin falls back to the request's Host header, which a caller controls,
   * so a missing AUTH_URL would let anyone mail a poisoned link. Skip the work
   * entirely and answer the same as ever.
   */
  const originTrusted = process.env.NODE_ENV !== "production" || !!process.env.AUTH_URL;

  // Not configured means no claim at all, so no cooldown is burned for an
  // email that was never going to be sent.
  if (email.trim() && emailConfigured() && originTrusted) {
    after(async () => {
      try {
        const claim = await requestReset(email);
        if (!claim) return;
        const sent = await sendResetEmail(
          claim.to,
          claim.name,
          `${origin}/reset-password/${claim.token}`,
        );
        if (!sent.sent) {
          console.error("[password-reset] send failed:", sent.reason, sent.detail ?? "");
        }
      } catch (e) {
        console.error("[password-reset] failed:", e instanceof Error ? e.message : "unknown error");
      }
    });
  }
  return ANSWER();
}
