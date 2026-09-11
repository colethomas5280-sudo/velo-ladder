import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The lifting write path, run for real
 *
 * The leak sweep covers GET only — a stated limit, and this is the gap it
 * leaves. Everything below drives the actual route handlers against a real
 * (PGlite) database: an athlete writing their own day, a coach writing it for
 * them, and a stranger being turned away.
 *
 * It matters more here than on the movement screen because this is the first
 * route an ATHLETE can write through. `canSeeAthlete` is the only thing
 * standing between one kid and another kid's training log.
 * ------------------------------------------------------------------ */

const COACH = "coach@lift.test";
const MINE = "kid@lift.test";
const THEIRS = "other@lift.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-lift-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  // A live PGlite holds the event loop open; leaving it running is what the
  // runner's --test-force-exit was hiding.
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
process.env.COACH_EMAILS = COACH;

let signedInAs: string | null = MINE;
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

let mineId = "";
let theirsId = "";
type Route = typeof import("../app/api/athletes/[id]/lifts/route");
let route: Route;
let overview: typeof import("../app/api/strength/overview/route");

before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  mineId = (await data.createAthlete({ name: "My Kid", hand: "R", inviteEmail: MINE })).id;
  theirsId = (await data.createAthlete({ name: "Their Kid", hand: "L", inviteEmail: THEIRS })).id;
  route = await import("../app/api/athletes/[id]/lifts/route");
  overview = await import("../app/api/strength/overview/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  route.POST(
    new Request("http://lift.test/api", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
const get = (id: string) => route.GET(new Request("http://lift.test/api"), ctx(id));
const del = (id: string, date: string) =>
  route.DELETE(
    new Request(`http://lift.test/api?date=${date}`, { method: "DELETE" }),
    ctx(id),
  );

const TODAY = "2026-09-01";
const aDay = (over: Record<string, unknown> = {}) => ({
  date: TODAY,
  lifts: { "back-squat": [{ w: 225, r: 5 }] },
  notes: "",
  ...over,
});

test("an athlete logs their own day and reads it back", async () => {
  signedInAs = MINE;
  const res = await post(mineId, aDay());
  assert.equal(res.status, 201, await res.text());

  const back = (await (await get(mineId)).json()) as { date: string; lifts: unknown }[];
  assert.equal(back.length, 1);
  assert.equal(back[0].date, TODAY, "the date comes back as the day it was sent");
  assert.deepEqual(back[0].lifts, { "back-squat": [{ w: 225, r: 5 }] });
});

/*
 * The bug the movement screen shipped: a date read back through `String()`
 * came out as the previous evening, so re-opening a session created a second
 * one instead of replacing it.
 */
test("saving the same date replaces the day rather than adding a second", async () => {
  signedInAs = MINE;
  await post(mineId, aDay({ lifts: { "back-squat": [{ w: 235, r: 5 }] } }));
  const back = (await (await get(mineId)).json()) as { lifts: Record<string, unknown> }[];
  assert.equal(back.length, 1, "one day, not two");
  assert.deepEqual(back[0].lifts, { "back-squat": [{ w: 235, r: 5 }] });
});

test("a coach can write for an athlete", async () => {
  signedInAs = COACH;
  const res = await post(mineId, aDay({ date: "2026-08-25" }));
  assert.equal(res.status, 201, await res.text());
});

test("an athlete cannot read or write another athlete's log", async () => {
  signedInAs = MINE;
  assert.equal((await get(theirsId)).status, 403);
  assert.equal((await post(theirsId, aDay())).status, 403);
  assert.equal((await del(theirsId, TODAY)).status, 403);

  signedInAs = COACH;
  const theirs = (await (await get(theirsId)).json()) as unknown[];
  assert.deepEqual(theirs, [], "and nothing was written there");
});

test("signed out gets a 401, not a 403", async () => {
  signedInAs = null;
  assert.equal((await get(mineId)).status, 401);
  assert.equal((await post(mineId, aDay())).status, 401);
});

test("a bad day is refused with a message, and nothing is stored", async () => {
  signedInAs = MINE;
  const before = ((await (await get(mineId)).json()) as unknown[]).length;

  for (const body of [
    aDay({ date: "2026-02-30" }),
    aDay({ date: "2099-01-01" }),
    aDay({ lifts: { "power-snatch": [{ w: 135, r: 3 }] } }),
    aDay({ lifts: { "back-squat": [{ w: 5000, r: 5 }] } }),
    aDay({ lifts: {}, notes: "" }),
  ]) {
    const res = await post(mineId, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const { error } = (await res.json()) as { error: string };
    assert.ok(error && error.length > 5, "a 400 has to say what was wrong");
  }

  const after = ((await (await get(mineId)).json()) as unknown[]).length;
  assert.equal(after, before, "a refused day left nothing behind");
});

test("deleting takes the day out", async () => {
  signedInAs = MINE;
  assert.equal((await del(mineId, TODAY)).status, 200);
  const back = (await (await get(mineId)).json()) as { date: string }[];
  assert.equal(back.some((d) => d.date === TODAY), false);
});

test("the roster is coach-only, and counts what the athlete logged", async () => {
  signedInAs = MINE;
  assert.equal((await overview.GET()).status, 403);

  signedInAs = COACH;
  const rows = (await (await overview.GET()).json()) as {
    name: string;
    last: string | null;
    lifts: number;
  }[];
  const mine = rows.find((r) => r.name === "My Kid")!;
  assert.equal(mine.last, "2026-08-25", "the coach's day, the one left after the delete");
  assert.equal(mine.lifts, 1);
  assert.equal(rows.find((r) => r.name === "Their Kid")!.last, null);
});
