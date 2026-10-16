/*
 * Emailing invite and password-reset links.
 *
 * Resend, over its plain HTTP API, from a domain Cole controls
 * (powerpitcherpathway.com). Nothing here throws when it is not set up:
 * `emailConfigured()` is false until both variables exist, and a send that
 * fails comes back as a value so the caller still has the invite link to
 * hand over. Same contract as `lib/sms.ts`, on purpose.
 *
 * The recipient is never taken from a request. The invite and reset routes both
 * pass the athlete's own stored login email, so this cannot be used to send
 * mail from the facility's domain to an address of someone's choosing.
 */

export type EmailResult =
  | { sent: true; to: string }
  | {
      sent: false;
      reason: "not_configured" | "bad_address" | "send_failed";
      detail?: string;
    };

function creds() {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return key && from ? { key, from } : null;
}

export function emailConfigured(): boolean {
  return creds() !== null;
}

/**
 * Deliberately modest: one @, a dot in the domain, and no whitespace of any
 * kind. The whitespace rule is the one that matters, since a newline in an
 * address is how a header gets injected.
 */
export function isEmailAddress(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * A bare name-and-link email is what phishing looks like to a spam filter, and
 * it also reads cold to a parent. So the note says who it is from, what the app
 * is for, and that it is safe to ignore. Kept short and with one link only.
 */
const SIGNATURE = ["Coach Cole", "FAST Performance, Denver"];

/** First name only, as a note from a coach reads. */
export function inviteEmailContent(name: string, url: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const text =
    `Hi ${first},\n\n` +
    `Coach Cole here at FAST Performance. I've added you to Velo Ladder, ` +
    `the app we use to track your velocity and recovery.\n\n` +
    `Set your password here to sign in:\n\n${url}\n\n` +
    `The link works once and expires in 14 days.\n\n` +
    `If you weren't expecting this, you can ignore this email and nothing ` +
    `will happen. Or just reply and let me know.\n\n` +
    SIGNATURE.join("\n");
  const html =
    `<p>Hi ${esc(first)},</p>` +
    `<p>Coach Cole here at FAST Performance. I&rsquo;ve added you to Velo ` +
    `Ladder, the app we use to track your velocity and recovery.</p>` +
    `<p>Set your password here to sign in:</p>` +
    `<p><a href="${esc(url)}">${esc(url)}</a></p>` +
    `<p>The link works once and expires in 14 days.</p>` +
    `<p>If you weren&rsquo;t expecting this, you can ignore this email and ` +
    `nothing will happen. Or just reply and let me know.</p>` +
    `<p>${SIGNATURE.map(esc).join("<br>")}</p>`;
  return { subject: "Set up your Velo Ladder login", text, html };
}

/** First name only. Says what happened, how long it lasts, and that ignoring it is safe. */
export function resetEmailContent(name: string, url: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const text =
    `Hi ${first},\n\n` +
    `Someone asked to reset the password on your Velo Ladder account. ` +
    `If that was you, choose a new one here:\n\n${url}\n\n` +
    `The link works once and expires in 1 hour.\n\n` +
    `If it wasn't you, ignore this email and nothing will happen. ` +
    `Your password hasn't changed.\n\n` +
    SIGNATURE.join("\n");
  const html =
    `<p>Hi ${esc(first)},</p>` +
    `<p>Someone asked to reset the password on your Velo Ladder account. ` +
    `If that was you, choose a new one here:</p>` +
    `<p><a href="${esc(url)}">${esc(url)}</a></p>` +
    `<p>The link works once and expires in 1 hour.</p>` +
    `<p>If it wasn&rsquo;t you, ignore this email and nothing will happen. ` +
    `Your password hasn&rsquo;t changed.</p>` +
    `<p>${SIGNATURE.map(esc).join("<br>")}</p>`;
  return { subject: "Reset your Velo Ladder password", text, html };
}

/** Replies go to the first coach address, if there is one. */
function replyTo(): string | null {
  const first = process.env.COACH_EMAILS?.split(",")[0]?.trim();
  return first && isEmailAddress(first) ? first : null;
}

/** Everything both emails share: the gate, the address check and the Resend call. */
async function deliver(
  to: string,
  content: { subject: string; text: string; html: string },
): Promise<EmailResult> {
  const c = creds();
  if (!c) return { sent: false, reason: "not_configured" };
  if (!isEmailAddress(to)) return { sent: false, reason: "bad_address" };

  const reply = replyTo();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        // The key travels only in this header, never in a log or a response.
        Authorization: `Bearer ${c.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: c.from,
        to: [to],
        subject: content.subject,
        text: content.text,
        html: content.html,
        ...(reply ? { reply_to: reply } : {}),
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      return {
        sent: false,
        reason: "send_failed",
        // Resend's own wording is what says "domain is not verified" rather
        // than just "403".
        detail: payload?.message ?? `Resend returned ${res.status}`,
      };
    }
    return { sent: true, to };
  } catch (e) {
    return {
      sent: false,
      reason: "send_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Never throws: a failed email must not cost the caller the link it carried. */
export function sendInviteEmail(to: string, name: string, url: string): Promise<EmailResult> {
  return deliver(to, inviteEmailContent(name, url));
}

/** Never throws: a failed email must not cost the caller the answer it owes. */
export function sendResetEmail(to: string, name: string, url: string): Promise<EmailResult> {
  return deliver(to, resetEmailContent(name, url));
}
