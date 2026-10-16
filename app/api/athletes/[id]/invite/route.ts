import { getScope } from "@/lib/scope";
import {
  createInvite,
  revokeInvite,
  getAthlete,
  INVITE_TTL_DAYS,
} from "@/lib/data";
import {
  normalizePhone,
  samePhone,
  inviteMessage,
  sendSms,
  smsConfigured,
  type SendResult,
} from "@/lib/sms";
import { sendInviteEmail, emailConfigured, type EmailResult } from "@/lib/email";
import { json, unauthorized, forbidden, notFound, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Base URL for links we hand out. AUTH_URL is authoritative in production. */
function origin(request: Request): string {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

/**
 * POST /api/athletes/[id]/invite — issue a fresh single-use invite link.
 *
 * With `to`, also text it. With `channel: "email"`, email it to the athlete's
 * own stored login address (never an address from the request). The link comes
 * back either way: a message that fails to send must not take the invite with
 * it, because the coach standing in front of the athlete still needs something
 * to hand over.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const body = (await request.json().catch(() => ({}))) as {
    to?: unknown;
    channel?: unknown;
  };
  const requested = typeof body.to === "string" ? body.to.trim() : "";
  const wantsEmail = body.channel === "email";

  const athlete = await getAthlete(id);
  if (!athlete || athlete.archived) return notFound();

  /*
   * A destination must be one of THIS athlete's own numbers.
   *
   * Without that check the endpoint is an SMS relay that will send attacker-
   * chosen text to an attacker-chosen number on the facility's Twilio account,
   * and the single shared coach password is the only thing in front of it.
   * Numbers are compared after normalising, so the same line typed a different
   * way still matches.
   */
  let to: string | null = null;
  if (requested) {
    const dest = normalizePhone(requested);
    if (!dest) return badRequest("That phone number doesn't look right");
    if (!samePhone(dest, athlete.phone) && !samePhone(dest, athlete.guardianPhone))
      return badRequest(
        "That number isn't on this athlete's profile. Save it there first.",
      );
    to = dest;
  }

  const token = await createInvite(id);
  if (!token) return notFound();
  const url = `${origin(request)}/join/${token}`;

  let sms: SendResult | null = null;
  if (to) sms = await sendSms(to, inviteMessage(athlete.name, url));

  // The address comes from the athlete's row and from nowhere else.
  let email: EmailResult | null = null;
  if (wantsEmail)
    email = await sendInviteEmail(athlete.inviteEmail ?? "", athlete.name, url);

  return json({
    url,
    expiresInDays: INVITE_TTL_DAYS,
    // What the client needs to decide between "sent" and "open Messages".
    sms,
    smsConfigured: smsConfigured(),
    email,
    emailConfigured: emailConfigured(),
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
