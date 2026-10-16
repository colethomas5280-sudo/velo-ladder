import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/data";

/*
 * Password reset, data layer only. No HTTP lives here.
 *
 * The raw token exists in memory long enough to be put in an email and nowhere
 * else: the database holds its SHA-256. SHA-256 rather than bcrypt is right
 * because the token is 32 random bytes, so there is nothing to brute-force and
 * the lookup has to be by exact hash.
 */

export const RESET_TTL_MINUTES = 60;
export const RESET_COOLDOWN_MINUTES = 10;
/** Reset emails allowed per rolling 24 hours, app-wide. Resend's free plan is about 100 a day and invites share it. */
export const RESET_DAILY_CAP = 30;

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ResetClaim = { to: string; name: string; token: string };

/**
 * Try to issue a reset for the athlete who logs in with this email.
 *
 * Returns the claim (including the one and only copy of the raw token) when a
 * link should be emailed, and null in every other case: unknown address,
 * archived athlete, still inside the cooldown, or the app-wide cap reached. The
 * caller must treat all of those the same, so nothing here distinguishes them.
 *
 * The claim is one UPDATE whose WHERE clause carries the cooldown, so two
 * simultaneous requests cannot both pass it (the row lock serialises them). A
 * capped or cooled-down request writes nothing and burns no cooldown.
 */
export async function requestReset(rawEmail: string): Promise<ResetClaim | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return null;

  const [{ n }] = (await sql`
    SELECT count(*)::int AS n FROM password_reset_sends
    WHERE sent_at > now() - interval '24 hours'
  `) as { n: number }[];
  if (n >= RESET_DAILY_CAP) return null;

  const token = newResetToken();
  const rows = (await sql`
    UPDATE athletes
    SET reset_token_hash   = ${hashResetToken(token)},
        reset_expires      = now() + ${`${RESET_TTL_MINUTES} minutes`}::interval,
        reset_requested_at = now()
    WHERE id = (
      SELECT id FROM athletes
      WHERE archived = false AND lower(invite_email) = ${email}
      ORDER BY created_at, id
      LIMIT 1
    )
    AND (reset_requested_at IS NULL
         OR reset_requested_at < now() - ${`${RESET_COOLDOWN_MINUTES} minutes`}::interval)
    RETURNING name, invite_email
  `) as { name: string; invite_email: string }[];
  const r = rows[0];
  if (!r) return null;

  await sql`INSERT INTO password_reset_sends DEFAULT VALUES`;
  await sql`DELETE FROM password_reset_sends WHERE sent_at < now() - interval '2 days'`;
  return { to: r.invite_email, name: r.name, token };
}

/** Look up a live link. Null for unknown, expired, used or archived alike. */
export async function getResetTarget(
  token: string,
): Promise<{ id: string; name: string } | null> {
  if (!token) return null;
  const rows = (await sql`
    SELECT id, name FROM athletes
    WHERE reset_token_hash = ${hashResetToken(token)}
      AND archived = false
      AND reset_expires IS NOT NULL
      AND reset_expires > now()
    LIMIT 1
  `) as { id: string; name: string }[];
  const r = rows[0];
  return r ? { id: String(r.id), name: String(r.name) } : null;
}

/**
 * Spend the link: set the password and clear the reset and any pending invite
 * in ONE statement, so the same link cannot be used twice even if two requests
 * arrive together. reset_requested_at is left alone, so the cooldown holds.
 * Returns the login email, or null if the link was already used or expired.
 */
export async function consumeReset(
  token: string,
  password: string,
): Promise<{ email: string | null } | null> {
  if (!token) return null;
  const hash = await hashPassword(password);
  const rows = (await sql`
    UPDATE athletes
    SET password_hash  = ${hash},
        reset_token_hash = NULL,
        reset_expires    = NULL,
        invite_token     = NULL,
        invite_expires   = NULL
    WHERE reset_token_hash = ${hashResetToken(token)}
      AND archived = false
      AND reset_expires IS NOT NULL
      AND reset_expires > now()
    RETURNING invite_email
  `) as { invite_email: string | null }[];
  const r = rows[0];
  return r ? { email: r.invite_email ?? null } : null;
}
