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
let route: Route;

before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  athleteId = (await data.createAthlete({ name: "Delivery Kid", hand: "R", inviteEmail: ATHLETE })).id;
  route = await import("../app/api/athletes/[id]/delivery/route");
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
