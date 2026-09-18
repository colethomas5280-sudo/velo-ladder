import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDeliveryInput } from "@/lib/deliveryInput";

/* ------------------------------------------------------------------ *
 * The delivery write path
 *
 * The route's authorization mirrors the screen's: an athlete reads their own,
 * only a coach records or removes one. The rules that are this route's own
 * live in the validator, and these pin the ones a coach would notice.
 * ------------------------------------------------------------------ */

test("a coach can record an assessment with nothing found", () => {
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: {} }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("the payload the modal sends round-trips", () => {
  const body = { date: "2026-01-01", flaws: { sway: true }, notes: "side view" };
  const got = parseDeliveryInput(body, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value, body);
});

/* ------------------------------------------------------------------ *
 * Write-path authorization, run against the real route
 *
 * Following the shape of lib/liftRoute.test.ts: a real PGlite database, the
 * real auth mock, and the actual route handlers — not a re-statement of what
 * `scope.role !== "coach"` is supposed to do. The validator tests above pin
 * the payload; these pin who is allowed to send one at all.
 * ------------------------------------------------------------------ */

const COACH = "coach@delivery.test";
const ATHLETE = "kid@delivery.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-delivery-"));
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

let athleteId = "";
type Route = typeof import("../app/api/athletes/[id]/delivery/route");
type ScreensRoute = typeof import("../app/api/athletes/[id]/screens/route");
let route: Route;
let screensRoute: ScreensRoute;
let sql: import("@/lib/db").SqlTag;

before(async () => {
  const db = await import("@/lib/db");
  await db.execScript((await import("@/lib/schema")).SCHEMA_SQL);
  sql = db.sql;
  const data = await import("@/lib/data");
  athleteId = (await data.createAthlete({ name: "Delivery Kid", hand: "R", inviteEmail: ATHLETE })).id;
  route = await import("../app/api/athletes/[id]/delivery/route");
  screensRoute = await import("../app/api/athletes/[id]/screens/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  route.POST(
    new Request("http://delivery.test/api", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
const del = (id: string, date: string) =>
  route.DELETE(
    new Request(`http://delivery.test/api?date=${date}`, { method: "DELETE" }),
    ctx(id),
  );

const postScreen = (id: string, body: unknown) =>
  screensRoute.POST(
    new Request("http://delivery.test/api", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

const anAssessment = (over: Record<string, unknown> = {}) => ({
  date: "2026-01-01",
  flaws: { sway: true },
  notes: "",
  ...over,
});

test("an athlete cannot record their own assessment", async () => {
  signedInAs = ATHLETE;
  const res = await post(athleteId, anAssessment());
  assert.equal(res.status, 403, await res.text());
});

test("an athlete cannot delete their own assessment", async () => {
  signedInAs = ATHLETE;
  const res = await del(athleteId, "2026-01-01");
  assert.equal(res.status, 403, await res.text());
});

test("a coach can record an assessment through the route", async () => {
  signedInAs = COACH;
  const res = await post(athleteId, anAssessment());
  assert.equal(res.status, 201, await res.text());
});

/* ------------------------------------------------------------------ *
 * The wipe class this split exists to prevent
 *
 * The two assessments used to share a row, and saving one blanked the
 * other because the shared upsert wrote both halves. Splitting them onto
 * separate tables is only a fix if each write path stays off the other's
 * table. Tested from both directions, against the real routes and a real
 * database, not by reading the SQL each upsert issues.
 * ------------------------------------------------------------------ */

test("recording inhibitors never writes to movement_screens", async () => {
  signedInAs = COACH;
  const res = await post(athleteId, anAssessment({ date: "2026-02-01" }));
  assert.equal(res.status, 201, await res.text());

  const rows = (await sql`
    SELECT id FROM movement_screens WHERE athlete_id = ${athleteId} AND date = '2026-02-01'
  `) as Record<string, unknown>[];
  assert.equal(rows.length, 0, "recording inhibitors created a movement_screens row");
});

test("recording a screen never writes to delivery_screens", async () => {
  signedInAs = COACH;
  const res = await postScreen(athleteId, {
    date: "2026-02-02",
    results: { "hip-45.45-degree-angle:L": "greater" },
    notes: "",
  });
  assert.equal(res.status, 201, await res.text());

  const rows = (await sql`
    SELECT id FROM delivery_screens WHERE athlete_id = ${athleteId} AND date = '2026-02-02'
  `) as Record<string, unknown>[];
  assert.equal(rows.length, 0, "recording a screen created a delivery_screens row");
});

/*
 * lib/data.ts:942-951 (upsertScreen) used to write `flaws` and
 * `delivery_assessed` back into movement_screens on every save, including
 * the DO UPDATE branch. The screen modal never sends either field, so they
 * silently defaulted to `{}` / false — blanking a row a coach had already
 * marked assessed. In the window between a deploy going live and someone
 * running /api/setup, that meant the v27 migration's
 * `WHERE delivery_assessed = true` would skip the row for good.
 */
test("saving a movement screen does not touch a delivery-assessed row's own columns", async () => {
  await sql`
    INSERT INTO movement_screens
      (id, athlete_id, date, results, flaws, delivery_assessed, created_by)
    VALUES ('ms-pre-migration', ${athleteId}, '2026-03-01', '{}'::jsonb,
            '{"early-trunk-rotation":true}'::jsonb, true, ${COACH})
  `;

  signedInAs = COACH;
  const res = await postScreen(athleteId, {
    date: "2026-03-01",
    results: { "hip-45.45-degree-angle:L": "greater" },
    notes: "re-tested the hip",
  });
  assert.equal(res.status, 201, await res.text());

  const rows = (await sql`
    SELECT flaws, delivery_assessed FROM movement_screens
    WHERE athlete_id = ${athleteId} AND date = '2026-03-01'
  `) as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].flaws,
    { "early-trunk-rotation": true },
    "the screen save blanked the pre-existing flaws column",
  );
  assert.equal(
    rows[0].delivery_assessed,
    true,
    "the screen save reset delivery_assessed to false",
  );
});
