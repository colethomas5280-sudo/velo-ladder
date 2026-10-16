# Self-service password reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete who forgot their password get a reset link by email from the login screen, set a new password, and be signed in.

**Architecture:** Three nullable columns on `athletes` plus a tiny `password_reset_sends` log (schema v29). A pure data layer (`lib/passwordReset.ts`) owns token hashing, the atomic claim (cooldown plus app-wide cap) and the atomic consume. Two public POST routes sit on it, then two pages and two small client forms. The email reuses the Resend sender from `lib/email.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Postgres via `pg` (PGlite locally), Resend over `fetch`, Node's test runner via tsx.

**Spec:** `docs/superpowers/specs/2026-10-16-password-reset-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing any Next.js code** (`AGENTS.md`). `after` is documented at `01-app/03-api-reference/04-functions/after.md`; page `metadata.referrer` at `.../generate-metadata.md`.
- **`npm run verify` is the gate** (lint, `tsc --noEmit`, `next build`, tests, in that order, because `lib/veloLeak.test.ts` reads `.next/static`). Before running it, delete `.next/static` and `.next/server` so a stale build cannot pass. Chain commands with `&&`, never `;`.
- **Mutation-test every new assertion.** Break the source, confirm the named test fails, restore from git or a backup copy, confirm green. Never restore with `git checkout <file>` on a file with uncommitted work: it discards that work.
- **The upgrade path is the path that matters.** The production database has athletes in it. The v29 migration must be proven by applying it to a database that already holds athletes and a pending invite, not only to a fresh one.
- **Never modify `canSeeAthlete` in `lib/scope.ts`, and do not touch the sign-in logic in `lib/auth.ts`.**
- **The raw reset token exists only in memory and in the emailed URL.** It is never stored, never logged, never in any response, never in an athlete payload.
- **The request route answers every case identically** (known, unknown, blank, malformed, archived, cooled down, capped, not configured): same status, same body, same headers.
- **The recipient is always the athlete's stored `invite_email`**, never a request field.
- **Constants (verbatim from the spec):** link life 60 minutes; cooldown 10 minutes per athlete; cap 30 reset emails per rolling 24 hours; minimum password length 6; send-log rows older than 2 days are pruned.
- **Confirmation text, verbatim:** `If that email is on a Velo Ladder account, we've sent a reset link. It works for 1 hour.`
- **No em dashes in any user-facing copy.** Email and page text must read like a coach talking to a teenager's household.
- **Test traps already hit in this repo:** (1) a failing `assert.equal(domElement, null)` diffs all of jsdom and takes about 27 seconds, so assert booleans (`=== null`) on DOM queries; (2) `after()` from `next/server` throws outside a real request, so route tests must `mock.module("next/server", ...)`; (3) test files that set `process.env` and then need `@/lib/db` must import it dynamically inside `before()`, because static imports hoist above the assignments; (4) PGlite is single-writer, so a dev server holding `./.pglite-data` hangs a second connection, and tests always use a `mkdtemp` directory; (5) zsh: quote globs, and do not `echo =====`.
- **Commits end with:** `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `lib/schema.ts` (modify) | v29 block: three columns, unique index, `password_reset_sends`; `SCHEMA_VERSION` 28 to 29. |
| `db/schema.sql` (regenerate) | Checked-in generated copy. `npx tsx scripts/schema-sql.ts`. |
| `lib/passwordReset.ts` (create) | Token generation and hashing, `requestReset`, `getResetTarget`, `consumeReset`, the three constants. No HTTP. |
| `lib/origin.ts` (create) | `appOrigin(request)`, moved out of the invite route so both routes build links the same way. |
| `lib/email.ts` (modify) | Extract `deliver()`, add `resetEmailContent()` and `sendResetEmail()`. |
| `app/api/password-reset/request/route.ts` (create) | Public POST, one answer for everything, work deferred with `after()`. |
| `app/api/password-reset/confirm/route.ts` (create) | Public POST, spends the token, sets the password. |
| `app/forgot-password/page.tsx` (create) | Server page; passes `emailConfigured()` to the form. |
| `components/ForgotPasswordForm.tsx` (create) | Email box, the fixed confirmation, the unavailable notice. |
| `app/reset-password/[token]/page.tsx` (create) | Server page; verifies the token, renders the form or the invalid-link card. |
| `components/ResetPasswordForm.tsx` (create) | New password twice, then signs in. |
| `components/LoginForm.tsx` (modify) | "Forgot password?" link. |
| `app/globals.css` (modify) | `.login-help` link style. |
| `lib/athleteWire.test.ts` (modify) | Seed a live reset claim; assert its hash and token reach no GET response. |
| `HANDOFF.md` (modify) | Document the flow, routes and the v29 setup step. |

---

### Task 1: Schema v29

**Files:**
- Modify: `lib/schema.ts` (`SCHEMA_VERSION` line 11; new block between `velo_range_sources` and `${VELO_SEED_SQL}`)
- Regenerate: `db/schema.sql`
- Test: `lib/schema.test.ts` (append)

**Interfaces:**
- Produces: columns `athletes.reset_token_hash text`, `athletes.reset_expires timestamptz`, `athletes.reset_requested_at timestamptz`; unique partial index `athletes_reset_token_hash_idx`; table `password_reset_sends(id bigserial PK, sent_at timestamptz NOT NULL DEFAULT now())` with index on `sent_at`. `SCHEMA_VERSION = 29`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/schema.test.ts`:

```ts
/*
 * v29 added self-service password reset. The only proof that matters is the
 * upgrade: a database that is already at v28, holding an athlete with a
 * pending invite and a password, has to come through untouched and gain the new
 * columns. A fresh database proves nothing about that.
 */
test("v29 upgrades a v28 database, keeps its athletes and invites, and a second run changes nothing", async () => {
  const marker = SCHEMA_SQL.indexOf("-- v29:");
  assert.ok(marker > -1, "could not find the v29 block");
  const v28 = SCHEMA_SQL.slice(0, marker);

  const db = await freshDb();
  await applyAsProduction(db, v28);
  const before = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'athletes' AND column_name LIKE 'reset_%'",
  );
  assert.equal(before.rows.length, 0, "the stand-in v28 database must not already have the columns");

  await db.query(`
    INSERT INTO athletes (id, name, invite_email, password_hash, invite_token, invite_expires)
    VALUES ('a1', 'Reset Athlete', 'kid@x.test', 'hash-xyz', 'tok-pending', now() + interval '3 days')
  `);

  await applyAsProduction(db, SCHEMA_SQL);
  await applyAsProduction(db, SCHEMA_SQL);

  const r = await db.query(
    "SELECT invite_token, password_hash, reset_token_hash, reset_expires, reset_requested_at FROM athletes WHERE id = 'a1'",
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].invite_token, "tok-pending", "the pending invite survived");
  assert.equal(r.rows[0].password_hash, "hash-xyz", "the password survived");
  assert.equal(r.rows[0].reset_token_hash, null);
  assert.equal(r.rows[0].reset_expires, null);
  assert.equal(r.rows[0].reset_requested_at, null);

  const log = await db.query("SELECT count(*)::int AS n FROM password_reset_sends");
  assert.equal(log.rows[0].n, 0);
});

test("two athletes cannot hold the same reset token hash, but any number can hold none", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await db.query("INSERT INTO athletes (id, name) VALUES ('a1', 'One'), ('a2', 'Two'), ('a3', 'Three')");
  // Several NULLs are fine: the index is partial.
  await db.query("UPDATE athletes SET reset_token_hash = NULL");
  await db.query("UPDATE athletes SET reset_token_hash = 'same-hash' WHERE id = 'a1'");
  await assert.rejects(
    db.query("UPDATE athletes SET reset_token_hash = 'same-hash' WHERE id = 'a2'"),
    /duplicate key|unique/i,
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/schema.test.ts 2>&1 | grep -E "^\s*(✔|✖|ℹ (pass|fail))"`
Expected: both new tests FAIL (`could not find the v29 block`; the second fails on the missing column).

