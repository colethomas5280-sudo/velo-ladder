import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lift } from "@/lib/strength";

/* ------------------------------------------------------------------ *
 * The lift menu, run for real
 *
 * The menu stopped being a constant in the code the day Cole said he wanted
 * to add lifts himself. What that buys him is a rename that doesn't orphan a
 * year of training — and that property lives entirely in the routes below, so
 * they are driven against a real database rather than asserted about.
 * ------------------------------------------------------------------ */

const COACH = "coach@menu.test";
const ATHLETE = "kid@menu.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-menu-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  // A live PGlite holds the event loop open; leaving it running is what the
  // runner's --test-force-exit was hiding.
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
process.env.COACH_EMAILS = COACH;

let signedInAs: string | null = COACH;
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

let athleteId = "";
let menuRoute: typeof import("../app/api/lifts/route");
let oneRoute: typeof import("../app/api/lifts/[key]/route");
let daysRoute: typeof import("../app/api/athletes/[id]/lifts/route");

before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  athleteId = (
    await data.createAthlete({ name: "Menu Kid", hand: "R", inviteEmail: ATHLETE })
  ).id;
  menuRoute = await import("../app/api/lifts/route");
  oneRoute = await import("../app/api/lifts/[key]/route");
  daysRoute = await import("../app/api/athletes/[id]/lifts/route");
});

