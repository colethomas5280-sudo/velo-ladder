# Self-service password reset — design

**Date:** 2026-10-16
**Status:** awaiting Cole's review
**Builds on:** the invite email (`lib/email.ts`, commit `a267493`), the invite/join
flow (`lib/data.ts` `createInvite` / `consumeInvite`, `app/join/[token]`)

## What this is

Today an athlete who forgets their password has to ask Cole to press **New invite**.
That works, but it makes Cole the help desk. This adds a **Forgot password?** link to
the login screen that lets the athlete get themselves a reset link by email.

Athletes only. Coach sign-in is one shared `COACH_PASSWORD` in Vercel, not a
per-person password, so there is nothing to reset.

## Why this needs care

A reset flow is a second way into every athlete account, and its entry point has to be
public. Three things follow, and the design is mostly about them:

1. **Whoever controls the email controls the account.** So the link must be
   unguessable, short-lived and single-use.
2. **A public form that sends email is an email-bombing tool.** Nothing in the app
   limits request rates today. Someone typing an athlete's address repeatedly would
   flood that inbox from the facility's domain, hurt the sender reputation that was
   just repaired, and could use up Resend's free allowance (about 100 emails a day) so
   real invites stop going out.
3. **The form must not reveal who is on the roster.** "No account with that email"
   tells a stranger which addresses belong to FAST athletes, many of whom are minors.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Token storage | New columns, token stored **hashed** | Cole chose this over reusing the invite columns. A reset request must not cancel a pending invite, a database copy must not contain working links, and a reset wants a 1-hour life, not 14 days. |
| Lifetime | 1 hour, single use | Short enough that an old email in an inbox is not a standing key. |
| Cooldown | 1 email per athlete per 10 minutes | Bounds the flooding of one inbox. |
| App-wide cap | 20 reset emails per rolling hour | Bounds abuse of the Resend allowance. Over the cap, the response is unchanged and nothing is sent. |
| Response to the request form | Identical for known, unknown, cooled-down and capped | No roster enumeration. |
| After resetting | Signed straight in | Same as redeeming an invite. The link already proved control of the email. |
| New-password rule | Minimum 6 characters, as `join` | Reset and invite should not disagree. Raising the rule is a separate decision. |
| Unused invite | Cleared when a reset completes | An old invite link sent to the wrong person must not be able to overwrite a password the athlete has just chosen. |
| Not configured | Page says reset is unavailable, ask the coach for a new invite | The page must never promise an email that cannot be sent. |

## The flow

1. **Login page** gains a "Forgot password?" link under the form, to `/forgot-password`.
2. **`/forgot-password`** — one field, the email. Submitting POSTs to
   `/api/password-reset/request`. The page always then shows: *"If that email is on a
   Velo Ladder account, we've sent a reset link. It works for 1 hour."*
3. **The request route** (public) normalises the email (trim, lowercase), then in the
   background (`after()`, so response time does not reveal whether an athlete exists):
   - finds one active athlete whose `invite_email` matches;
   - in **one statement**, claims a reset: writes `reset_token_hash`, `reset_expires`
     (now + 1 hour) and `reset_requested_at` (now), only if that athlete's last request
     is older than 10 minutes AND fewer than 20 requests happened app-wide in the last
     hour;
   - if the claim succeeded, emails the link to the athlete's **stored** address.
   The raw token exists only in memory, long enough to put it in the email.
4. **The email** is in the invite's voice: from Coach Cole at FAST Performance, subject
   "Reset your Velo Ladder password", one link to `/reset-password/<token>`, "works once
   and expires in 1 hour", and "didn't ask for this? Ignore it — your password hasn't
   changed." Replies go to the first coach address.
5. **`/reset-password/[token]`** — a server component hashes the token and looks it up.
   Invalid, expired, used or archived all show the same message with a link back to
   `/forgot-password`. A valid token shows a "new password" form (entered twice).
6. **The confirm route** (public) takes `{ token, password }` and in **one statement**
   sets `password_hash`, clears the three reset columns and the invite token, matching
   only an unexpired hash of an active athlete. Zero rows updated means the link was
   already used or has expired. On success the page signs the athlete in and sends them
   to `/`.

## Data

Schema **v29**, three nullable columns on `athletes`, added with
`ADD COLUMN IF NOT EXISTS`:

