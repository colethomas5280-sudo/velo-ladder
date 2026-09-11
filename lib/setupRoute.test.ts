import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedLifts } from "@/lib/strength";
import { ALL_SEED_RECIPES } from "@/lib/recipes";

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
  recipes: { live: number; archived: number; missingSeed: string[]; unsorted: number };
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

/*
 * Recipes are seeded for the same reason lifts are: Cole's six already exist
 * as text, and asking him to retype them into a browser form is work the
 * machine should do. He ran a deploy expecting them and got an empty page,
 * which is what prompted this.
 */
test("a clean run reports Cole's recipes, and nothing missing", async () => {
  const body = await run();
  assert.deepEqual(body.recipes.missingSeed, []);
  assert.equal(body.recipes.live, ALL_SEED_RECIPES.length);
});

test("running it twice does not duplicate the library", async () => {
  const body = await run();
  assert.equal(body.recipes.live, ALL_SEED_RECIPES.length);
});

/*
 * Once a recipe is on his database it is HIS. A deploy that reinstated one he
 * removed, or overwrote an edit, would be the app arguing with the coach.
 */
test("a recipe Cole edited is not overwritten by the next deploy", async () => {
  const { sql } = await import("@/lib/db");
  await sql`UPDATE recipes SET title = 'Cole renamed this' WHERE id = 'seed-choc-pb'`;
  await run();
  const [row] = (await sql`SELECT title FROM recipes WHERE id = 'seed-choc-pb'`) as {
    title: string;
  }[];
  assert.equal(row.title, "Cole renamed this");
});

test("a recipe Cole removed stays removed", async () => {
  const { sql } = await import("@/lib/db");
  await sql`UPDATE recipes SET archived = true WHERE id = 'seed-tropical-gainer'`;
  const body = await run();
  assert.equal(body.recipes.archived >= 1, true);
  assert.equal(
    body.recipes.missingSeed.includes("seed-tropical-gainer"),
    false,
    "archived is not missing",
  );
});

/*
 * Cole: "the drop-down for breakfast lunch and dinner do not work. Nothing
 * pops up when you click on them." His recipes had no meal times, because the
 * backfill had not run — and the response said "live: 51", which was true and
 * answered a different question.
 */
test("a seeded recipe with no meal time is reported as unsorted", async () => {
  const { sql } = await import("@/lib/db");
  await sql`UPDATE recipes SET meals = ${"[]"}::jsonb WHERE id = 'seed-choc-pb'`;
  // Read the state directly: a setup run would repair it before reporting.
  const [row] = (await sql`
    SELECT count(*)::int AS n FROM recipes WHERE meals = ${"[]"}::jsonb
  `) as { n: number }[];
  assert.equal(row.n, 1, "the fixture did not take");

  const body = await run();
  assert.equal(body.recipes.unsorted, 0, "and the run repaired it");
});

/* A recipe Cole adds and leaves unsorted is his business, not an alarm. */
test("a recipe of Cole's own with no meal time is not counted against him", async () => {
  const data = await import("@/lib/data");
  await data.createRecipe({ title: "Cole's unsorted idea" });
  const body = await run();
  assert.equal(body.recipes.unsorted, 0);
  assert.equal(body.warning, undefined);
});
