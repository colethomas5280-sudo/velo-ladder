import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { PROFILE_FIELDS, visibleProfile } from "@/lib/profile";

/* ------------------------------------------------------------------ *
 * Nothing coach-only reaches the wire
 *
 * `GET /api/athletes` once returned an athlete their own row with
 * `coachNotes` verbatim. It survived six of seven task reviews, and the test
 * written afterwards scanned route SOURCE with a regex — which never matched
 * the route it was written for, and could not have matched a route that
 * copies fields by hand or maps over rows.
 *
 * So this runs the routes instead. It seeds a database, signs in as a real
 * athlete, calls the GET handler of every route under app/api, and reads the
 * response body looking for values that must never appear in one. A route
 * added later is swept without anyone remembering to add it.
 *
 * Limits, stated rather than implied: it sweeps GET only — the historical bug
 * and the bulk of the read surface — and it proves a value is absent, not
 * that authorisation is correct.
 * ------------------------------------------------------------------ */

const COACH_EMAIL = "coach@wire.test";
const ATHLETE_EMAIL = "kid@wire.test";
const OTHER_EMAIL = "other@wire.test";

/* Distinctive enough that a hit is never a coincidence. */
const COACH_NOTE = "SENTINEL-coach-note-6b1f4a";
const OTHER_NOTE = "SENTINEL-other-athlete-note-91cc7d";
const SCREEN_NOTE = "SENTINEL-screen-note-2ae503";
/* An athlete's own lifting note — theirs to read, unlike the screen's. */
const LIFT_NOTE = "SENTINEL-lift-note-4c8e21";
/* Another athlete's. Nobody but them and the coach should ever see it. */
const OTHER_LIFT_NOTE = "SENTINEL-other-lift-note-b73f09";
const PASSWORD = "SENTINEL-password-plain-77d0b2";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-wire-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  // A live PGlite holds the event loop open; leaving it running is what the
  // runner's --test-force-exit was hiding.
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
process.env.COACH_EMAILS = COACH_EMAIL;
process.env.SETUP_KEY = "wire-test-key";

/** Swapped between roles by the sweep; the auth mock reads it each call. */
let signedInAs: string | null = ATHLETE_EMAIL;
/*
 * `exports` is the current option name; @types/node 20 still describes the
 * `namedExports` spelling this runtime deprecates, so the cast is the types
 * lagging rather than a shape being smuggled past them.
 */
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

interface Seeded {
  athleteId: string;
  otherId: string;
  sessionId: string;
  setbackId: string;
  resourceId: string;
  inviteToken: string;
  passwordHash: string;
}

async function seed(): Promise<Seeded> {
  const { execScript, sql } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);

  const data = await import("@/lib/data");
  const athlete = await data.createAthlete({
    name: "Wire Athlete",
    hand: "R",
    inviteEmail: ATHLETE_EMAIL,
    password: PASSWORD,
  });
  const other = await data.createAthlete({
    name: "Other Athlete",
    hand: "L",
    inviteEmail: OTHER_EMAIL,
  });

  await data.updateAthlete(athlete.id, { coachNotes: COACH_NOTE });
  await data.updateAthlete(other.id, { coachNotes: OTHER_NOTE });

  const session = await data.createSession({
    athleteId: athlete.id,
    type: "mound",
    date: "2026-09-01",
    notes: "",
    throws: { m5: [80, 91, 92, 90] },
    createdBy: COACH_EMAIL,
  });
  await data.upsertRecovery(
    athlete.id,
    { date: "2026-09-01", soreness: 3, notes: "" },
    COACH_EMAIL,
  );
  await data.upsertScreen(
    athlete.id,
    { date: "2026-09-01", results: { "hip-45.45-degree-angle:L": "greater" }, notes: SCREEN_NOTE },
    COACH_EMAIL,
  );
  /*
   * A lifting day for each of them. The strength routes carry no coach-only
   * field, so what this buys is the OTHER half of the sweep: a route that
   * answers with an empty list is a route nothing was really run against, and
   * the 500 check below is worth having only on a handler that did some work.
   */
  await data.upsertLiftDay(
    athlete.id,
    { date: "2026-09-01", lifts: { "front-squat": [{ w: 225, r: 5 }] }, notes: LIFT_NOTE },
    COACH_EMAIL,
  );
  await data.upsertLiftDay(
    other.id,
    { date: "2026-09-01", lifts: { "bench": [{ w: 185, r: 5 }] }, notes: OTHER_LIFT_NOTE },
    COACH_EMAIL,
  );
  await sql`
    INSERT INTO setbacks (id, athlete_id, kind, opened_on, detail)
    VALUES ('sb-wire', ${athlete.id}, 'soreness', '2026-09-01', 'sore')
  `;
  await data.createRecipe({
    title: "Wire gainer smoothie",
    calories: 1200,
    proteinG: 60,
    ingredients: ["2 cups whole milk", "1 cup oats"],
    method: "Blend.",
  });
  // One nobody has counted, to prove the difference survives the database.
  await data.createRecipe({ title: "Wire uncounted recipe" });
  const resource = await data.createResource({
    title: "Wire resource",
    body: "body",
    category: "protocol",
  });
  const token = (await data.createInvite(other.id))!;

  const [row] = (await sql`
    SELECT password_hash FROM athletes WHERE id = ${athlete.id}
  `) as { password_hash: string }[];

  return {
    athleteId: athlete.id,
    otherId: other.id,
    sessionId: session.id,
    setbackId: "sb-wire",
    resourceId: resource.id,
    inviteToken: token,
    passwordHash: row.password_hash,
  };
}