- [ ] **Step 3: Implement**

In `lib/schema.ts`: change `export const SCHEMA_VERSION = 28;` to `29`. Then insert this block immediately before the line `${VELO_SEED_SQL}` inside `SCHEMA_SQL`. Do not use semicolons or backticks inside the SQL comments: the script is split on semicolons.

```sql
-- v29: self-service password reset.
--
-- The token is stored hashed (SHA-256), never raw, so a copy of the database
-- holds no working reset link. These are separate columns from the invite
-- token on purpose: a reset request is public and must not be able to cancel a
-- pending invite. reset_requested_at is the per-athlete cooldown, and it stays
-- set after a reset completes, which is what makes it a cooldown.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS reset_token_hash text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS reset_expires timestamptz;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS reset_requested_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS athletes_reset_token_hash_idx
  ON athletes(reset_token_hash) WHERE reset_token_hash IS NOT NULL;

-- One row per reset email issued, and nothing else: no athlete, no address.
-- It exists only so the app-wide daily cap can count emails. A column on
-- athletes cannot, because it keeps only each athlete's latest request.
CREATE TABLE IF NOT EXISTS password_reset_sends (
  id      bigserial PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_sends_sent_at_idx
  ON password_reset_sends(sent_at);
```

- [ ] **Step 4: Regenerate the checked-in copy and run the schema tests**

Run: `npx tsx scripts/schema-sql.ts && node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/schema.test.ts lib/schemaFile.test.ts lib/setupRoute.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"`
Expected: `fail 0`. (`setupRoute.test.ts` derives its table list from the SQL, so `password_reset_sends` is picked up with no edit. If it pins a list instead, add the table to that list and say so in the commit message.)

- [ ] **Step 5: Mutation check**

Delete the `CREATE UNIQUE INDEX ... athletes_reset_token_hash_idx` statement from `lib/schema.ts` in a scratch edit, run the schema tests, confirm "two athletes cannot hold the same reset token hash" fails, then restore the statement. Repeat once by deleting `ALTER TABLE athletes ADD COLUMN IF NOT EXISTS reset_expires timestamptz;` and confirming the upgrade test fails.

- [ ] **Step 6: Commit**

```bash
git add lib/schema.ts db/schema.sql lib/schema.test.ts
git commit -m "Schema v29: reset token columns and a send log for password reset

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The data layer

**Files:**
- Create: `lib/passwordReset.ts`
- Test: `lib/passwordReset.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/lib/db`; `hashPassword(pw: string): Promise<string>` from `@/lib/data`; the v29 schema.
- Produces:
  - `export const RESET_TTL_MINUTES = 60`, `RESET_COOLDOWN_MINUTES = 10`, `RESET_DAILY_CAP = 30`
  - `newResetToken(): string` (43 chars, base64url)
  - `hashResetToken(token: string): string` (64 hex chars)
  - `type ResetClaim = { to: string; name: string; token: string }`
  - `requestReset(email: string): Promise<ResetClaim | null>`
  - `getResetTarget(token: string): Promise<{ id: string; name: string } | null>`
  - `consumeReset(token: string, password: string): Promise<{ email: string | null } | null>`

- [ ] **Step 1: Write the failing tests**

Create `lib/passwordReset.test.ts`:

```ts
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";

/* ------------------------------------------------------------------ *
 * The reset data layer, run against a real (PGlite) database.
 *
 * What is pinned: the token is stored only as a hash; a claim is atomic and
 * respects the cooldown and the app-wide cap; a token works exactly once and
 * only before it expires; and requesting a reset never disturbs an invite.
 * ------------------------------------------------------------------ */

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-reset-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

let pr: typeof import("@/lib/passwordReset");
let data: typeof import("@/lib/data");
let sql: typeof import("@/lib/db").sql;
let n = 0;
/** A fresh athlete with its own email, so tests never share a cooldown. */
async function athlete(over: { email?: string; name?: string } = {}) {
  n += 1;
  const email = over.email ?? `kid${n}@reset.test`;
  const a = await data.createAthlete({ name: over.name ?? `Kid ${n}`, inviteEmail: email });
  return { id: a.id, email };
}
async function row(id: string) {
  const [r] = (await sql`SELECT * FROM athletes WHERE id = ${id}`) as Record<string, unknown>[];
  return r;
}

before(async () => {
  const db = await import("@/lib/db");
  sql = db.sql;
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await db.execScript(SCHEMA_SQL);
  data = await import("@/lib/data");
  pr = await import("@/lib/passwordReset");
});
beforeEach(async () => {
  await sql`DELETE FROM password_reset_sends`;
});

test("a token is 43 url-safe characters and two are never alike", () => {
  const a = pr.newResetToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, pr.newResetToken());
});

test("hashing is deterministic, 64 hex characters, and not the token", () => {
  const t = pr.newResetToken();
  assert.equal(pr.hashResetToken(t), pr.hashResetToken(t));
  assert.match(pr.hashResetToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(pr.hashResetToken(t), t);
});

test("a claim returns the raw token once and stores only its hash", async () => {
  const a = await athlete({ name: "Jake Bell" });
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);
  assert.equal(claim.to, a.email);
  assert.equal(claim.name, "Jake Bell");
  const r = await row(a.id);
  assert.equal(r.reset_token_hash, pr.hashResetToken(claim.token));
  assert.notEqual(r.reset_token_hash, claim.token, "the raw token must not be stored");
  const [life] = (await sql`
    SELECT extract(epoch FROM (reset_expires - now())) / 60 AS minutes FROM athletes WHERE id = ${a.id}
  `) as { minutes: string }[];
  assert.ok(Number(life.minutes) > 58 && Number(life.minutes) <= 60, `lives ~60 minutes, got ${life.minutes}`);
});

test("the email is matched however it was typed", async () => {
  const a = await athlete({ email: "mixed.case@reset.test" });
  const claim = await pr.requestReset("  MIXED.Case@Reset.TEST ");
  assert.ok(claim);
  assert.equal(claim.to, a.email, "goes to the stored address, not the typed one");
});

test("an unknown or blank email claims nothing and logs nothing", async () => {
  assert.equal(await pr.requestReset("nobody@reset.test"), null);
  assert.equal(await pr.requestReset("   "), null);
  const [c] = (await sql`SELECT count(*)::int AS n FROM password_reset_sends`) as { n: number }[];
  assert.equal(c.n, 0);
});

test("an archived athlete cannot be reset", async () => {
  const a = await athlete();
  await sql`UPDATE athletes SET archived = true WHERE id = ${a.id}`;
  assert.equal(await pr.requestReset(a.email), null);
});

test("a second request inside the cooldown claims nothing and leaves the first link working", async () => {
  const a = await athlete();
  const first = await pr.requestReset(a.email);
  assert.ok(first);
  assert.equal(await pr.requestReset(a.email), null, "inside 10 minutes");
  assert.ok(await pr.getResetTarget(first.token), "the first link is untouched");
});

