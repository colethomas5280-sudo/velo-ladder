import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISCLOSURES } from "@/lib/veloPlacement";
import { veloSeedData } from "@/lib/veloSeed";

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
type EvaluateRoute = typeof import("../app/api/velo/evaluate/route");
let rangesRoute: RangesRoute;
let sourcesRoute: SourcesRoute;
let evaluateRoute: EvaluateRoute;

before(async () => {
  const db = await import("@/lib/db");
  await db.execScript((await import("@/lib/schema")).SCHEMA_SQL);
  rangesRoute = await import("../app/api/velo/ranges/route");
  sourcesRoute = await import("../app/api/velo/sources/route");
  evaluateRoute = await import("../app/api/velo/evaluate/route");
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

test("a coach gets every row the snapshot holds, in display order", async () => {
  signedInAs = COACH;
  const res = await getRanges();
  const rows = await res.json();
  assert.equal(res.status, 200, JSON.stringify(rows));
  // Against the snapshot, not a literal: the data is the coach's and grows.
  assert.equal(rows.length, veloSeedData.ranges.length);
  assert.deepEqual(
    [...rows].sort((a, b) => a.displayOrder - b.displayOrder),
    rows,
  );
});

test("a coach gets every source the snapshot holds", async () => {
  signedInAs = COACH;
  const res = await getSources();
  const rows = await res.json();
  assert.equal(res.status, 200, JSON.stringify(rows));
  assert.equal(rows.length, veloSeedData.sources.length);
});

test("every level arrives exactly as the snapshot has it: nulls stay null, numbers are numbers", async () => {
  /*
   * Row by row against the file, so it holds for whatever the file contains.
   * pg hands a numeric column back as a STRING, and a null must not become a 0
   * on the way, or "No data yet" turns into a benchmark of zero miles an hour.
   */
  signedInAs = COACH;
  const rows = (await (await getRanges()).json()) as Record<string, unknown>[];
  const bySlug = new Map(rows.map((r) => [r.slug as string, r]));
  const band = (v: number | null) => (v === null ? null : Number(v));
  for (const s of veloSeedData.ranges) {
    const got = bySlug.get(s.slug);
    assert.ok(got, `${s.slug} is in the snapshot but not in the response`);
    assert.equal(got.level, s.level, s.slug);
    assert.equal(got.category, s.category, s.slug);
    assert.equal(got.rowType, s.row_type, s.slug);
    assert.equal(got.rhpLow, band(s.rhp_low), `${s.slug} rhpLow`);
    assert.equal(got.rhpHigh, band(s.rhp_high), `${s.slug} rhpHigh`);
    assert.equal(got.lhpLow, band(s.lhp_low), `${s.slug} lhpLow`);
    assert.equal(got.lhpHigh, band(s.lhp_high), `${s.slug} lhpHigh`);
    assert.equal(got.combinedLow, band(s.combined_low), `${s.slug} combinedLow`);
    assert.equal(got.combinedHigh, band(s.combined_high), `${s.slug} combinedHigh`);
    assert.equal(got.eliteTrajectoryRef, band(s.elite_trajectory_ref), `${s.slug} elite ref`);
    assert.equal(got.confidence, s.confidence, `${s.slug} confidence`);
  }
});

test("a level with no data at all comes back with nulls, not zeros", async () => {
  /*
   * Built here rather than borrowed from the snapshot. Which levels are empty
   * is the coach's business and shrinks the day he sources pro-level data, so
   * a test that named a MiLB row would fail on exactly the change he is hoping
   * to make, and one that took whichever row was empty would silently check
   * nothing once none were.
   */
  signedInAs = COACH;
  const { sql } = await import("@/lib/db");
  await sql`
    INSERT INTO velo_ranges (slug, level, category, row_type, display_order)
    VALUES ('zz-empty-fixture', 'Fixture', 'Fixture', 'primary', 999999)
  `;
  try {
    const rows = (await (await getRanges()).json()) as Record<string, unknown>[];
    const row = rows.find((r) => r.slug === "zz-empty-fixture");
    assert.ok(row, "the fixture row did not come back at all");
    for (const k of [
      "rhpLow", "rhpHigh", "lhpLow", "lhpHigh",
      "combinedLow", "combinedHigh", "eliteTrajectoryRef", "confidence",
    ])
      assert.equal(row[k], null, `${k} became ${String(row[k])} instead of null`);
  } finally {
    await sql`DELETE FROM velo_ranges WHERE slug = 'zz-empty-fixture'`;
  }
});

test("every level carries exactly its own source slugs", async () => {
  signedInAs = COACH;
  const rows = (await (await getRanges()).json()) as {
    slug: string;
    sourceSlugs: string[];
  }[];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const s of veloSeedData.ranges) {
    const got = bySlug.get(s.slug);
    assert.ok(got, `${s.slug} missing from the response`);
    assert.deepEqual(
      [...got.sourceSlugs].sort(),
      [...s.source_slugs].sort(),
      `${s.slug} cites a different set of sources than the snapshot`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Cache-Control on every response, not just the 200
 *
 * The header exists so a stale cache can never hand one user's response to
 * another after a sign-out/sign-in swap. A cached 403 played back to a coach
 * who has since signed in properly is that same failure, even though there
 * is no athlete data in an error body — so the header has to be on the 401
 * and the 403 too, not only on the success path.
 * ------------------------------------------------------------------ */

test("an athlete's forbidden response from the ladder route is never cached", async () => {
  signedInAs = ATHLETE;
  const res = await getRanges();
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});

test("an athlete's forbidden response from the sources route is never cached", async () => {
  signedInAs = ATHLETE;
  const res = await getSources();
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});

test("a signed-out response from the ladder route is never cached", async () => {
  signedInAs = null;
  const res = await getRanges();
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});

test("a signed-out response from the sources route is never cached", async () => {
  signedInAs = null;
  const res = await getSources();
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});

test("a coach's successful responses are never cached either", async () => {
  signedInAs = COACH;
  const ranges = await getRanges();
  const sources = await getSources();
  assert.equal(ranges.headers.get("Cache-Control"), "private, no-store");
  assert.equal(sources.headers.get("Cache-Control"), "private, no-store");
});

/* ------------------------------------------------------------------ *
 * POST /api/velo/evaluate
 *
 * The placement logic and its coaching wording live behind this route so
 * they never ship in the browser bundle. Same three questions as the GET
 * routes (who gets in, is anything cacheable, does the gate run first), plus
 * two of its own: is the placement really the server's, and does a bad
 * request come back as a message rather than a crash.
 *
 * Real ranges are always in the database here (the schema seeds all 25), so
 * an athlete's 403 cannot pass merely because there was nothing to return.
 * ------------------------------------------------------------------ */

const NO_STORE = "private, no-store";

const post = (body: unknown) =>
  evaluateRoute.POST(
    new Request("http://localhost/api/velo/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const SIXTEEN_U = { slug: "16u-hs-jv-soph", floor: 74, sitting: 79, peak: 83 };

test("an athlete cannot evaluate a session", async () => {
  signedInAs = ATHLETE;
  const res = await post(SIXTEEN_U);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
  const body = await res.json();
  assert.equal(body.placement, undefined, "no placement may reach an athlete");
  assert.equal(body.disclosures, undefined);
});

test("a signed-out request cannot evaluate a session", async () => {
  signedInAs = null;
  const res = await post(SIXTEEN_U);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});

test("the gate runs before the body is read: a malformed body from an athlete is 403, not 400", async () => {
  signedInAs = ATHLETE;
  const res = await post("{ this is not json");
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});

test("a coach gets the placement, the band, the confidence and the exact disclosures", async () => {
  signedInAs = COACH;
  const res = await post(SIXTEEN_U);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
  assert.equal(body.ok, true);
  assert.equal(body.placement, "AVERAGE_UPPER_HALF");
  assert.equal(body.label, "Average, upper half");
  assert.deepEqual(body.band, { kind: "Combined", low: 69, high: 85, midpoint: 77 });
  assert.equal(body.confidence, "Medium");
  assert.deepEqual(body.flags, ["PROJECTABILITY_GAP"]);
  assert.deepEqual(body.disclosures, [
    DISCLOSURES.confidence("Medium"),
    DISCLOSURES.percentileScope,
  ]);
});

test("the JUCO right-hander from the guide places the same way over the wire", async () => {
  signedInAs = COACH;
  const res = await post({ slug: "juco", hand: "R", floor: 84, sitting: 88, peak: 91 });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.label, "Average, upper half");
  assert.deepEqual(body.band, { kind: "RHP", low: 82, high: 90, midpoint: 86 });
  assert.deepEqual(body.flags, ["PEAK_ABOVE_BAND"]);
});

test("the band comes from the database, never from the request", async () => {
  signedInAs = COACH;
  const res = await post({
    ...SIXTEEN_U,
    range: { combinedLow: 1, combinedHigh: 2, confidence: "High" },
    band: { kind: "Combined", low: 1, high: 2, midpoint: 1.5 },
    confidence: "High",
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.band, { kind: "Combined", low: 69, high: 85, midpoint: 77 });
  assert.equal(body.confidence, "Medium");
});

test("an unknown level is a 400 that is never cached", async () => {
  signedInAs = COACH;
  const res = await post({ ...SIXTEEN_U, slug: "not-a-level" });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
  assert.match((await res.json()).error, /not-a-level/);
});

test("a missing level is a 400", async () => {
  signedInAs = COACH;
  const res = await post({ floor: 74, sitting: 79, peak: 83 });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});

test("a velocity out of range is a 400 carrying evaluate's message", async () => {
  signedInAs = COACH;
  const res = await post({ ...SIXTEEN_U, peak: 500 });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
  assert.match(body.error, /must each be between/);
});

test("a peak below the average is a 400", async () => {
  signedInAs = COACH;
  const res = await post({ ...SIXTEEN_U, peak: 77 });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});

test("a velocity sent as a string is a 400, not a placement", async () => {
  signedInAs = COACH;
  const res = await post({ ...SIXTEEN_U, sitting: "79" });
  assert.equal(res.status, 400);
});

test("a hand-split row with no hand is a 400 that says so", async () => {
  signedInAs = COACH;
  const res = await post({ slug: "ncaa-d1-power-4", floor: 90, sitting: 93, peak: 95 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /throwing hand is required/i);
});

test("a hand that is not R or L is a 400", async () => {
  signedInAs = COACH;
  const res = await post({ ...SIXTEEN_U, hand: "X" });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});

test("a coach's malformed body is a 400 with the header", async () => {
  signedInAs = COACH;
  const res = await post("{ this is not json");
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), NO_STORE);
});