const req = (body?: unknown, method = "POST") =>
  new Request("http://menu.test/api", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const keyCtx = (key: string) => ({ params: Promise.resolve({ key }) });
const list = async (): Promise<Lift[]> =>
  (await (await menuRoute.GET()).json()) as Lift[];
const find = async (key: string) => (await list()).find((l) => l.key === key);

const logDay = (date: string, lifts: unknown) =>
  daysRoute.POST(req({ date, lifts, notes: "" }), {
    params: Promise.resolve({ id: athleteId }),
  });
const readDays = async () =>
  (await (
    await daysRoute.GET(new Request("http://menu.test/api"), {
      params: Promise.resolve({ id: athleteId }),
    })
  ).json()) as { lifts: Record<string, unknown> }[];

test("a fresh database comes up with the seeded menu", async () => {
  const lifts = await list();
  assert.ok(lifts.length >= 10, `only ${lifts.length} lifts seeded`);
  assert.ok(lifts.some((l) => l.key === "back-squat"));
  assert.equal(lifts.every((l) => !l.archived), true);
});

test("a coach adds a lift and gets a readable key for it", async () => {
  const res = await menuRoute.POST(
    req({ name: "Power clean", group: "Lower body", mode: "load" }),
  );
  // Read the body ONCE: a Response can only be consumed once, so putting
  // `await res.text()` in the assertion message eats it before the parse.
  const made = (await res.json()) as Lift;
  assert.equal(res.status, 201, JSON.stringify(made));
  assert.equal(made.key, "power-clean");
  assert.equal(made.archived, false);
  assert.ok(made.position > 0, "added to the end of the menu");
});

test("an athlete reads the menu but cannot change it", async () => {
  signedInAs = ATHLETE;
  assert.equal((await menuRoute.GET()).status, 200, "they need it to read their own log");
  assert.equal((await menuRoute.POST(req({ name: "Sneaky lift" }))).status, 403);
  assert.equal(
    (await oneRoute.PATCH(req({ name: "Renamed" }, "PATCH"), keyCtx("back-squat")))
      .status,
    403,
  );
  assert.equal(
    (await oneRoute.DELETE(req(undefined, "DELETE"), keyCtx("back-squat"))).status,
    403,
  );
  signedInAs = COACH;
});

test("a nameless lift is refused", async () => {
  assert.equal((await menuRoute.POST(req({ name: "   " }))).status, 400);
  assert.equal((await menuRoute.POST(req({ name: "x".repeat(200) }))).status, 400);
  assert.equal(
    (await menuRoute.POST(req({ name: "Odd one", mode: "banana" }))).status,
    400,
  );
});

/*
 * The property the whole design turns on. A rename changes what the lift is
 * CALLED; the key every set is filed under never moves.
 */
test("renaming a lift keeps its key, and its history with it", async () => {
  await logDay("2026-09-01", { "back-squat": [{ w: 225, r: 5 }] });

  const res = await oneRoute.PATCH(
    req({ name: "Back squat (high bar)" }, "PATCH"),
    keyCtx("back-squat"),
  );
  const renamed = (await res.json()) as Lift;
  assert.equal(res.status, 200, JSON.stringify(renamed));
  assert.equal(renamed.key, "back-squat", "the key did not move");
  assert.equal(renamed.name, "Back squat (high bar)");

  const days = await readDays();
  assert.deepEqual(days[0].lifts, { "back-squat": [{ w: 225, r: 5 }] });
});

/*
 * Changing how a lift is measured re-reads its whole history — a bench press
 * switched to `reps` starts charting reps for every session ever logged. Fine
 * on a lift set up wrong this morning; not fine once there is history.
 */
test("how a lift is measured can be fixed before there is history, not after", async () => {
  const made = (await (
    await menuRoute.POST(req({ name: "Ring row", group: "Pull", mode: "load" }))
  ).json()) as Lift;

  const fixed = await oneRoute.PATCH(req({ mode: "reps" }, "PATCH"), keyCtx(made.key));
  assert.equal(fixed.status, 200, "nothing logged against it yet");
  assert.equal((await find(made.key))!.mode, "reps");

  await logDay("2026-09-02", { [made.key]: [{ w: "", r: 10 }] });

  const refused = await oneRoute.PATCH(
    req({ mode: "load" }, "PATCH"),
    keyCtx(made.key),
  );
  assert.equal(refused.status, 400);
  const { error } = (await refused.json()) as { error: string };
  assert.match(error, /Ring row/, "the message names the lift");
  assert.match(error, /new lift instead/i, "and says what to do about it");
  assert.equal((await find(made.key))!.mode, "reps", "and nothing changed");
});

test("re-sending the same mode on a used lift is not treated as a change", async () => {
  const res = await oneRoute.PATCH(
    req({ name: "Back squat", mode: "load" }, "PATCH"),
    keyCtx("back-squat"),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  assert.equal((await find("back-squat"))!.name, "Back squat");
});

/*
 * Removing archives. The lift leaves the form and the write path in the same
 * action, and every session that used it still reads.
 */
test("removing a lift takes it off the menu and closes its write path", async () => {
  assert.equal(
    (await oneRoute.DELETE(req(undefined, "DELETE"), keyCtx("hip-thrust"))).status,
    200,
  );

  const gone = await find("hip-thrust");
  assert.equal(gone!.archived, true, "archived, not deleted");

  const refused = await logDay("2026-09-03", { "hip-thrust": [{ w: 225, r: 8 }] });
  assert.equal(refused.status, 400, "no longer loggable");

  // And the one with history behind it still reads it back.
  const days = await readDays();
  assert.deepEqual(days[0].lifts, { "back-squat": [{ w: 225, r: 5 }] });
});

test("a lift put back is offered again", async () => {
  assert.equal(
    (await oneRoute.PATCH(req({ archived: false }, "PATCH"), keyCtx("hip-thrust")))
      .status,
    200,
  );
  assert.equal((await find("hip-thrust"))!.archived, false);
  assert.equal(
    (await logDay("2026-09-03", { "hip-thrust": [{ w: 225, r: 8 }] })).status,
    201,
  );
});

test("a lift that was never there is a 404, not a silent success", async () => {
  assert.equal(
    (await oneRoute.PATCH(req({ name: "Nope" }, "PATCH"), keyCtx("no-such-lift")))
      .status,
    404,
  );
  assert.equal(
    (await oneRoute.DELETE(req(undefined, "DELETE"), keyCtx("no-such-lift"))).status,
    404,
  );
});

test("signed out gets a 401 from the menu, not a 403", async () => {
  signedInAs = null;
  assert.equal((await menuRoute.GET()).status, 401);
  assert.equal((await menuRoute.POST(req({ name: "x" }))).status, 401);
  signedInAs = COACH;
});
