import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The warning /api/setup gives when the lift menu is short
 *
 * Its own file because it needs the check to report a failure, and a real one
 * cannot be staged: a rejected INSERT makes execScript throw, which setup
 * already reports as an outright failure, and a deleted row is put back by
 * the seed on the very next run. So the check is belt-and-braces — and the
 * wiring from check to response still has to work the day it is not.
 *
 * Mocked at `missingSeedLifts` only. Everything else, including the seed
 * itself, is the real thing.
 * ------------------------------------------------------------------ */

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-setupwarn-"));
process.env.PGLITE_DIR = DB_DIR;
after(() => rmSync(DB_DIR, { recursive: true, force: true }));
process.env.SETUP_KEY = "warn-test-key";

let route: typeof import("../app/api/setup/route");

/*
 * All of this inside `before` rather than at the top level: tsx compiles these
 * files to CJS, where top-level await is a build error. What matters is only
 * that the mock is installed before the route — and everything it imports —
 * is first loaded, which this ordering guarantees.
 */
before(async () => {
  const real = await import("@/lib/strength");
  mock.module("@/lib/strength", {
    exports: { ...real, missingSeedLifts: () => ["back-squat", "pull-up"] },
  } as Parameters<typeof mock.module>[1]);
  route = await import("../app/api/setup/route");
});

test("a short menu is reported, and named, on an otherwise clean run", async () => {
  const res = await route.GET(
    new Request("http://setup.test/api/setup?key=warn-test-key"),
  );
  const body = (await res.json()) as {
    ok: boolean;
    warning?: string;
    lifts: { missingSeed: string[] };
  };

  assert.equal(body.ok, true, "the schema itself applied");
  assert.deepEqual(body.lifts.missingSeed, ["back-squat", "pull-up"]);
  /*
   * Named in prose as well as in the array. Cole reads this response by eye
   * after a deploy, and a key buried in a nested field is a key he scrolls
   * past — the whole reason the old table check was not enough.
   */
  assert.match(body.warning ?? "", /back-squat/);
  assert.match(body.warning ?? "", /pull-up/);
  assert.match(body.warning ?? "", /cannot log/i);
});