/** Every `route.ts` under app/api, recursively. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out.sort();
}

/**
 * What to pass for a route's dynamic segments, decided by the segment ABOVE
 * them — `athletes/[id]` and `sessions/[id]` both spell the param `id` and
 * mean different things.
 *
 * A shape this doesn't recognise throws rather than being skipped. A new
 * route with an unfamiliar parameter should stop the suite and make someone
 * decide what it is, which is the whole point of sweeping automatically.
 */
function paramsFor(file: string, seeded: Seeded): Record<string, string> {
  const parts = relative(join(process.cwd(), "app", "api"), file).split(sep);
  parts.pop(); // route.ts
  const params: Record<string, string> = {};
  parts.forEach((segment, i) => {
    const m = /^\[(?:\.\.\.)?([A-Za-z0-9_]+)\]$/.exec(segment);
    if (!m) return;
    const parent = parts[i - 1];
    const value =
      parent === "athletes"
        ? seeded.athleteId
        : parent === "sessions"
          ? seeded.sessionId
          : parent === "setbacks"
            ? seeded.setbackId
            : parent === "resources"
              ? seeded.resourceId
              : parent === "join"
                ? seeded.inviteToken
                : null;
    if (value === null)
      throw new Error(
        `${file}: don't know what to pass for [${m[1]}] under '${parent}'. ` +
          `Add it to paramsFor so this route gets swept.`,
      );
    params[m[1]] = value;
  });
  return params;
}

/** NextAuth's own handler — not ours, and it serves no athlete data. */
const NOT_OURS = join("auth", "[...nextauth]");

const HIDDEN = PROFILE_FIELDS.filter((f) => !f.athleteCanSee).map((f) => f.key);

test("visibleProfile strips every athleteCanSee:false key for an athlete", () => {
  assert.ok(HIDDEN.includes("coachNotes"), "coachNotes is the key that matters");

  // A row with every column populated, hidden fields included.
  const row: Record<string, unknown> = { id: "a1", name: "Martin Duff", archived: false };
  for (const f of PROFILE_FIELDS) row[f.key] = `value-of-${f.key}`;
  row.coachNotes = "shoulder concern — do not show the kid";

  const seen = visibleProfile(row, false);
  for (const key of HIDDEN)
    assert.equal(key in seen, false, `${key} must be deleted, not blanked`);
  assert.equal(
    JSON.stringify(seen).includes("shoulder concern"),
    false,
    "the note's text is gone from the payload too",
  );

  // The coach still gets everything.
  assert.equal(visibleProfile(row, true).coachNotes, row.coachNotes);
});

/**
 * Call every route's GET as one role and return what each said.
 *
 * A 401/403/404 is a pass — nothing was handed over. What matters is the body
 * of everything that answered.
 */
async function sweep(as: string | null, seeded: Seeded) {
  signedInAs = as;
  const files = routeFiles(join(process.cwd(), "app", "api"));
  const answered: { file: string; status: number; body: string }[] = [];

  for (const file of files) {
    if (file.includes(NOT_OURS)) continue;
    const mod = (await import(file)) as {
      GET?: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
    };
    if (typeof mod.GET !== "function") continue;

    const params = paramsFor(file, seeded);
    const url = new URL("http://wire.test/api");
    const res = await mod.GET(new Request(url), { params: Promise.resolve(params) });
    answered.push({
      file: relative(process.cwd(), file),
      status: res.status,
      body: await res.text(),
    });
  }
  return answered;
}

let seeded: Seeded;
let asAthlete: Awaited<ReturnType<typeof sweep>>;
let asCoach: Awaited<ReturnType<typeof sweep>>;

/** Everything below reads the sweep, so say so when the sweep never ran. */
function swept(): Awaited<ReturnType<typeof sweep>> {
  assert.ok(asAthlete && asCoach, "the sweep didn't run — fix that failure first");
  return [...asAthlete, ...asCoach];
}

