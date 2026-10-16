import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* GET /api/email tells the roster whether email is wired up, so its button can
 * say so before anyone clicks. It is a boolean and nothing more. */

process.env.COACH_EMAILS = "coach@cfg.test";
let signedInAs: string | null = "coach@cfg.test";
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

// getScope looks a non-coach up in the roster, so give it a real database
// with one athlete in it.
process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-emailcfg-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  await data.createAthlete({ name: "Jake Bell", inviteEmail: "kid@cfg.test" });
});

async function get() {
  const { GET } = await import("../app/api/email/route");
  return GET();
}

test("a coach is told whether email is configured, as a bare boolean", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  signedInAs = "coach@cfg.test";
  let res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { configured: true });

  delete process.env.RESEND_API_KEY;
  res = await get();
  assert.deepEqual(await res.json(), { configured: false });
});

test("the answer never contains the key or the sender", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  const text = await (await get()).text();
  assert.ok(!text.includes("re_secret"));
  assert.ok(!text.includes("powerpitcherpathway"));
});

test("a signed-out caller is refused", async () => {
  signedInAs = null;
  assert.equal((await get()).status, 401);
  signedInAs = "coach@cfg.test";
});

test("an athlete is refused, and learns nothing about the configuration", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  signedInAs = "kid@cfg.test";
  const res = await get();
  assert.equal(res.status, 403);
  assert.ok(!(await res.text()).includes("configured"));
  signedInAs = "coach@cfg.test";
});
