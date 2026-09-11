import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedLifts } from "@/lib/strength";

/* ------------------------------------------------------------------ *
 * What /api/setup can actually tell Cole
 *
 * He reads this response after every deploy, and it is the only view he has
 * of whether a migration landed. It used to answer "do the tables exist",
 * which the lift menu made insufficient: the menu grows by
 * INSERT ... ON CONFLICT (key) DO NOTHING, so a deploy adding three lifts
 * and one adding none produced identical output.
 * ------------------------------------------------------------------ */

const KEY = "setup-test-key";
process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-setup-"));
process.env.PGLITE_DIR = DB_DIR;
after(() => rmSync(DB_DIR, { recursive: true, force: true }));
process.env.SETUP_KEY = KEY;

mock.module("@/lib/auth", {
  exports: { auth: async () => null },
} as Parameters<typeof mock.module>[1]);

type Body = {
  ok?: boolean;
  error?: string;
  warning?: string;
  schemaVersion: number;
  missing: string[];
  lifts: { live: number; archived: number; missingSeed: string[] };
};

let route: typeof import("../app/api/setup/route");
const run = async (): Promise<Body> => {
  const res = await route.GET(new Request(`http://setup.test/api/setup?key=${KEY}`));
  return (await res.json()) as Body;
};

before(async () => {
  route = await import("../app/api/setup/route");
});

test("a clean run reports the whole seeded menu and nothing missing", async () => {
  const body = await run();
  assert.equal(body.ok, true, body.error);
  assert.deepEqual(body.missing, [], "no tables missing");
  assert.deepEqual(body.lifts.missingSeed, [], "and the seed landed");
  assert.equal(body.lifts.live, seedLifts().length);
  assert.equal(body.warning, undefined);
});

test("running it twice changes nothing — no duplicate menu", async () => {
  const body = await run();
  assert.equal(body.lifts.live, seedLifts().length, "still one row per lift");
});

/*
 * Setup REPAIRS a missing lift rather than only reporting one — the seed runs
 * every time. Worth locking: it means a row lost to a failed migration, or
 * deleted by hand in the database console, comes back on the next run without
 * anyone reconstructing it.
 */
test("a lift missing from the menu is put back, not just named", async () => {
  const { sql } = await import("@/lib/db");
  await sql`DELETE FROM lifts WHERE key = 'back-squat'`;
  const [gone] = (await sql`SELECT count(*)::int AS n FROM lifts WHERE key = 'back-squat'`) as { n: number }[];
  assert.equal(gone.n, 0, "removed, so the repair is a real one");

  const body = await run();
  assert.deepEqual(body.lifts.missingSeed, [], "back on the menu");
  assert.equal(body.warning, undefined);
  // Asserted against the table, not against a count that another test can move.
  const [back] = (await sql`SELECT name FROM lifts WHERE key = 'back-squat'`) as { name: string }[];
  assert.equal(back?.name, "Back squat");
});

/*
 * A lift Cole retires is archived, never deleted — so it stays out of the
 * live count and must NOT be reported as a failed insert.
 */
test("a lift Cole retired is archived, not reported as missing", async () => {
  const { sql } = await import("@/lib/db");
  await sql`UPDATE lifts SET archived = true WHERE key = 'high-plank'`;

  const body = await run();
  assert.equal(body.lifts.archived, 1);
  assert.equal(
    body.lifts.live,
    seedLifts().length - 1,
    "the retired one is out of the live count, not merely tallied beside it",
  );
  assert.equal(
    body.lifts.missingSeed.includes("high-plank"),
    false,
    "retiring a lift is not a broken migration",
  );
});