test("seed a database and sweep every GET route as each role", async () => {
  seeded = await seed();
  asAthlete = await sweep(ATHLETE_EMAIL, seeded);
  asCoach = await sweep(COACH_EMAIL, seeded);

  /*
   * The guard on the guard. A sweep where every route 403s proves nothing at
   * all, and that is exactly how the test this replaced managed to pass.
   */
  const served = asAthlete.filter((r) => r.status === 200 && r.body.length > 2);
  assert.ok(
    served.length >= 5,
    `only ${served.length} routes served the athlete a body — the sweep isn't reaching anything`,
  );
  assert.ok(
    served.some((r) => r.body.includes("Wire Athlete")),
    "the athlete's own row never came back, so nothing here was really tested",
  );
  /*
   * Recipes are for the athletes, so this one checks the opposite of the rest
   * of the file: that something DID reach them. A route answering with an
   * empty list is a route the sweep never really ran.
   */
  assert.ok(
    served.some((r) => r.body.includes("Wire gainer smoothie")),
    "the recipes route served the athlete nothing",
  );
  /*
   * "Nobody has worked this out" and "zero calories" are different facts, and
   * the page filters on the difference: an uncounted recipe must not turn up
   * as an answer to "what gets me 1000 calories". A `?? 0` in the row mapper
   * would erase that, and until this assertion existed nothing noticed.
   */
  const recipes = served.find((r) => r.file.includes(join("recipes", "route.ts")));
  assert.ok(recipes, "the recipes route did not answer at all");
  const uncounted = (JSON.parse(recipes.body) as { title: string; calories: number | null }[])
    .find((r) => r.title === "Wire uncounted recipe");
  assert.equal(uncounted?.calories, null, "an uncounted recipe is null, not zero");
  /*
   * A route that blows up is a route the sweep did not read, which is the
   * same blind spot as one that 403s — silently untested while counted.
   */
  for (const r of [...asAthlete, ...asCoach])
    assert.notEqual(r.status, 500, `${r.file} threw during the sweep: ${r.body}`);

  if (process.env.WIRE_COVERAGE)
    for (const r of asAthlete)
      console.log(`  ${String(r.status).padEnd(4)} ${r.body.length.toString().padStart(6)}b  ${r.file}`);
});

test("no coach-only note reaches the athlete on any route", () => {
  swept();
  for (const r of asAthlete) {
    assert.equal(
      r.body.includes(COACH_NOTE),
      false,
      `${r.file} (${r.status}) served the athlete their own coachNotes`,
    );
    assert.equal(
      r.body.includes(OTHER_NOTE),
      false,
      `${r.file} (${r.status}) served the athlete another athlete's coachNotes`,
    );
    assert.equal(
      r.body.includes(SCREEN_NOTE),
      false,
      `${r.file} (${r.status}) served the athlete the coach's screen note`,
    );
  }
});

/*
 * These are secrets rather than coach-only fields, so the coach's own
 * responses are held to the same standard. A password hash on the wire is a
 * password hash on the wire whoever asked for it.
 */
test("no password hash or invite token reaches anyone", () => {
  for (const r of swept()) {
    assert.equal(
      r.body.includes(seeded.passwordHash),
      false,
      `${r.file} (${r.status}) put a password hash on the wire`,
    );
    assert.equal(
      r.body.includes(PASSWORD),
      false,
      `${r.file} (${r.status}) put a plaintext password on the wire`,
    );
    assert.equal(
      r.body.includes(seeded.inviteToken),
      false,
      `${r.file} (${r.status}) put a live invite token on the wire`,
    );
  }
});

/*
 * The lifting log is the athlete's own, so their note is theirs to read. What
 * must never travel is somebody else's: the roster route reads every athlete's
 * days to work out records, and the row it builds is the obvious place for a
 * note to ride along by accident.
 */
test("no other athlete's lifting note reaches this athlete", () => {
  swept();
  for (const r of asAthlete)
    assert.equal(
      r.body.includes(OTHER_LIFT_NOTE),
      false,
      `${r.file} (${r.status}) served the athlete another athlete's lifting note`,
    );
});

test("the athlete's own lifting did come back, so the check above means something", () => {
  swept();
  assert.ok(
    asAthlete.some((r) => r.body.includes(LIFT_NOTE)),
    "no route served the athlete their own lifting — the sweep isn't reaching it",
  );
});

test("the coach does still get the notes — the filter isn't just deleting everything", () => {
  swept();
  assert.ok(
    asCoach.some((r) => r.body.includes(COACH_NOTE)),
    "no route served the coach their own note, so the athlete's blank proves nothing",
  );
  assert.ok(
    asCoach.some((r) => r.body.includes(SCREEN_NOTE)),
    "no route served the coach the screen note either",
  );
});
