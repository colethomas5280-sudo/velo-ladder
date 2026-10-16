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
  // Two inserts can land in the same clock tick, and ids are random UUIDs, so
  // pin the order: First is older, and its id sorts BEFORE Second's, so a
  // lookup that ordered by id descending (or not by age) would pick Second.
  await sql`UPDATE athletes SET id = ${"a-" + first.id}, created_at = now() - interval '1 hour' WHERE id = ${first.id}`;
  await sql`UPDATE athletes SET id = ${"z-" + second.id} WHERE id = ${second.id}`;
  first.id = "a-" + first.id;
  second.id = "z-" + second.id;
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
