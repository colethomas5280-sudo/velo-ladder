import { test, before, after, mock } from "node:test";
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
  assert.equal(again.headers.get("cache-control"), "no-store");
  assert.match((await again.json()).error, /expired or was already used/);
  assert.ok(await bcrypt.compare("first-choice-pw", String(await hashOf(c.id))));
});

test("a short password is refused and does not spend the link", async () => {
  const c = await claimed();
  const res = await post({ token: c.token, password: "short" });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("cache-control"), "no-store");
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
    assert.equal(res.headers.get("cache-control"), "no-store", JSON.stringify(token));
  }
  assert.equal(await hashOf(c.id), null);
});

test("a token that matches nothing costs no password hash", async () => {
  const c = await claimed();
  await sql`UPDATE athletes SET reset_expires = now() - interval '1 minute' WHERE id = ${c.id}`;
  const hash = mock.method(bcrypt, "hash");
  try {
    for (const token of ["nonsense", "", 42, c.token /* expired */]) {
      assert.equal((await post({ token, password: "does-not-matter-pw" })).status, 404);
    }
    assert.equal(hash.mock.callCount(), 0, "junk tokens must not reach bcrypt");

    // The spy is live, so a good link does hash: the zero above is not a dead spy.
    const good = await claimed();
    assert.equal((await post({ token: good.token, password: "a-real-new-pw" })).status, 200);
    assert.equal(hash.mock.callCount(), 1);
  } finally {
    hash.mock.restore();
  }
});

test("malformed bodies are refused without a crash", async () => {
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post("null")).status, 400);
  assert.equal((await post("[]")).status, 400);
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