| Column | Type | Meaning |
|---|---|---|
| `reset_token_hash` | `text` | SHA-256 (hex) of the raw token. Unique index where not null. |
| `reset_expires` | `timestamptz` | When the link stops working. |
| `reset_requested_at` | `timestamptz` | When a reset email was last issued. Drives both the per-athlete cooldown and the app-wide count. |

SHA-256 rather than bcrypt is correct here: the token is 32 random bytes, so there is
nothing to brute-force, and the lookup has to be by exact hash.

`db/schema.sql` is regenerated (`npx tsx scripts/schema-sql.ts`) in the same commit.
The new columns are **never** returned by any athlete listing or serialiser.

## Code

| Piece | Purpose |
|---|---|
| `lib/passwordReset.ts` | `newResetToken()`, `hashResetToken()`, `requestReset(email)`, `getResetTarget(token)`, `consumeReset(token, password)`. Pure data logic; no HTTP. |
| `lib/email.ts` | Gains `resetEmailContent()` and `sendResetEmail()` beside the invite versions, same never-throws contract. |
| `app/api/password-reset/request/route.ts` | Public POST. Always the same response. |
| `app/api/password-reset/confirm/route.ts` | Public POST. |
| `app/forgot-password/page.tsx`, `app/reset-password/[token]/page.tsx` | The two pages. The reset page sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, because the URL carries a secret. |
| `components/LoginForm.tsx` | The link. |
| `lib/schema.ts` | v29 migration. |

There is no route middleware in this app, so the new pages and routes are public by
default. Nothing needs to be opened up.

## Behaviour worth stating exactly

- **Same email, two athletes.** `invite_email` is not unique, so siblings could share a
  parent's address. Sign-in already takes whichever row comes first. Reset targets
  exactly one athlete, chosen `ORDER BY created_at, id`, and sign-in is left alone. If
  two athletes share an address, the one reset reaches may not be the one the parent
  meant. **This is flagged, not solved**; see Open questions.
- **An athlete invited but who never set a password** can use reset to set one. It works
  as a self-serve invite.
- **A request for a coach address, or any address with no athlete,** does nothing and
  returns the normal response.
- **If sending fails,** the request still returns the normal response (the form cannot
  know), and the failure is logged server-side without the token. The claimed cooldown
  stands, which is correct: it is what limits retries.

## Testing

Written test-first, then each assertion proven by breaking the code on purpose.

- **No enumeration:** known, unknown, archived, cooled-down and capped requests return
  byte-identical status and body.
- **Delivery:** an unknown address sends nothing; the email goes only to the athlete's
  stored address, never one from the request; the raw token never appears in any
  response.
- **Limits:** a second request inside 10 minutes sends nothing; the 21st request in an
  hour sends nothing; both recover after the window.
- **Token:** works once, fails after use, fails after expiry, fails for an archived
  athlete, fails for a hash-looking string (the stored hash is not itself a token).
  Two simultaneous confirms: exactly one succeeds.
- **Side effects:** completing a reset clears the invite token; a reset request does
  **not** disturb a pending invite.
- **Migration:** run v28 → v29 on a database that already holds athletes (and a pending
  invite), as the standing rule requires, then check old rows are untouched and the new
  columns are null.
- **Serialisers:** the three columns appear in no athlete payload, including the roster
  overview and the athlete's own profile.
- **UI:** the forms, the always-same confirmation, the invalid-link page, the
  not-configured page, and the sign-in after success.
- Full gate (`npm run verify`) green from a clean build.

## Deploy

1. Push. 2. Run `/api/setup` once and confirm `schemaVersion` is **29** (this is a
schema change). 3. Try it with a test athlete: request a reset, receive the email, set a
new password, sign in with it. Resend is already live and verified.

## Out of scope, deliberately

- **Coach reset.** Nothing to reset per person.
- **Cancelling sessions that already exist.** Sessions are stateless tokens; the app has
  no way to revoke them today. A reset does not sign other devices out.
- **Limits on wrong-password attempts at the sign-in box.** There are none today. This is
  a real gap, separate from this feature, and worth its own look afterwards.
- **A stronger password rule.**

## Open questions

1. **Do any two athletes share a login email today?** If yes, reset can only ever reach
   one of them. The clean fix is a uniqueness rule on active athletes' emails, which is a
   larger decision than this feature. Cole can check the roster. The design above is safe
   either way; it just may not reach the right sibling.
