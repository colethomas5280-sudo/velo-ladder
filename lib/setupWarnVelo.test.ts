import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The warning /api/setup gives when the velo ladder is short
 *
 * Its own file, for the same reason as the lift one: a real failure cannot be
 * staged. The seed upserts on every run, so a deleted row is put back before
 * the check reads it, and a rejected INSERT makes execScript throw, which setup
 * already reports as an outright failure. The check is belt-and-braces, and the
 * wiring from check to response still has to work the day it is not.
 *
 * Mocked at `missingSeedVelo` only. Everything else is the real thing.
 * ------------------------------------------------------------------ */

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-setupwarn-velo-"));
process.env.PGLITE_DIR = DB_DIR;
after(() => rmSync(DB_DIR, { recursive: true, force: true }));
process.env.SETUP_KEY = "warn-velo-key";

let route: typeof import("../app/api/setup/route");

before(async () => {
  const real = await import("@/lib/veloSeed");
  mock.module("@/lib/veloSeed", {
    exports: {
      ...real,
      missingSeedVelo: () => ({ ranges: ["juco", "ncaa-d2"], sources: ["coleman-how-hard"] }),
    },
  } as Parameters<typeof mock.module>[1]);
  route = await import("../app/api/setup/route");
});

test("a short ladder is reported, and named in prose, on an otherwise clean run", async () => {
  const res = await route.GET(
    new Request("http://setup.test/api/setup?key=warn-velo-key"),
  );
  const body = (await res.json()) as {
    ok: boolean;
    warning?: string;
    velo: { ranges: { missingSeed: string[] }; sources: { missingSeed: string[] } };
  };

  assert.equal(body.ok, true, "the schema itself applied");
  assert.deepEqual(body.velo.ranges.missingSeed, ["juco", "ncaa-d2"]);
  assert.deepEqual(body.velo.sources.missingSeed, ["coleman-how-hard"]);
  // Named in a sentence as well as in the array: he reads this by eye after a
  // deploy, and a slug in a nested field is one he scrolls past.
  assert.match(body.warning ?? "", /juco/);
  assert.match(body.warning ?? "", /ncaa-d2/);
  assert.match(body.warning ?? "", /coleman-how-hard/);
  assert.match(body.warning ?? "", /velo level/);
  assert.match(body.warning ?? "", /velo source/);
});