test("after the cooldown a new request issues a new link and retires the old one", async () => {
  const a = await athlete();
  const first = await pr.requestReset(a.email);
  assert.ok(first);
  await sql`UPDATE athletes SET reset_requested_at = now() - interval '11 minutes' WHERE id = ${a.id}`;
  const second = await pr.requestReset(a.email);
  assert.ok(second);
  assert.notEqual(second.token, first.token);
  assert.equal(await pr.getResetTarget(first.token), null, "the old link no longer works");
  assert.ok(await pr.getResetTarget(second.token));
});

test("each claim writes one send-log row, and old rows are pruned", async () => {
  await sql`INSERT INTO password_reset_sends (sent_at) VALUES (now() - interval '3 days')`;
  const a = await athlete();
  assert.ok(await pr.requestReset(a.email));
  const [c] = (await sql`SELECT count(*)::int AS n FROM password_reset_sends`) as { n: number }[];
  assert.equal(c.n, 1, "the three-day-old row was pruned and one new row written");
});

test("the app-wide cap stops claims, and a window with room lets them through", async () => {
  const a = await athlete();
  for (let i = 0; i < pr.RESET_DAILY_CAP; i++) await sql`INSERT INTO password_reset_sends DEFAULT VALUES`;
  assert.equal(await pr.requestReset(a.email), null, "30 in the last day is the cap");
  assert.equal((await row(a.id)).reset_requested_at, null, "a capped request must not burn the cooldown");

  await sql`UPDATE password_reset_sends SET sent_at = now() - interval '25 hours'`;
  assert.ok(await pr.requestReset(a.email), "the same 30 rows, a day old, no longer count");
});

test("requesting a reset never touches a pending invite", async () => {
  const a = await athlete();
  const invite = await data.createInvite(a.id);
  assert.ok(invite);
  await pr.requestReset(a.email);
  assert.equal((await row(a.id)).invite_token, invite);
});

test("if two rows share an email, the earlier athlete is the one reset", async () => {
  const shared = "shared@reset.test";
  const first = await athlete({ email: shared, name: "First" });
  const second = await athlete({ email: shared, name: "Second" });
  const claim = await pr.requestReset(shared);
  assert.ok(claim);
  assert.equal(claim.name, "First");
  assert.ok((await row(first.id)).reset_token_hash);
  assert.equal((await row(second.id)).reset_token_hash, null);
});

test("getResetTarget accepts a live token and refuses everything else", async () => {
  const a = await athlete({ name: "Pat Live" });
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);
  assert.deepEqual(await pr.getResetTarget(claim.token), { id: a.id, name: "Pat Live" });
  assert.equal(await pr.getResetTarget(""), null);
  assert.equal(await pr.getResetTarget("not-a-token"), null);
  assert.equal(
    await pr.getResetTarget(pr.hashResetToken(claim.token)),
    null,
    "the stored hash is not itself a token",
  );
});

test("getResetTarget refuses an expired link and an archived athlete", async () => {
  const a = await athlete();
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);
  await sql`UPDATE athletes SET reset_expires = now() - interval '1 minute' WHERE id = ${a.id}`;
  assert.equal(await pr.getResetTarget(claim.token), null, "expired");

  const b = await athlete();
  const claimB = await pr.requestReset(b.email);
  assert.ok(claimB);
  await sql`UPDATE athletes SET archived = true WHERE id = ${b.id}`;
  assert.equal(await pr.getResetTarget(claimB.token), null, "archived");
});

test("consuming sets the password, clears the reset and any invite, and works once", async () => {
  const a = await athlete();
  await data.createInvite(a.id);
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);

  const done = await pr.consumeReset(claim.token, "brand-new-pw");
  assert.deepEqual(done, { email: a.email });

  const r = await row(a.id);
  assert.ok(await bcrypt.compare("brand-new-pw", String(r.password_hash)));
  assert.equal(r.reset_token_hash, null);
  assert.equal(r.reset_expires, null);
  assert.equal(r.invite_token, null, "an unused invite is cancelled");
  assert.ok(r.reset_requested_at, "the cooldown stays in force");

  assert.equal(await pr.consumeReset(claim.token, "second-try-pw"), null, "single use");
  assert.ok(await bcrypt.compare("brand-new-pw", String((await row(a.id)).password_hash)));
});

test("an expired or unknown token changes nothing", async () => {
  const a = await athlete();
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);
  await sql`UPDATE athletes SET reset_expires = now() - interval '1 minute' WHERE id = ${a.id}`;
  assert.equal(await pr.consumeReset(claim.token, "should-not-land"), null);
  assert.equal(await pr.consumeReset("nonsense", "should-not-land"), null);
  assert.equal((await row(a.id)).password_hash, null);
});

