/*
 * Texting invite links.
 *
 * Two ways out, because the automated one has a gate in front of it. US
 * carriers filter unregistered business traffic (A2P 10DLC), so until that
 * registration is done, Twilio credentials either don't exist or their
 * messages quietly don't arrive. The handoff path needs no account at all:
 * the coach's own Messages app opens pre-filled and the text comes from the
 * number athletes and parents already recognise.
 *
 * `smsConfigured()` is what the UI branches on. Nothing here throws when
 * Twilio is absent — that is the normal, supported state.
 */

/** Digits-only US numbers plus anything already in E.164. null = unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already international: keep the country code the user gave us.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const d = trimmed.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** +15551234567 -> (555) 123-4567. Non-US stays as-is. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** True when two numbers are the same line, however they were typed. */
export function samePhone(a: string | null, b: string | null): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  return x != null && x === y;
}

/**
 * The invite text.
 *
 * Deliberately plain ASCII: an em dash or a curly quote pushes the whole
 * message out of the GSM-7 alphabet and into UCS-2, which cuts the segment
 * size from 160 characters to 70 and doubles the cost of every send.
 *
 * First name only, since that is how a text from a coach reads.
 */
export function inviteMessage(name: string, url: string): string {
  const first = name.trim().split(/\s+/)[0] || "there";
  return (
    `Hi ${first}, you've been added to Velo Ladder. ` +
    `Set your password here: ${url} ` +
    `(link works once and expires in 14 days)`
  );
}

/**
 * A link that opens the coach's own SMS app with recipient and body filled in.
 *
 * The "?&" is not a typo. iOS historically wanted `&body=` and Android wants
 * `?body=`; `?&body=` is the spelling both have always accepted.
 */
export function smsHref(to: string, body: string): string {
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

/* ------------------------------------------------------------------ *
 * Twilio — only reachable once all three variables are set.
 * ------------------------------------------------------------------ */

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM?.trim();
  return sid && token && from ? { sid, token, from } : null;
}

export function smsConfigured(): boolean {
  return creds() !== null;
}

export type SendResult =
  | { sent: true; to: string }
  | { sent: false; reason: "not_configured" | "bad_number" | "send_failed"; detail?: string };

/**
 * Send one message. Never throws: a failed text must not cost the caller the
 * invite link it was carrying, so every failure comes back as a value.
 */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const c = creds();
  if (!c) return { sent: false, reason: "not_configured" };

  const dest = normalizePhone(to);
  if (!dest) return { sent: false, reason: "bad_number" };

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          // Basic auth; the token never appears in a log line or a response.
          Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: dest, From: c.from, Body: body }),
      },
    );
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        message?: string;
        code?: number;
      } | null;
      return {
        sent: false,
        reason: "send_failed",
        // Twilio's own wording is far more useful than a status code: it is
        // what says "unregistered 10DLC" rather than just "400".
        detail: payload?.message
          ? `${payload.message}${payload.code ? ` (Twilio ${payload.code})` : ""}`
          : `Twilio returned ${res.status}`,
      };
    }
    return { sent: true, to: dest };
  } catch (e) {
    return {
      sent: false,
      reason: "send_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Who the invite goes to
 * ------------------------------------------------------------------ */

export type Recipient = "athlete" | "guardian";

/**
 * Which number to preselect. A youth athlete's invite should land with the
 * parent who will actually set the password, so the guardian wins whenever
 * one is on file and the athlete is Youth. Everyone else gets their own
 * phone. The coach can always override; this only decides the default.
 */
export function defaultRecipient(a: {
  phone: string | null;
  guardianPhone: string | null;
  level: string | null;
}): Recipient | null {
  const own = normalizePhone(a.phone);
  const guardian = normalizePhone(a.guardianPhone);
  if (a.level === "Youth" && guardian) return "guardian";
  if (own) return "athlete";
  return guardian ? "guardian" : null;
}
