import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The coach-only velo ladder routes
 *
 * Following the shape of lib/deliveryRoute.test.ts: a real PGlite database,
 * the real auth mock, and the actual route handlers — not a re-statement of
 * what `scope.role !== "coach"` is supposed to do. This is the entire point
 * of the feature, so it is pinned against the real GET handlers rather than
 * against listVeloRanges/listVeloSources directly.
 * ------------------------------------------------------------------ */

const COACH = "coach@velo.test";
const ATHLETE = "kid@velo.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-ladder-route-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  // A live PGlite holds the event loop open; leaving it running is what the
  // runner's --test-force-exit was hiding.
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
process.env.COACH_EMAILS = COACH;

let signedInAs: string | null = ATHLETE;
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

type RangesRoute = typeof import("../app/api/velo/ranges/route");
type SourcesRoute = typeof import("../app/api/velo/sources/route");
let rangesRoute: RangesRoute;
let sourcesRoute: SourcesRoute;

before(async () => {
  const db = await import("@/lib/db");
  await db.execScript((await import("@/lib/schema")).SCHEMA_SQL);
  rangesRoute = await import("../app/api/velo/ranges/route");
  sourcesRoute = await import("../app/api/velo/sources/route");
});

const getRanges = () => rangesRoute.GET();
const getSources = () => sourcesRoute.GET();

test("an athlete cannot read the ladder", async () => {
  signedInAs = ATHLETE;
  const res = await getRanges();
  assert.equal(res.status, 403);
});

test("an athlete cannot read the sources", async () => {
  signedInAs = ATHLETE;
  const res = await getSources();
  assert.equal(res.status, 403);
});

test("a signed-out request is refused before anything is read", async () => {
  signedInAs = null;
  const res = await getRanges();
  assert.equal(res.status, 401);
});

test("a coach gets all 25 rows in display order", async () => {
  signedInAs = COACH;
  const res = await getRanges();
  const rows = await res.json();
  assert.equal(res.status, 200, JSON.stringify(rows));
  assert.equal(rows.length, 25);
  assert.deepEqual(
    [...rows].sort((a, b) => a.displayOrder - b.displayOrder),
    rows,
  );
});

test("a coach gets all 11 sources", async () => {
  signedInAs = COACH;
  const res = await getSources();
  const rows = await res.json();
  assert.equal(res.status, 200, JSON.stringify(rows));
  assert.equal(rows.length, 11);
});

test("a row with no data comes back with nulls, not zeros", async () => {
  signedInAs = COACH;
  const res = await getRanges();
  const rows = await res.json();
  const row = rows.find((r: { slug: string }) => r.slug === "milb-aaa");
  assert.ok(row, "expected a milb-aaa row");
  /*
   * The UI must be able to render "No data yet". A 0 would render as a real
   * benchmark of zero miles an hour.
   */
  assert.equal(row.combinedLow, null);
  assert.equal(row.rhpLow, null);
  assert.equal(row.confidence, null);
});

test("each row carries its own source slugs", async () => {
  signedInAs = COACH;
  const res = await getRanges();
  const rows = await res.json();
  const row = rows.find((r: { slug: string }) => r.slug === "13u");
  assert.ok(row, "expected a 13u row");
  assert.equal(row.sourceSlugs.length, 7);
});