test("two simultaneous consumes: exactly one wins", async () => {
  const a = await athlete();
  const claim = await pr.requestReset(a.email);
  assert.ok(claim);
  const results = await Promise.all([
    pr.consumeReset(claim.token, "winner-one-pw"),
    pr.consumeReset(claim.token, "winner-two-pw"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/passwordReset.test.ts 2>&1 | grep -E "^\s*(✔|✖|ℹ (pass|fail))|Cannot find"`
Expected: FAIL, `Cannot find module '@/lib/passwordReset'`.

- [ ] **Step 3: Implement**

Create `lib/passwordReset.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/passwordReset.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"`
Expected: `pass 16`, `fail 0`.

- [ ] **Step 5: Mutation check**

Using a backup copy (`cp lib/passwordReset.ts /tmp/pr.bak`), apply each mutation, run `lib/passwordReset.test.ts`, confirm the NAMED test fails, then `cp /tmp/pr.bak lib/passwordReset.ts`:

| Mutation | Test that must fail |
|---|---|
| store the raw token: `reset_token_hash = ${token}` | "a claim returns the raw token once and stores only its hash" |
| drop `AND (reset_requested_at IS NULL OR ...)` | "a second request inside the cooldown ..." |
| change `n >= RESET_DAILY_CAP` to `n > RESET_DAILY_CAP` | "the app-wide cap stops claims ..." |
| delete `invite_token = NULL,` from `consumeReset` | "consuming sets the password, clears ..." |
| delete `reset_token_hash = NULL,` from `consumeReset` | "consuming ..." and "two simultaneous consumes" |
| delete `AND reset_expires > now()` from `getResetTarget` | "getResetTarget refuses an expired link ..." |
| delete `AND archived = false` from the claim subselect | "an archived athlete cannot be reset" |
| change `ORDER BY created_at, id` to `ORDER BY id DESC` | "if two rows share an email ..." |
| delete the `DELETE FROM password_reset_sends WHERE sent_at < ...` line | "each claim writes one send-log row, and old rows are pruned" |

- [ ] **Step 6: Commit**

```bash
git add lib/passwordReset.ts lib/passwordReset.test.ts
git commit -m "Password reset data layer: hashed tokens, atomic claim and consume

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The reset email

**Files:**
- Create: `lib/origin.ts`, `lib/origin.test.ts`
- Modify: `lib/email.ts`, `app/api/athletes/[id]/invite/route.ts` (use `appOrigin`)
- Test: `lib/email.test.ts` (append)

**Interfaces:**
- Consumes: `EmailResult`, `emailConfigured`, the existing private `creds()`, `isEmailAddress`, `esc`, `replyTo`, `SIGNATURE` in `lib/email.ts`.
- Produces: `appOrigin(request: Request): string`; `resetEmailContent(name: string, url: string): { subject: string; text: string; html: string }`; `sendResetEmail(to: string, name: string, url: string): Promise<EmailResult>`. `sendInviteEmail` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Create `lib/origin.test.ts`:

```ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appOrigin } from "@/lib/origin";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.AUTH_URL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = saved;
});

test("AUTH_URL wins, with any trailing slash removed", () => {
  process.env.AUTH_URL = "https://velo.test/";
  assert.equal(appOrigin(new Request("http://other.host/x")), "https://velo.test");
});

test("without AUTH_URL the request's own origin is used", () => {
  delete process.env.AUTH_URL;
  assert.equal(appOrigin(new Request("http://localhost:3000/api/x")), "http://localhost:3000");
});
```

Append to `lib/email.test.ts` (the file already stubs `fetch` and env in `beforeEach`; add `resetEmailContent` and `sendResetEmail` to its import from `@/lib/email`):

```ts
test("the reset email names the coach, says it expires in an hour, and is safe to ignore", () => {
  const url = "https://velo.test/reset-password/tok";
  const r = resetEmailContent("Jake Bell", url);
  assert.equal(r.subject, "Reset your Velo Ladder password");
  for (const part of [r.text, r.html]) {
    assert.ok(part.includes("Jake"), "first name");
    assert.ok(part.includes("1 hour"), "expiry");
    assert.match(part, /ignore this email/i);
    assert.match(part, /password hasn.{1,8}t changed/i);
    assert.match(part, /FAST Performance/);
  }
  assert.ok(!r.text.includes("Bell"), "first name only");
  assert.equal(r.text.split(url).length - 1, 1, "link once in the text");
  assert.equal(r.html.split(url).length - 1, 2, "one anchor in the html");
  assert.ok(r.text.endsWith("Coach Cole\nFAST Performance, Denver"));
  assert.ok(!/[—–]/.test(r.text + r.html), "no em or en dashes");
});

test("a name cannot inject markup into the reset email", () => {
  const r = resetEmailContent('<script>alert(1)</script>', "https://x.test/r?a=1&b=2");
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes("a=1&amp;b=2"));
});

test("sendResetEmail posts the reset to Resend at the address it was given", async () => {
  const r = await sendResetEmail("kid@school.org", "Jake Bell", "https://velo.test/reset-password/t0k");
  assert.deepEqual(r, { sent: true, to: "kid@school.org" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].body.subject, "Reset your Velo Ladder password");
  assert.deepEqual(calls[0].body.to, ["kid@school.org"]);
  assert.equal(calls[0].body.reply_to, "cole@fastcolorado.com");
  assert.ok(String(calls[0].body.text).includes("https://velo.test/reset-password/t0k"));
});

test("sendResetEmail is a value when not configured, refuses a bad address, and reports Resend's reason", async () => {
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendResetEmail("kid@school.org", "J", "https://x.test/r"), {
    sent: false,
    reason: "not_configured",
  });
  process.env.RESEND_API_KEY = "re_secret_key";
  assert.deepEqual(await sendResetEmail("nope", "J", "https://x.test/r"), {
    sent: false,
    reason: "bad_address",
  });
  respond = () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
  const r = await sendResetEmail("kid@school.org", "J", "https://x.test/r");
  assert.ok(!r.sent && r.reason === "send_failed");
  assert.match(!r.sent ? (r.detail ?? "") : "", /domain is not verified/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/origin.test.ts lib/email.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find|not a function"`
Expected: FAIL (`Cannot find module '@/lib/origin'`; `resetEmailContent` is not exported).

- [ ] **Step 3: Implement**

Create `lib/origin.ts`:

```ts
/** Base URL for links we hand out. AUTH_URL is authoritative in production. */
export function appOrigin(request: Request): string {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
```

In `app/api/athletes/[id]/invite/route.ts`: delete the local `origin` function and its comment, add `import { appOrigin } from "@/lib/origin";`, and replace `origin(request)` with `appOrigin(request)`.

In `lib/email.ts`, replace the whole `sendInviteEmail` function with these three (the old body becomes `deliver`, using the same `creds()`, `isEmailAddress`, `replyTo()` and error handling it has today) and add `resetEmailContent` after `inviteEmailContent`:

```ts
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

export function sendResetEmail(to: string, name: string, url: string): Promise<EmailResult> {
  return deliver(to, resetEmailContent(name, url));
}
```

```ts
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
```

Also update the header comment of `lib/email.ts` from "Emailing invite links." to "Emailing invite and password-reset links." and keep the rest.

- [ ] **Step 4: Run to verify they pass, along with everything the refactor touches**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/origin.test.ts lib/email.test.ts lib/inviteEmailRoute.test.ts lib/inviteSmsRoute.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"`
Expected: `fail 0` (the pre-existing invite email and route tests prove the `deliver` refactor changed nothing).

- [ ] **Step 5: Mutation check**

Backup `lib/email.ts` first. (a) In `resetEmailContent`, change `1 hour` to `14 days` in the text part: the reset-content test must fail. (b) In `sendResetEmail`, call `inviteEmailContent` instead: the subject assertion must fail. (c) In `deliver`, delete the `isEmailAddress` line: the bad-address assertion and the existing invite test must fail. Restore from the backup after each.

- [ ] **Step 6: Commit**

```bash
git add lib/origin.ts lib/origin.test.ts lib/email.ts lib/email.test.ts "app/api/athletes/[id]/invite/route.ts"
git commit -m "Reset email, and share the link origin between routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The request route

**Files:**
- Create: `app/api/password-reset/request/route.ts`
- Test: `lib/passwordResetRoute.test.ts`

**Interfaces:**
- Consumes: `requestReset`, `hashResetToken` from `@/lib/passwordReset`; `sendResetEmail`, `emailConfigured` from `@/lib/email`; `appOrigin` from `@/lib/origin`; `after` from `next/server`.
- Produces: `POST /api/password-reset/request` with body `{ email }`, always `200 {"ok":true}` with `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests**

Create `lib/passwordResetRoute.test.ts`:

```ts
import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * POST /api/password-reset/request, run for real against the handler and a
 * real (PGlite) database, with only Resend stubbed.
 *
 * Pinned: every kind of request gets the identical answer (so the form cannot
 * be used to learn who is on the roster), the work happens AFTER the response,
 * the email goes only to the stored address, and no log line carries a token.
 * ------------------------------------------------------------------ */

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-reset-route-"));
process.env.PGLITE_DIR = DB_DIR;
process.env.AUTH_URL = "https://velo.test";
process.env.COACH_EMAILS = "coach@reset.test";
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

/*
 * after() throws outside a real request, so stand in for it: collect what the
 * route defers and run it on demand. That also lets a test prove the response
 * came back BEFORE the work was done.
 */
let deferred: Array<() => unknown> = [];
mock.module("next/server", {
  exports: {
    after: (fn: () => unknown) => {
      deferred.push(fn);
    },
  },
} as Parameters<typeof mock.module>[1]);
async function flush() {
  const run = deferred;
  deferred = [];
  for (const fn of run) await fn();
}

type Sent = { to: string[]; subject: string; text: string; html: string };
let sent: Sent[] = [];
let resendOk = true;
const realFetch = globalThis.fetch;

let route: typeof import("../app/api/password-reset/request/route");
let pr: typeof import("@/lib/passwordReset");
let sql: typeof import("@/lib/db").sql;
let kid = { id: "", email: "kid@reset.test" };
let archivedEmail = "gone@reset.test";

before(async () => {
  const db = await import("@/lib/db");
  sql = db.sql;
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await db.execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  kid.id = (await data.createAthlete({ name: "Jake Bell", inviteEmail: kid.email })).id;
  const gone = await data.createAthlete({ name: "Gone Guy", inviteEmail: archivedEmail });
  await sql`UPDATE athletes SET archived = true WHERE id = ${gone.id}`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("api.resend.com")) return realFetch(input, init);
    if (!resendOk)
      return new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  }) as typeof fetch;

  pr = await import("@/lib/passwordReset");
  route = await import("../app/api/password-reset/request/route");
});

beforeEach(async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  sent = [];
  deferred = [];
  resendOk = true;
  await sql`DELETE FROM password_reset_sends`;
  await sql`UPDATE athletes SET reset_token_hash = NULL, reset_expires = NULL, reset_requested_at = NULL`;
});

const post = (body: unknown) =>
  route.POST(
    new Request("https://velo.test/api/password-reset/request", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), cache: res.headers.get("cache-control") };
}

test("every kind of request gets the identical answer", async () => {
  const cases: unknown[] = [
    { email: kid.email },
    { email: "nobody@reset.test" },
    { email: archivedEmail },
    { email: "coach@reset.test" },
    { email: "" },
    { email: 42 },
    {},
    "this is not json",
  ];
  const answers = [];
  for (const c of cases) answers.push(await snapshot(await post(c)));
  for (const a of answers) assert.deepEqual(a, answers[0]);
  assert.equal(answers[0].status, 200);
  assert.equal(answers[0].body, '{"ok":true}');
  assert.equal(answers[0].cache, "no-store");
});

test("the work is deferred: nothing is sent until after the response", async () => {
  await post({ email: kid.email });
  assert.equal(sent.length, 0, "the response must not wait for the email");
  await flush();
  assert.equal(sent.length, 1);
});

test("the email goes to the stored address and carries a link whose token matches the stored hash", async () => {
  await post({ email: "  KID@Reset.TEST " });
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [kid.email]);
  assert.equal(sent[0].subject, "Reset your Velo Ladder password");
  const m = sent[0].text.match(/https:\/\/velo\.test\/reset-password\/([A-Za-z0-9_-]{43})/);
  assert.ok(m, "the email carries a reset link");
  const [r] = (await sql`SELECT reset_token_hash FROM athletes WHERE id = ${kid.id}`) as { reset_token_hash: string }[];
  assert.equal(r.reset_token_hash, pr.hashResetToken(m[1]));
});

test("an unknown, archived or coach address sends nothing and writes nothing", async () => {
  for (const email of ["nobody@reset.test", archivedEmail, "coach@reset.test", ""]) {
    await post({ email });
  }
  await flush();
  assert.equal(sent.length, 0);
  const [c] = (await sql`SELECT count(*)::int AS n FROM password_reset_sends`) as { n: number }[];
  assert.equal(c.n, 0);
});

test("a second request inside the cooldown sends nothing more, and the first link still works", async () => {
  await post({ email: kid.email });
  await flush();
  await post({ email: kid.email });
  await flush();
  assert.equal(sent.length, 1);
  const token = sent[0].text.match(/reset-password\/([A-Za-z0-9_-]{43})/)![1];
  assert.ok(await pr.getResetTarget(token));
});

test("when the daily cap is reached nothing is sent and the answer is unchanged", async () => {
  for (let i = 0; i < pr.RESET_DAILY_CAP; i++) await sql`INSERT INTO password_reset_sends DEFAULT VALUES`;
  const a = await snapshot(await post({ email: kid.email }));
  await flush();
  assert.equal(sent.length, 0);
  assert.equal(a.body, '{"ok":true}');
});

test("when email is not configured nothing is claimed, so no cooldown is burned", async () => {
  delete process.env.RESEND_API_KEY;
  await post({ email: kid.email });
  await flush();
  assert.equal(sent.length, 0);
  const [r] = (await sql`SELECT reset_requested_at FROM athletes WHERE id = ${kid.id}`) as { reset_requested_at: unknown }[];
  assert.equal(r.reset_requested_at, null);
});

test("a failed send never throws out of the deferred work and never logs the token", async () => {
  resendOk = false;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await post({ email: kid.email });
    await flush(); // must resolve, not reject
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((l) => /domain is not verified/.test(l)), "the reason is logged");
  const [r] = (await sql`SELECT reset_token_hash FROM athletes WHERE id = ${kid.id}`) as { reset_token_hash: string }[];
  assert.ok(r.reset_token_hash);
  assert.ok(
    logged.every((l) => !/[A-Za-z0-9_-]{43}/.test(l) && !l.includes(r.reset_token_hash)),
    "no log line may contain a token or its hash",
  );
});

test("requesting a reset leaves a pending invite alone", async () => {
  const data = await import("@/lib/data");
  const invite = await data.createInvite(kid.id);
  await post({ email: kid.email });
  await flush();
  const [r] = (await sql`SELECT invite_token FROM athletes WHERE id = ${kid.id}`) as { invite_token: string }[];
  assert.equal(r.invite_token, invite);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/passwordResetRoute.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find" | head -5`
Expected: FAIL, `Cannot find module ... app/api/password-reset/request/route`.

- [ ] **Step 3: Implement**

Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` first, then create `app/api/password-reset/request/route.ts`:

```ts
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

  // Not configured means no claim at all, so no cooldown is burned for an
  // email that was never going to be sent.
  if (email.trim() && emailConfigured()) {
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/passwordResetRoute.test.ts 2>&1 | grep -E "^\s*(✔|✖|ℹ (pass|fail))"`
Expected: `pass 8`, `fail 0`.

- [ ] **Step 5: Mutation check**

Backup the route. (a) Replace the early `return ANSWER()` for non-matching cases by returning `Response.json({ ok: false })` when `!email.trim()`: "identical answer" must fail. (b) Replace `after(async () => {...})` by an immediately-awaited call (make the handler `await` the body instead of deferring): "the work is deferred" must fail. (c) Change `claim.to` to `email` in the `sendResetEmail` call: the stored-address test must fail. (d) Change the `console.error` arguments to include `claim`-derived text, for example `String(origin) + token`: the log test must fail. (e) Remove `&& emailConfigured()`: "not configured" test must fail. Restore after each.

- [ ] **Step 6: Commit**

```bash
git add app/api/password-reset/request/route.ts lib/passwordResetRoute.test.ts
git commit -m "Password reset request route: one answer for everyone, work after the response

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The confirm route

**Files:**
- Create: `app/api/password-reset/confirm/route.ts`
- Test: `lib/passwordResetConfirmRoute.test.ts`

**Interfaces:**
- Consumes: `consumeReset`, `requestReset` from `@/lib/passwordReset`; `json`-style helpers from `@/lib/http`.
- Produces: `POST /api/password-reset/confirm` with `{ token, password }`. `200 { email }` on success, `400` for a password under 6 characters (token NOT spent), `404 "This reset link has expired or was already used"` otherwise. `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests**

Create `lib/passwordResetConfirmRoute.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-reset-confirm-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

let route: typeof import("../app/api/password-reset/confirm/route");
let pr: typeof import("@/lib/passwordReset");
let data: typeof import("@/lib/data");
let sql: typeof import("@/lib/db").sql;
let n = 0;

before(async () => {
  const db = await import("@/lib/db");
  sql = db.sql;
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await db.execScript(SCHEMA_SQL);
  data = await import("@/lib/data");
  pr = await import("@/lib/passwordReset");
  route = await import("../app/api/password-reset/confirm/route");
});

async function claimed() {
  n += 1;
  const email = `kid${n}@confirm.test`;
  const a = await data.createAthlete({ name: `Kid ${n}`, inviteEmail: email });
  const claim = await pr.requestReset(email);
  assert.ok(claim);
  return { id: a.id, email, token: claim.token };
}
const post = (body: unknown) =>
  route.POST(
    new Request("https://velo.test/api/password-reset/confirm", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const hashOf = async (id: string) =>
  ((await sql`SELECT password_hash FROM athletes WHERE id = ${id}`) as { password_hash: string | null }[])[0].password_hash;

test("a valid link sets the password and returns the login email", async () => {
  const c = await claimed();
  const res = await post({ token: c.token, password: "a-fresh-password" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { email: c.email });
  assert.ok(await bcrypt.compare("a-fresh-password", String(await hashOf(c.id))));
});

test("the link works once", async () => {
  const c = await claimed();
  assert.equal((await post({ token: c.token, password: "first-choice-pw" })).status, 200);
  const again = await post({ token: c.token, password: "second-choice-pw" });
  assert.equal(again.status, 404);
  assert.match((await again.json()).error, /expired or was already used/);
  assert.ok(await bcrypt.compare("first-choice-pw", String(await hashOf(c.id))));
});

test("a short password is refused and does not spend the link", async () => {
  const c = await claimed();
  const res = await post({ token: c.token, password: "short" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at least 6/);
  assert.equal(await hashOf(c.id), null, "nothing was written");
  assert.equal((await post({ token: c.token, password: "long-enough-pw" })).status, 200, "the link is still good");
});

test("an unknown, empty, expired or non-string token is a 404 and changes nothing", async () => {
  const c = await claimed();
  await sql`UPDATE athletes SET reset_expires = now() - interval '1 minute' WHERE id = ${c.id}`;
  for (const token of ["nonsense", "", 42, null, c.token /* expired */]) {
    const res = await post({ token, password: "does-not-matter-pw" });
    assert.equal(res.status, 404, JSON.stringify(token));
  }
  assert.equal(await hashOf(c.id), null);
});

test("malformed bodies are refused without a crash", async () => {
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({})).status, 400);
});

test("nothing in a response contains the token or its hash", async () => {
  const c = await claimed();
  const ok = await (await post({ token: c.token, password: "yet-another-pw" })).text();
  const bad = await (await post({ token: c.token, password: "yet-another-pw" })).text();
  for (const body of [ok, bad]) {
    assert.ok(!body.includes(c.token));
    assert.ok(!body.includes(pr.hashResetToken(c.token)));
  }
});

test("completing a reset cancels an unused invite", async () => {
  const c = await claimed();
  await data.createInvite(c.id);
  await post({ token: c.token, password: "invite-be-gone-pw" });
  const [r] = (await sql`SELECT invite_token FROM athletes WHERE id = ${c.id}`) as { invite_token: string | null }[];
  assert.equal(r.invite_token, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: `Cannot find module ... app/api/password-reset/confirm/route`.

- [ ] **Step 3: Implement**

Create `app/api/password-reset/confirm/route.ts`:

```ts
import { consumeReset } from "@/lib/passwordReset";
import { badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public: the token is the credential. A password that is too short is refused
 * BEFORE the token is touched, so a typo does not burn the link.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    password?: unknown;
  } | null;
  if (!body || typeof body !== "object") return badRequest("Send a token and a password");

  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token && !("password" in body)) return badRequest("Send a token and a password");

  if (password.length < 6) return badRequest("Password must be at least 6 characters");

  const done = await consumeReset(token, password);
  if (!done) {
    return Response.json(
      { error: "This reset link has expired or was already used" },
      { status: 404, headers: NO_STORE },
    );
  }
  return Response.json({ email: done.email }, { headers: NO_STORE });
}
```

Check the tests against this: `{}` has no `token` and no `password` key, so it returns 400; `{ token: 42, password: "does-not-matter-pw" }` falls through to `consumeReset("")`, which returns null, so 404. `"not json"` parses to `null`, so 400.

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/passwordResetConfirmRoute.test.ts 2>&1 | grep -E "^\s*(✔|✖|ℹ (pass|fail))"`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Mutation check**

Backup the route. (a) Move the `password.length < 6` check after `consumeReset`: "a short password ... does not spend the link" must fail. (b) Return the `token` in the success JSON: "nothing in a response contains the token" must fail. (c) Drop the `NO_STORE` header from the success response: "a valid link sets the password" must fail. Restore after each.

- [ ] **Step 6: Commit**

```bash
git add app/api/password-reset/confirm/route.ts lib/passwordResetConfirmRoute.test.ts
git commit -m "Password reset confirm route: spend the link, set the password

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pages and forms

**Files:**
- Create: `components/ForgotPasswordForm.tsx`, `components/ForgotPasswordForm.test.tsx`, `components/ResetPasswordForm.tsx`, `components/ResetPasswordForm.test.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/[token]/page.tsx`, `lib/resetPage.test.ts`
- Modify: `components/LoginForm.tsx`, `app/globals.css`
- Test: `components/LoginForm.test.tsx` (create)

**Interfaces:**
- Consumes: `api`, `ApiError` from `@/lib/fetcher`; `signIn` from `next-auth/react`; `emailConfigured` from `@/lib/email`; `getResetTarget` from `@/lib/passwordReset`.
- Produces: `ForgotPasswordForm({ available: boolean })`; `ResetPasswordForm({ token: string, redirect?: (to: string) => void })`; the `/forgot-password` and `/reset-password/[token]` pages; a "Forgot password?" link to `/forgot-password` on the login form.

- [ ] **Step 1: Write the failing tests**

Create `components/ForgotPasswordForm.test.tsx`:

```tsx
import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ForgotPasswordForm from "./ForgotPasswordForm";

const CONFIRM = "If that email is on a Velo Ladder account, we've sent a reset link. It works for 1 hour.";
const real = globalThis.fetch;
let posted: { url: string; body: Record<string, unknown> }[] = [];
let respond: () => Response | Promise<Response>;

beforeEach(() => {
  cleanup();
  posted = [];
  respond = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return respond();
    }
    return real(input as string, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

const submit = (email = "jake@school.org") => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
};

test("the send button waits for an email", () => {
  render(<ForgotPasswordForm available />);
  const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
  assert.equal(btn.disabled, true);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
  assert.equal(btn.disabled, false);
});

test("submitting posts the trimmed email and shows the fixed confirmation", async () => {
  render(<ForgotPasswordForm available />);
  submit("  jake@school.org ");
  await waitFor(() => screen.getByText(CONFIRM));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "/api/password-reset/request");
  assert.deepEqual(posted[0].body, { email: "jake@school.org" });
  assert.ok(screen.getByRole("link", { name: /back to sign in/i }));
});

test("the confirmation is the same whatever the email was", async () => {
  render(<ForgotPasswordForm available />);
  submit("nobody-at-all@nowhere.test");
  await waitFor(() => screen.getByText(CONFIRM));
});

test("a failed request says so instead of pretending it worked", async () => {
  respond = () => {
    throw new Error("network down");
  };
  render(<ForgotPasswordForm available />);
  submit();
  await waitFor(() => screen.getByRole("alert"));
  assert.match(screen.getByRole("alert").textContent!, /try again/i);
  assert.ok(screen.queryByText(CONFIRM) === null, "must not claim a link was sent");
});

test("when email is not set up the page says so and offers no form", () => {
  render(<ForgotPasswordForm available={false} />);
  assert.ok(screen.getByText(/ask your coach for a new invite/i));
  assert.ok(screen.queryByRole("button", { name: /send reset link/i }) === null);
  assert.ok(screen.getByRole("link", { name: /back to sign in/i }));
});
```

Create `components/ResetPasswordForm.test.tsx`:

```tsx
import "./testDom";
import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const signInCalls: unknown[][] = [];
let signInResult: { error: string | null } = { error: null };
mock.module("next-auth/react", {
  exports: {
    signIn: async (...args: unknown[]) => {
      signInCalls.push(args);
      return signInResult;
    },
  },
} as Parameters<typeof mock.module>[1]);

let ResetPasswordForm: typeof import("./ResetPasswordForm").default;
before(async () => {
  ResetPasswordForm = (await import("./ResetPasswordForm")).default;
});

const real = globalThis.fetch;
let posted: { url: string; body: Record<string, unknown> }[] = [];
let reply: { status: number; body: unknown };
const redirects: string[] = [];

beforeEach(() => {
  cleanup();
  posted = [];
  redirects.length = 0;
  signInCalls.length = 0;
  signInResult = { error: null };
  reply = { status: 200, body: { email: "jake@school.org" } };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
    }
    return real(input as string, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

const open = () => render(<ResetPasswordForm token="tok-123" redirect={(to) => redirects.push(to)} />);
const fill = (a: string, b: string) => {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: a } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: b } });
};
const button = () => screen.getByRole("button", { name: /set new password/i }) as HTMLButtonElement;

test("the button waits for six characters that match", () => {
  open();
  assert.equal(button().disabled, true);
  fill("short", "short");
  assert.equal(button().disabled, true, "five characters is too short");
  fill("longenough", "different1");
  assert.equal(button().disabled, true, "a mismatch is not enough");
  assert.ok(screen.getByText(/don.t match/i));
  fill("longenough", "longenough");
  assert.equal(button().disabled, false);
});

test("success posts the token and password, signs in with the returned email, and goes home", async () => {
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => assert.deepEqual(redirects, ["/"]));
  assert.equal(posted[0].url, "/api/password-reset/confirm");
  assert.deepEqual(posted[0].body, { token: "tok-123", password: "longenough" });
  assert.equal(signInCalls.length, 1);
  assert.equal(signInCalls[0][0], "credentials");
  assert.deepEqual(signInCalls[0][1], { email: "jake@school.org", password: "longenough", redirect: false });
});

test("an expired link shows the server's message and does not sign in or redirect", async () => {
  reply = { status: 404, body: { error: "This reset link has expired or was already used" } };
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => screen.getByRole("alert"));
  assert.match(screen.getByRole("alert").textContent!, /expired or was already used/);
  assert.equal(signInCalls.length, 0);
  assert.deepEqual(redirects, []);
});

test("if the password was set but sign-in fails, they are sent to the login page", async () => {
  signInResult = { error: "CredentialsSignin" };
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => assert.deepEqual(redirects, ["/login"]));
});
```

Create `components/LoginForm.test.tsx`:

```tsx
import "./testDom";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

mock.module("next-auth/react", { exports: { signIn: async () => ({ error: null }) } } as Parameters<typeof mock.module>[1]);
mock.module("next/navigation", {
  exports: { useRouter: () => ({ push() {}, refresh() {} }) },
} as Parameters<typeof mock.module>[1]);

let LoginForm: typeof import("./LoginForm").default;
before(async () => {
  LoginForm = (await import("./LoginForm")).default;
});
beforeEach(cleanup);

test("the login form links to the reset page", () => {
  render(<LoginForm />);
  const link = screen.getByRole("link", { name: /forgot password/i });
  assert.equal(link.getAttribute("href"), "/forgot-password");
});
```

Create `lib/resetPage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";

/* The reset URL carries a secret, so the page must not leak it through the
 * Referer header to anything it links to. */
test("the reset page asks browsers not to send a referrer", async () => {
  const mod = await import("../app/reset-password/[token]/page");
  assert.equal((mod.metadata as { referrer?: string }).referrer, "no-referrer");
  assert.equal(mod.dynamic, "force-dynamic", "never cached or prerendered");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/ForgotPasswordForm.test.tsx components/ResetPasswordForm.test.tsx components/LoginForm.test.tsx lib/resetPage.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find" | head`
Expected: FAIL (`Cannot find module './ForgotPasswordForm'` and the others).

- [ ] **Step 3: Implement the components and pages**

Create `components/ForgotPasswordForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/fetcher";

const CONFIRM =
  "If that email is on a Velo Ladder account, we've sent a reset link. It works for 1 hour.";

/**
 * Ask for a reset link by email. The confirmation is the same whatever was
 * typed: telling a stranger "no such account" would let them learn who is on
 * the roster, and many of these athletes are minors.
 */
export default function ForgotPasswordForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/password-reset/request", "POST", { email: email.trim() });
      setDone(true);
    } catch {
      setErr("Couldn't send that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      <h1>Reset your password</h1>
      {!available ? (
        <p>Password reset by email isn&rsquo;t available right now. Ask your coach for a new invite.</p>
      ) : done ? (
        <p>{CONFIRM}</p>
      ) : (
        <form onSubmit={submit}>
          <p>Enter the email you sign in with and we&rsquo;ll send you a link.</p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={!email.trim() || busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}
        </form>
      )}
      <p className="login-help">
        <a href="/login">Back to sign in</a>
      </p>
    </div>
  );
}
```

Create `components/ResetPasswordForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { api, ApiError } from "@/lib/fetcher";

const goTo = (to: string) => {
  window.location.href = to;
};

/**
 * Choose a new password from an emailed link. The server has already checked
 * the link before this renders; the confirm call checks it again, because the
 * link can be spent between the page loading and the button being pressed.
 *
 * `redirect` is injectable only so tests can observe where it would go.
 */
export default function ResetPasswordForm({
  token,
  redirect = goTo,
}: {
  token: string;
  redirect?: (to: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSubmit = pw.length >= 6 && pw === pw2 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ email: string | null }>(
        "/api/password-reset/confirm",
        "POST",
        { token, password: pw },
      );
      // The link already proved they control the email, so sign them straight
      // in rather than making them type what they just chose.
      if (res.email) {
        const r = await signIn("credentials", {
          email: res.email,
          password: pw,
          redirect: false,
        });
        if (!r?.error) {
          redirect("/");
          return;
        }
      }
      redirect("/login");
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? e.message
          : "Couldn't set your password. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="card pad login-card">
      <div className="eyebrow">Password reset</div>
      <h3>Choose a new password</h3>

      <label className="field" style={{ marginTop: 6 }}>
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="at least 6 characters"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>

      {mismatch && (
        <p className="form-error" role="alert">
          Those two passwords don&rsquo;t match.
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <button className="btn primary" disabled={!canSubmit} onClick={submit}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </div>
  );
}
```

Note for the implementer: in the test, "the button waits ..." expects a mismatch message via `getByText(/don.t match/i)`; the `role="alert"` paragraph above satisfies it. Because `mismatch` renders a `role="alert"`, the "expired link" test's `getByRole("alert")` runs with matching passwords, so only one alert exists there.

Create `app/forgot-password/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return (
    <div className="login-wrap">
      <ForgotPasswordForm available={emailConfigured()} />
    </div>
  );
}
```

Create `app/reset-password/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getResetTarget } from "@/lib/passwordReset";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";
// The URL carries a secret, so no Referer header may leak it onward.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await getResetTarget(token);
  return (
    <div className="wrap">
      <div className="appbar">
        <span className="mark">
          <span className="dot" />
          Velo Ladder
        </span>
      </div>
      {target ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="card pad login-card">
          <h3>This link isn&rsquo;t valid</h3>
          <p style={{ color: "var(--ink-dim)", fontSize: 13.5 }}>
            It may have expired or already been used. You can ask for a new one.
          </p>
          <a className="btn primary" href="/forgot-password">
            Send me a new link
          </a>
        </div>
      )}
    </div>
  );
}
```

In `components/LoginForm.tsx`, directly after the closing `</form>` and before the closing `</div>` of `.login-card`, add:

```tsx
      <p className="login-help">
        <a href="/forgot-password">Forgot password?</a>
      </p>
```

In `app/globals.css`, directly after the `.login-card input { ... }` rule (search for `.login-card input`), add:

```css
.login-help {
  margin: 12px 0 0;
  font-size: 13px;
  text-align: center;
}
.login-help a {
  color: var(--ink-dim);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/ForgotPasswordForm.test.tsx components/ResetPasswordForm.test.tsx components/LoginForm.test.tsx lib/resetPage.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"`
Expected: `fail 0`.

- [ ] **Step 5: Mutation check**

Backup each file before mutating. (a) `ForgotPasswordForm`: show an error when the request fails only for some emails, or change `CONFIRM` text: the confirmation tests must fail. (b) Remove `available` handling (always render the form): the not-configured test must fail. (c) `ResetPasswordForm`: change `pw.length >= 6` to `>= 4`: the button test must fail; swap `redirect("/")` for `redirect("/profile")`: the success test must fail; skip the `signIn` call: it must fail. (d) Remove `referrer` from the page metadata: `lib/resetPage.test.ts` must fail. (e) Remove the `Forgot password?` link: the LoginForm test must fail. Restore after each.

- [ ] **Step 6: Commit**

```bash
git add components app lib/resetPage.test.ts
git commit -m "Forgot password: the login link, the request page and the reset page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire sweep, docs and the full gate

**Files:**
- Modify: `lib/athleteWire.test.ts`, `HANDOFF.md`, `docs/superpowers/specs/2026-10-16-password-reset-design.md` (status line)
- Create (outside the repo): the memory note, see Step 5.

**Interfaces:**
- Consumes: `requestReset` from `@/lib/passwordReset`.

- [ ] **Step 1: Extend the wire sweep (failing first)**

In `lib/athleteWire.test.ts`:
1. Add `resetToken: string; resetHash: string;` to the `Seeded` interface.
2. In `seed()`, after the existing `const [row] = ...` password-hash query and before `return`, add:

```ts
  // A live reset claim for the athlete, so the sweep has a real token and a
  // real stored hash to look for on the wire.
  const pr = await import("@/lib/passwordReset");
  const claim = await pr.requestReset(ATHLETE_EMAIL);
  const [reset] = (await sql`
    SELECT reset_token_hash FROM athletes WHERE id = ${athlete.id}
  `) as { reset_token_hash: string }[];
```

and add `resetToken: claim!.token, resetHash: reset.reset_token_hash,` to the returned object.
3. Inside `test("no password hash or invite token reaches anyone", ...)`, inside the loop, append:

```ts
    assert.equal(
      r.body.includes(seeded.resetToken),
      false,
      `${r.file} (${r.status}) put a live reset token on the wire`,
    );
    assert.equal(
      r.body.includes(seeded.resetHash),
      false,
      `${r.file} (${r.status}) put a reset token hash on the wire`,
    );
```

- [ ] **Step 2: Run, then prove the sweep can fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/athleteWire.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"`
Expected: `fail 0`. Then mutate: in `toAthlete` in `lib/data.ts`, temporarily add `resetHash: r.reset_token_hash as string,` to the returned object (a scratch edit, backed up first), rerun, confirm "no password hash or invite token reaches anyone" FAILS naming a route, and restore from the backup.

- [ ] **Step 3: Document it**

In `HANDOFF.md`: add to the routes table
`| /api/password-reset/request | Public POST. Always answers {"ok":true}. Emails a reset link to the athlete's stored login email after the response. |` and
`| /api/password-reset/confirm | Public POST. Spends a reset link and sets the password. |`; add `/forgot-password` and `/reset-password/[token]` to the pages table; and add a section after "Emailing invites":

```
## Password reset (`lib/passwordReset.ts`)

Self-service: **Forgot password?** on the login page, an email with a link, a new
password, signed straight in. Athletes only; coach sign-in is one shared
`COACH_PASSWORD` with nothing per person to reset.

**Schema v29** (needs one `/api/setup` run): `athletes.reset_token_hash`,
`reset_expires`, `reset_requested_at`, and a `password_reset_sends` log. The token
is stored as a SHA-256 hash, never raw, and is separate from the invite token so a
public reset request can never cancel a pending invite.

**What protects it.** One answer for every request, so the form cannot reveal who is
on the roster. The lookup and email run after the response (`after()`), so timing does
not either. Links last 60 minutes and work once (the consume is one UPDATE). One email
per athlete per 10 minutes, and no more than 30 reset emails per rolling 24 hours
app-wide (`RESET_DAILY_CAP`), counted from `password_reset_sends`, so abuse cannot
use up Resend's free allowance and block real invites. Completing a reset also clears
any unused invite. The reset page sends `referrer: no-referrer` and is never cached.

**Known limits, deliberate.** A reset does not sign other devices out (sessions are
stateless). Nothing limits wrong-password attempts at the sign-in box; that is a
separate gap. Needs email configured (`RESEND_API_KEY`, `EMAIL_FROM`); without it the
forgot page says to ask the coach for a new invite.
```

In the spec file, change `**Status:** open question closed; awaiting Cole's approval` to `**Status:** implemented`.

- [ ] **Step 4: Run the full gate from a cold build**

Run: `rm -rf .next/static .next/server && npm run verify 2>&1 | grep -E "^ℹ (tests|pass|fail)|error TS|✖ [a-z]|Failed|rror:"`
Expected: `fail 0`. Also run `git status --short` and confirm the only changes are the files this plan names.

- [ ] **Step 5: Save the memory note**

Write `/Users/colethomas/.claude/projects/-Users-colethomas/memory/velo-ladder-password-reset.md` (frontmatter `name: velo-ladder-password-reset`, type `project`) recording: what shipped and the commit; that it is schema v29 and needs an `/api/setup` run; the constants (60 min, 10 min, 30 per day); that the form answers identically for everyone and why; that tests must mock `next/server`'s `after`; and the two known limits (no session revocation, no login throttling). Add one line to `MEMORY.md`. Link `[[velo-ladder-email-invites]]` and `[[velo-ladder-deploy-ritual]]`.

- [ ] **Step 6: Commit**

```bash
git add lib/athleteWire.test.ts HANDOFF.md docs/superpowers/specs/2026-10-16-password-reset-design.md
git commit -m "Sweep for leaked reset tokens, and document password reset

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off to Cole, in this order**

1. Push. 2. Open `https://velo-ladder.vercel.app/api/setup?key=<SETUP_KEY>&seed=1`, read the raw response, and confirm `schemaVersion` is **29**, `commit` matches, and `missing` is empty and `tables` includes `password_reset_sends`. 3. Live check with a test athlete: on the login page click **Forgot password?**, enter that athlete's email, confirm the email arrives (check spam), click the link, set a new password, confirm sign-in. 4. Reuse the same link and confirm the "isn't valid" page. 5. Ask again within 10 minutes and confirm no second email. 6. Enter an email that is not on the roster and confirm the same confirmation text appears.
