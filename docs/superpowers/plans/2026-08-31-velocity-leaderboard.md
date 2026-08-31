# Velocity Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A facility record board for throwing velocity, broken out by level, readable by coaches and athletes.

**Architecture:** Boards are computed on read from existing sessions using the app's own `sBestG` / `TRACKERS[...].groups` helpers, so the board can never disagree with an athlete's own PR tile. Band resolution is a pure function: a level stamped on the session wins; otherwise `Youth` subdivides into 12U/14U from the athlete's birth date measured against the session date. A new narrow `GET /api/leaderboard` serves it without touching `canSeeAthlete`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres via `pg` (PGlite locally with `USE_PGLITE=1`), SWR on the client. Tests run on Node's built-in runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-31-velocity-leaderboard-design.md`

## Global Constraints

- Levels stored are exactly `Youth`, `High School`, `College`, `Pro`. **12U and 14U are never stored** — they are derived at read time.
- Age bands are exclusive: **12U is age ≤ 12, 14U is age 13–14**. Age is measured on the **session date**, never today's date.
- A stamped session level always beats an age band.
- `canSeeAthlete` in `lib/scope.ts` must not change. The leaderboard is a separate read path.
- The leaderboard response must never contain athlete IDs, birth dates, invite emails, session contents, or recovery data.
- Archived athletes keep their records and still rank.
- Schema changes bump `SCHEMA_VERSION` in `lib/schema.ts` and are additive (`ADD COLUMN IF NOT EXISTS`). Target for this plan: **v13**.
- Velocities display through `fmt()` — at most one decimal, no trailing `.0`.
- Run `npm run lint` and `npm run build` before each commit. Lint has 8 pre-existing errors in `components/*.tsx`; that count must not increase.

---

### Task 1: Test runner and band resolution

**Files:**
- Modify: `package.json` (add `tsx` devDependency, add `test` script)
- Create: `lib/leaderboard.ts`
- Test: `lib/leaderboard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const LEVELS: readonly ["Youth", "High School", "College", "Pro"]
  export type Level = (typeof LEVELS)[number]
  export type Band = "12U" | "14U" | "High School" | "College" | "Pro"
  export const BANDS: Band[]
  export interface LeaderboardAthlete {
    id: string; name: string; hand: string;
    birthDate: string | null;   // "YYYY-MM-DD"
    level: Level | null;
  }
  export function ageOn(birthDate: string, onDate: string): number
  export function bandForSession(
    athlete: LeaderboardAthlete, sessionLevel: string | null, sessionDate: string,
  ): Band | null
  ```

- [ ] **Step 1: Add the test runner**

The project has no test framework. Node's built-in runner plus `tsx` handles the `@/lib/...` path aliases with one devDependency.

```bash
npm i -D tsx
```

Then add to `package.json` `scripts`:

```json
"test": "node --import tsx --test \"lib/**/*.test.ts\""
```

- [ ] **Step 2: Write the failing test**

Create `lib/leaderboard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, bandForSession, type LeaderboardAthlete } from "@/lib/leaderboard";

const athlete = (over: Partial<LeaderboardAthlete> = {}): LeaderboardAthlete => ({
  id: "a1", name: "Test Athlete", hand: "R",
  birthDate: null, level: null, ...over,
});

test("ageOn counts a birthday that has not happened yet", () => {
  assert.equal(ageOn("2012-06-15", "2026-06-14"), 13);
  assert.equal(ageOn("2012-06-15", "2026-06-15"), 14);
  assert.equal(ageOn("2012-06-15", "2026-12-01"), 14);
});

test("a stamped level maps straight to its band", () => {
  const a = athlete({ birthDate: "2012-06-15" });
  assert.equal(bandForSession(a, "High School", "2026-08-01"), "High School");
  assert.equal(bandForSession(a, "College", "2026-08-01"), "College");
  assert.equal(bandForSession(a, "Pro", "2026-08-01"), "Pro");
});

test("a stamped level beats the age band", () => {
  // 13 on this date, so 14U by age — but he trains with the high schoolers
  const a = athlete({ birthDate: "2013-01-01" });
  assert.equal(bandForSession(a, "High School", "2026-08-01"), "High School");
});

test("Youth subdivides by age on the day of the throw", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  assert.equal(bandForSession(a, "Youth", "2026-04-01"), "12U"); // still 12
  assert.equal(bandForSession(a, "Youth", "2026-07-01"), "14U"); // turned 13
});

test("a throw made at 12 stays 12U after the birthday", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  // the same session, resolved again years later, is still 12U
  assert.equal(bandForSession(a, "Youth", "2026-04-01"), "12U");
});

test("Youth with no birth date, or aged out, is facility-only", () => {
  assert.equal(bandForSession(athlete(), "Youth", "2026-08-01"), null);
  const old = athlete({ birthDate: "2009-01-01" }); // 17
  assert.equal(bandForSession(old, "Youth", "2026-08-01"), null);
});

test("no stamped level is facility-only", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  assert.equal(bandForSession(a, null, "2026-08-01"), null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/leaderboard'`

- [ ] **Step 4: Write the implementation**

Create `lib/leaderboard.ts`:

```ts
/* ------------------------------------------------------------------ *
 * Leaderboard bands
 *
 * A record keeps the band it was set at. That is the whole point of a
 * record board — a 14U record set at 14 stays a 14U record after the
 * athlete ages up, or the youth boards empty out as kids grow.
 *
 * Two mechanisms, each correct on its own terms. The upper levels are
 * program decisions, so they are stamped onto the session at save time.
 * The youth split is a fact about age, so it is derived from the birth
 * date against the SESSION date — never today's — which means entering a
 * birth date retroactively makes an athlete's whole history correct with
 * no backfill.
 * ------------------------------------------------------------------ */

/** The four values that are actually stored on an athlete or a session. */
export const LEVELS = ["Youth", "High School", "College", "Pro"] as const;
export type Level = (typeof LEVELS)[number];

/** Boards. 12U and 14U are derived at read time and never stored. */
export type Band = "12U" | "14U" | "High School" | "College" | "Pro";
export const BANDS: Band[] = ["12U", "14U", "High School", "College", "Pro"];

export interface LeaderboardAthlete {
  id: string;
  name: string;
  hand: string;
  /** "YYYY-MM-DD"; coach-visible only, never sent to the client */
  birthDate: string | null;
  level: Level | null;
}

/** Whole years old on `onDate`, counting a birthday that hasn't landed yet. */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

/**
 * Which board one session belongs to, or null for facility-only.
 * Order matters: a stamped level is an override and always wins.
 */
export function bandForSession(
  athlete: LeaderboardAthlete,
  sessionLevel: string | null,
  sessionDate: string,
): Band | null {
  if (
    sessionLevel === "High School" ||
    sessionLevel === "College" ||
    sessionLevel === "Pro"
  )
    return sessionLevel;

  if (sessionLevel === "Youth") {
    if (!athlete.birthDate) return null;
    const age = ageOn(athlete.birthDate, sessionDate);
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    return null; // 15+ still marked Youth: facility board only
  }

  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/leaderboard.ts lib/leaderboard.test.ts
git commit -m "Add band resolution for the velocity leaderboard

A record keeps the band it was set at. Upper levels are program
decisions and get stamped on the session; the youth split is a fact
about age, derived from the birth date against the session date so
entering a birth date makes an athlete's whole history correct at once.

Adds Node's built-in test runner via tsx — the project had none."
```

---

### Task 2: Ranking

**Files:**
- Modify: `lib/leaderboard.ts`
- Modify: `lib/types.ts` (add `level` to `TrainingSession`)
- Test: `lib/leaderboard.test.ts`

**Interfaces:**
- Consumes: `bandForSession`, `LeaderboardAthlete`, `Band`, `BANDS` from Task 1.
- Produces:
  ```ts
  export interface BoardRow {
    rank: number; name: string; band: Band | null;
    hand: string; velocity: number; date: string; isYou: boolean;
  }
  export interface Board {
    key: "facility" | Band;
    title: string;
    rows: BoardRow[];
    you: { rank: number; velocity: number } | null;
  }
  export const FACILITY_LIMIT = 10
  export const BAND_LIMIT = 5
  export function buildBoards(
    athletes: LeaderboardAthlete[], sessions: TrainingSession[],
    tracker: TrackerId, oz: number, viewerAthleteIds: string[],
  ): Board[]
  ```

- [ ] **Step 1: Add `level` to the session type and read it**

In `lib/types.ts`, inside `interface TrainingSession`, add:

```ts
  /** level stamped at save time; null for sessions logged before levels existed */
  level: string | null;
```

And in `lib/data.ts`, add the matching line to `toSession` so the build stays green —
the column does not exist yet, so this reads `null` until Task 3 adds it:

```ts
    level: (r.level as string | null) ?? null,
```

- [ ] **Step 2: Write the failing test**

Extend the **existing** import at the top of `lib/leaderboard.test.ts` to include
`buildBoards` — do not add a second import from the same module — and add the type
import:

```ts
// top of file: import { ageOn, bandForSession, buildBoards, type LeaderboardAthlete } from "@/lib/leaderboard";
import type { TrainingSession } from "@/lib/types";

// p1 and p4 are the two pull-down 5 oz slots; index 0 is the 80% primer.
const session = (
  athleteId: string, date: string, level: string | null,
  throws: Record<string, (number | null)[]>,
): TrainingSession =>
  ({ id: date + athleteId, athleteId, type: "pulldown", date, notes: "",
     level, throws } as unknown as TrainingSession);

test("ranks one row per athlete, using their best throw", () => {
  const athletes = [
    athlete({ id: "a", name: "Ann", level: "College" }),
    athlete({ id: "b", name: "Bo", level: "College" }),
  ];
  const sessions = [
    session("a", "2026-08-01", "College", { p1: [80, 90, 91, null, null] }),
    session("a", "2026-08-08", "College", { p1: [80, 95, 93, null, null] }),
    session("b", "2026-08-02", "College", { p1: [80, 94, null, null, null] }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.key, "facility");
  assert.deepEqual(
    facility.rows.map((r) => [r.rank, r.name, r.velocity]),
    [[1, "Ann", 95], [2, "Bo", 94]],
  );
});

test("the 80% primer never places", () => {
  const athletes = [athlete({ id: "a", name: "Ann", level: "College" })];
  // 99 sits in box 0 — the primer — and must be ignored
  const sessions = [session("a", "2026-08-01", "College", { p1: [99, 88, null, null, null] })];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.rows[0].velocity, 88);
});

test("both 5 oz sets fold into one record", () => {
  const athletes = [athlete({ id: "a", name: "Ann", level: "College" })];
  // p1 is the opener, p4 the second 5 oz set; the best of both is the record
  const sessions = [
    session("a", "2026-08-01", "College", {
      p1: [80, 90, null, null, null],
      p4: [80, 96, null, null, null],
    }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.rows.length, 1);
  assert.equal(facility.rows[0].velocity, 96);
});

test("band boards use the athlete's best within that band", () => {
  const a = athlete({ id: "a", name: "Ann", birthDate: "2013-06-15", level: "Youth" });
  const sessions = [
    session("a", "2026-04-01", "Youth", { p1: [80, 70, null, null, null] }), // 12U
    session("a", "2026-07-01", "Youth", { p1: [80, 78, null, null, null] }), // 14U
  ];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  const byKey = Object.fromEntries(boards.map((b) => [b.key, b]));
  assert.equal(byKey["facility"].rows[0].velocity, 78);
  assert.equal(byKey["12U"].rows[0].velocity, 70);
  assert.equal(byKey["14U"].rows[0].velocity, 78);
});

test("an athlete with no level or birth date reaches only the facility board", () => {
  const a = athlete({ id: "a", name: "Ann" });
  const sessions = [session("a", "2026-08-01", null, { p1: [80, 91, null, null, null] })];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  assert.deepEqual(boards.map((b) => b.key), ["facility"]);
});

test("empty boards are omitted", () => {
  const a = athlete({ id: "a", name: "Ann", level: "Pro" });
  const sessions = [session("a", "2026-08-01", "Pro", { p1: [80, 97, null, null, null] })];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  assert.deepEqual(boards.map((b) => b.key), ["facility", "Pro"]);
});

test("ties break toward whoever got there first", () => {
  const athletes = [
    athlete({ id: "a", name: "Ann", level: "Pro" }),
    athlete({ id: "b", name: "Bo", level: "Pro" }),
  ];
  const sessions = [
    session("b", "2026-08-09", "Pro", { p1: [80, 92, null, null, null] }),
    session("a", "2026-08-01", "Pro", { p1: [80, 92, null, null, null] }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.deepEqual(facility.rows.map((r) => r.name), ["Ann", "Bo"]);
});

test("the viewer is marked, and gets a standing when off the board", () => {
  const athletes = Array.from({ length: 12 }, (_, i) =>
    athlete({ id: "x" + i, name: "P" + i, level: "Pro" }));
  const sessions = athletes.map((a, i) =>
    session(a.id, "2026-08-01", "Pro", { p1: [80, 100 - i, null, null, null] }));
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, ["x11"]);
  assert.equal(facility.rows.length, 10);            // facility caps at 10
  assert.equal(facility.you?.rank, 12);              // 12th, so off the board
  assert.equal(facility.you?.velocity, 89);

  const [top] = buildBoards(athletes, sessions, "pulldown", 5, ["x0"]);
  assert.equal(top.rows[0].isYou, true);
  assert.equal(top.you, null);                       // already visible
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildBoards is not a function`

- [ ] **Step 4: Write the implementation**

Append to `lib/leaderboard.ts` (add the imports at the top of the file):

```ts
import type { TrainingSession, TrackerId } from "./types";
import { TRACKERS, sBestG } from "./velo";

export interface BoardRow {
  rank: number;
  name: string;
  band: Band | null;
  hand: string;
  velocity: number;
  date: string;
  isYou: boolean;
}

export interface Board {
  key: "facility" | Band;
  title: string;
  rows: BoardRow[];
  /** the viewer's standing when they rank below the visible rows */
  you: { rank: number; velocity: number } | null;
}

export const FACILITY_LIMIT = 10;
export const BAND_LIMIT = 5;

interface Mark {
  athleteId: string;
  name: string;
  hand: string;
  band: Band | null;
  velocity: number;
  date: string;
}

/**
 * One row per athlete — their single best mark, not one row per session.
 * Without this, one athlete having a big day takes four of the top five
 * slots and it stops being a leaderboard. Ties go to whoever set it first.
 */
function rank(
  marks: Mark[],
  limit: number,
  viewer: Set<string>,
): Pick<Board, "rows" | "you"> {
  const best = new Map<string, Mark>();
  for (const m of marks) {
    const cur = best.get(m.athleteId);
    if (
      !cur ||
      m.velocity > cur.velocity ||
      (m.velocity === cur.velocity && m.date < cur.date)
    )
      best.set(m.athleteId, m);
  }

  const ranked = [...best.values()].sort(
    (a, b) => b.velocity - a.velocity || (a.date < b.date ? -1 : 1),
  );

  const rows: BoardRow[] = ranked.slice(0, limit).map((m, i) => ({
    rank: i + 1,
    name: m.name,
    band: m.band,
    hand: m.hand,
    velocity: m.velocity,
    date: m.date,
    isYou: viewer.has(m.athleteId),
  }));

  const idx = ranked.findIndex((m) => viewer.has(m.athleteId));
  const you =
    idx >= limit ? { rank: idx + 1, velocity: ranked[idx].velocity } : null;

  return { rows, you };
}

/**
 * Boards for one tracker and weight. Reads velocities through `sBestG` and
 * the tracker's own `groups`, which is what guarantees a board number can
 * never disagree with the athlete's own PR tile: the primer rule and the
 * combined-5oz rule live in exactly one place.
 */
export function buildBoards(
  athletes: LeaderboardAthlete[],
  sessions: TrainingSession[],
  tracker: TrackerId,
  oz: number,
  viewerAthleteIds: string[],
): Board[] {
  const group = TRACKERS[tracker].groups.find((g) => g.oz === oz);
  if (!group) return [];

  const byId = new Map(athletes.map((a) => [a.id, a]));
  const viewer = new Set(viewerAthleteIds);
  const marks: Mark[] = [];

  for (const s of sessions) {
    if (s.type !== tracker) continue;
    const a = byId.get(s.athleteId);
    if (!a) continue;
    const velocity = sBestG(s, group.keys);
    if (velocity == null) continue;
    marks.push({
      athleteId: a.id,
      name: a.name,
      hand: a.hand,
      band: bandForSession(a, s.level, s.date),
      velocity,
      date: s.date,
    });
  }

  const boards: Board[] = [];
  const facility = rank(marks, FACILITY_LIMIT, viewer);
  if (facility.rows.length)
    boards.push({ key: "facility", title: "Facility record", ...facility });

  for (const band of BANDS) {
    const inBand = marks.filter((m) => m.band === band);
    if (!inBand.length) continue;
    boards.push({ key: band, title: band, ...rank(inBand, BAND_LIMIT, viewer) });
  }

  return boards;
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS, 15 tests, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/leaderboard.ts lib/leaderboard.test.ts lib/types.ts lib/data.ts
git commit -m "Rank leaderboard marks, one row per athlete

Reads velocities through sBestG and the tracker's own groups rather
than reimplementing them, so a board number can never disagree with the
athlete's own PR tile — the primer rule and the combined-5oz rule stay
in one place.

One row per athlete, not per session, or one big day takes four of the
top five slots. Ties go to whoever set the mark first."
```

---

### Task 3: Schema v13 and the data layer

**Files:**
- Modify: `lib/schema.ts` (bump to 13, three `ADD COLUMN` statements)
- Modify: `lib/types.ts` (`Athlete` gains `birthDate`, `level`)
- Modify: `lib/data.ts` (`toAthlete`, `toSession`, `updateAthlete`, `createSession`, new `listLeaderboardData`)
- Modify: `db/schema.sql` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `Level` from Task 1.
- Produces:
  ```ts
  // lib/data.ts
  export async function listLeaderboardData(): Promise<{
    athletes: LeaderboardAthlete[];
    sessions: TrainingSession[];
  }>
  // updateAthlete's patch gains: level?: Level | null; birthDate?: string | null
  // createSession stamps training_sessions.level from the athlete's current level
  ```

- [ ] **Step 1: Add the columns**

In `lib/schema.ts`, change `SCHEMA_VERSION` to `13`. Add after the existing `ALTER TABLE athletes` block:

```sql
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS level text;
```

- [ ] **Step 2: Extend the types**

In `lib/types.ts`, add to `interface Athlete`:

```ts
  /** "YYYY-MM-DD"; coach-visible only, never sent to the leaderboard */
  birthDate: string | null;
  /** Youth | High School | College | Pro */
  level: string | null;
```

- [ ] **Step 3: Read and write the new columns**

In `lib/data.ts`:

`toAthlete` gains:
```ts
    birthDate: r.birth_date ? isoDate(r.birth_date) : null,
    level: (r.level as string | null) ?? null,
```

`updateAthlete`'s `patch` parameter gains `level?: string | null;` and `birthDate?: string | null;`, resolved like the existing fields:
```ts
  const level = patch.level === undefined ? cur.level : patch.level;
  const birthDate =
    patch.birthDate === undefined ? cur.birthDate : patch.birthDate || null;
```
and both `UPDATE athletes SET ...` statements gain `level = ${level}, birth_date = ${birthDate}`.

Add this helper to `lib/data.ts` — Task 5 calls it too, so it lives in one place:

```ts
/*
 * Backfill the stamp, once. Sessions that already carry a level are never
 * rewritten, so moving an athlete from Youth to High School leaves his old
 * marks where they were and only new sessions get the new level.
 */
export async function stampUnleveledSessions(
  athleteId: string,
  level: string | null,
): Promise<void> {
  if (!level) return;
  await sql`
    UPDATE training_sessions SET level = ${level}
    WHERE athlete_id = ${athleteId} AND level IS NULL
  `;
}
```

and call it after a successful `updateAthlete`:

```ts
  await stampUnleveledSessions(id, level);
```

`createSession` stamps the athlete's current level at save time. Add before the INSERT:
```ts
  const athlete = await getAthlete(input.athleteId);
  const level = athlete?.level ?? null;
```
and add `level` to the INSERT column list and `${level}` to its values.

- [ ] **Step 4: Add the leaderboard read**

Append to `lib/data.ts`:

```ts
/**
 * Everything the leaderboard needs, and nothing else. Archived athletes are
 * included on purpose: a departing athlete should not wipe a facility record
 * he set.
 */
export async function listLeaderboardData(): Promise<{
  athletes: LeaderboardAthlete[];
  sessions: TrainingSession[];
}> {
  const [aRows, sRows] = await Promise.all([
    sql`SELECT id, name, hand, birth_date, level FROM athletes`,
    sql`SELECT * FROM training_sessions`,
  ]);
  return {
    athletes: (aRows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      hand: (r.hand as string) || "",
      birthDate: r.birth_date ? isoDate(r.birth_date) : null,
      level: (r.level as LeaderboardAthlete["level"]) ?? null,
    })),
    sessions: (sRows as Record<string, unknown>[]).map(toSession),
  };
}
```

Add `import type { LeaderboardAthlete } from "./leaderboard";` at the top.

- [ ] **Step 5: Verify against a real database**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
pkill -f "next dev"; rm -rf .pglite-data
npm run dev > /tmp/velo-dev.log 2>&1 &
sleep 9
curl -s "http://localhost:3000/api/setup?key=dev-setup-key&seed=1"
```

Expected: `"schemaVersion":13` and `"missing":[]`.

- [ ] **Step 6: Regenerate the checked-in schema**

```bash
npx tsx -e 'import {SCHEMA_SQL,SCHEMA_VERSION} from "./lib/schema"; import {writeFileSync} from "fs";
writeFileSync("db/schema.sql", `-- Generated from lib/schema.ts (SCHEMA_VERSION ${SCHEMA_VERSION}). Do not edit by hand.\n-- Applied by GET /api/setup?key=SETUP_KEY\n${SCHEMA_SQL}`);'
```

- [ ] **Step 7: Check types, lint and build**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: no type errors, 15 tests pass, lint still reports 8 errors (not 9+), build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/schema.ts lib/types.ts lib/data.ts db/schema.sql
git commit -m "Schema v13: birth date and level

Sessions carry the level they were saved at, so a record keeps its band
after the athlete moves up. Setting a level backfills that athlete's
unstamped sessions once; already-stamped sessions are never rewritten.

listLeaderboardData includes archived athletes on purpose — a departing
athlete should not wipe a facility record he set."
```

---

### Task 4: The API route

**Files:**
- Create: `app/api/leaderboard/route.ts`

**Interfaces:**
- Consumes: `buildBoards`, `Board` (Task 2); `listLeaderboardData` (Task 3); `getScope` from `lib/scope.ts`; `json`, `unauthorized`, `forbidden`, `badRequest`, `guard` from `lib/http.ts`.
- Produces: `GET /api/leaderboard?tracker=…&oz=…` returning `Board[]`.

- [ ] **Step 1: Write the route**

Create `app/api/leaderboard/route.ts`:

```ts
import { getScope } from "@/lib/scope";
import { listLeaderboardData } from "@/lib/data";
import { buildBoards } from "@/lib/leaderboard";
import { TRACKER_IDS } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one cross-athlete read in the app. It deliberately does NOT relax
 * `canSeeAthlete` — an athlete still cannot open anyone else's page. This
 * returns only what a record board needs: name, band, hand, velocity, date.
 * Never athlete IDs, birth dates, invite emails, or session contents.
 */
export async function GET(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role === "none") return forbidden();

  const url = new URL(request.url);
  const tracker = (url.searchParams.get("tracker") ?? "mound") as TrackerId;
  const ozRaw = url.searchParams.get("oz") ?? "5";
  const oz = Number(ozRaw);

  // Fail loudly rather than quietly showing the wrong board.
  if (!TRACKER_IDS.includes(tracker))
    return badRequest("tracker must be mound or pulldown");
  if (![5, 6, 7, 4, 3].includes(oz)) return badRequest("oz must be 5, 6, 7, 4 or 3");

  return guard(async () => {
    const { athletes, sessions } = await listLeaderboardData();
    return json(buildBoards(athletes, sessions, tracker, oz, scope.athleteIds));
  }, "Loading the leaderboard failed");
}
```

- [ ] **Step 2: Verify it end to end**

With the dev server running and seeded:

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
node --input-type=module -e '
const B="http://localhost:3000";
function jar(){let c={};return{get:()=>Object.entries(c).map(([k,v])=>k+"="+v).join("; "),absorb:r=>{for(const s of (r.headers.getSetCookie?.()||[])){const p=s.split(";")[0],i=p.indexOf("=");c[p.slice(0,i)]=p.slice(i+1)}}}}
const j=jar();let r=await fetch(B+"/api/auth/csrf",{headers:{cookie:j.get()}});j.absorb(r);const{csrfToken}=await r.json();
r=await fetch(B+"/api/auth/callback/credentials",{method:"POST",headers:{cookie:j.get(),"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken,email:"coach@test.com",password:"coachpass123"}),redirect:"manual"});j.absorb(r);
const H={cookie:j.get()};
const res = await fetch(B+"/api/leaderboard?tracker=pulldown&oz=5",{headers:H});
const body = await res.text();
console.log(res.status, body.slice(0,400));
console.log("leaks an id?", /"athleteId"|"id":/.test(body));
console.log("leaks a birth date?", /birthDate|birth_date/.test(body));
const bad = await fetch(B+"/api/leaderboard?tracker=bogus",{headers:H});
console.log("bad tracker ->", bad.status, await bad.text());

// Archived athletes must keep their records. Use a throwaway athlete: the PATCH
// route refuses any request against an archived athlete, so this is one-way.
const J = {...H, "content-type":"application/json"};
const tmp = await (await fetch(B+"/api/athletes",{method:"POST",headers:J,body:JSON.stringify({name:"Archive Test",inviteEmail:"arch@t.com",password:"pw123456"})})).json();
await fetch(B+"/api/athletes/"+tmp.id+"/sessions",{method:"POST",headers:J,body:JSON.stringify({type:"pulldown",date:"2026-08-30",notes:"",throws:{p1:[80,120,null,null,null]}})});
const on = await (await fetch(B+"/api/leaderboard?tracker=pulldown&oz=5",{headers:H})).json();
console.log("ranks before archiving?", on[0].rows.some(r => r.name === "Archive Test"));
await fetch(B+"/api/athletes/"+tmp.id,{method:"PATCH",headers:J,body:JSON.stringify({archived:true})});
const off = await (await fetch(B+"/api/leaderboard?tracker=pulldown&oz=5",{headers:H})).json();
console.log("still ranks after archiving?", off[0].rows.some(r => r.name === "Archive Test"));
'
```

Expected: `200` with a `facility` board containing the seeded Martin Duff pull-down; both leak checks `false`; the bad tracker returns `400`; both archived checks print `true`.

- [ ] **Step 3: Commit**

```bash
git add app/api/leaderboard/route.ts
git commit -m "Add GET /api/leaderboard

The app's one cross-athlete read, and deliberately narrow: it does not
relax canSeeAthlete, and returns only name, band, hand, velocity and
date. Never IDs, birth dates, emails or session contents.

Unrecognised tracker or weight is a 400 rather than a silent fallback,
so a broken link fails loudly instead of showing the wrong board."
```

---

### Task 5: Collecting level and birth date

**Files:**
- Modify: `components/JoinForm.tsx` (level picker + birth date on signup)
- Modify: `app/api/join/[token]/route.ts` (accept and validate them)
- Modify: `lib/data.ts` (`consumeInvite` stores them)
- Modify: `app/api/athletes/[id]/route.ts` (coach PATCH accepts `level`, `birthDate`)
- Modify: `components/RosterView.tsx` (coach can set both)

**Interfaces:**
- Consumes: `LEVELS`, `Level` (Task 1); `updateAthlete` patch fields (Task 3).
- Produces: `consumeInvite(token, password, level, birthDate)`.

- [ ] **Step 1: Accept the fields on signup**

`consumeInvite` in `lib/data.ts` takes two more parameters and writes them:

```ts
export async function consumeInvite(
  token: string,
  password: string,
  level: string | null,
  birthDate: string | null,
): Promise<InviteTarget | null> {
```
Add `level = ${level}, birth_date = ${birthDate}` to its `SET` clause. After the update
succeeds, call the helper Task 3 added — do not re-write the SQL:

```ts
  if (r) await stampUnleveledSessions(String(r.id), level);
```

- [ ] **Step 2: Validate them at the route**

In `app/api/join/[token]/route.ts`, read `level` and `birthDate` from the body:

```ts
  const level = LEVELS.includes(body.level as Level) ? (body.level as Level) : null;
  const birthDate =
    typeof body.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)
      ? body.birthDate
      : null;
```
Import `LEVELS` and `Level` from `@/lib/leaderboard`. Pass both to `consumeInvite`. Both stay optional — an athlete who skips them still gets an account.

- [ ] **Step 3: Add the inputs to the signup form**

In `components/JoinForm.tsx`, add two pieces of state and two fields above the password inputs, following the existing `.field` markup:

```tsx
const [level, setLevel] = useState("");
const [birthDate, setBirthDate] = useState("");
```

```tsx
<label className="field">
  <span>Your level</span>
  <select value={level} onChange={(e) => setLevel(e.target.value)}>
    <option value="">Choose…</option>
    {LEVELS.map((l) => (
      <option key={l} value={l}>{l}</option>
    ))}
  </select>
</label>
<label className="field">
  <span>Date of birth</span>
  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
</label>
```

Send `level: level || null` and `birthDate: birthDate || null` in the existing POST body.

- [ ] **Step 4: Let coaches set both**

In `app/api/athletes/[id]/route.ts`, inside the `scope.role === "coach"` branch of `PATCH`, add to the `updateAthlete` call:

```ts
      level:
        body.level === undefined
          ? undefined
          : LEVELS.includes(body.level as Level)
            ? (body.level as Level)
            : null,
      birthDate:
        body.birthDate === undefined
          ? undefined
          : typeof body.birthDate === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)
            ? body.birthDate
            : null,
```

Leave the athlete branch alone — an athlete still may change only their own hand and password. Their level is declared once at signup; corrections are a coach action.

In `components/RosterView.tsx`, add two controls to the per-athlete edit row, alongside
the existing hand `<select>` and saving through the same PATCH call it already uses:

```tsx
<select
  className="tin"
  aria-label={`${a.name} level`}
  value={a.level ?? ""}
  onChange={(e) => save(a.id, { level: e.target.value || null })}
>
  <option value="">No level</option>
  {LEVELS.map((l) => (
    <option key={l} value={l}>{l}</option>
  ))}
</select>
<input
  className="tin"
  type="date"
  aria-label={`${a.name} date of birth`}
  value={a.birthDate ?? ""}
  onChange={(e) => save(a.id, { birthDate: e.target.value || null })}
/>
```

`save` is the component's existing PATCH helper; match its real name when you get there.
Import `LEVELS` from `@/lib/leaderboard`.

- [ ] **Step 5: Verify the round trip**

Restart the dev server, sign in as coach, PATCH an athlete with a level and birth date, and confirm both persist and the athlete's existing sessions were stamped:

```bash
curl -s "http://localhost:3000/api/setup?key=dev-setup-key&seed=1" > /dev/null
# then, with a coach cookie, PATCH /api/athletes/seed-md {"level":"High School","birthDate":"2009-04-02"}
# and GET /api/leaderboard?tracker=pulldown&oz=5 — Martin Duff should now appear
# on both the facility board and a "High School" board
```

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`

```bash
git add components/JoinForm.tsx "app/api/join/[token]/route.ts" lib/data.ts "app/api/athletes/[id]/route.ts" components/RosterView.tsx
git commit -m "Collect level and birth date

Athletes declare their level when they set their password; coaches can
set or correct both afterwards. Both optional, so an athlete who skips
them still gets an account and still counts toward the facility board.

An athlete may still change only their own hand and password — level
corrections are a coach action."
```

---

### Task 6: The leaderboard page

**Files:**
- Create: `app/leaderboard/page.tsx`
- Create: `components/Leaderboard.tsx`
- Modify: `components/AppHeader.tsx` (nav entry for both roles)
- Modify: `app/globals.css` (board styles)

**Interfaces:**
- Consumes: `Board`, `BoardRow` (Task 2); `GET /api/leaderboard` (Task 4); `fetcher` from `lib/fetcher.ts`; `fmt`, `fmtDate`, `TRACKERS`, `TRACKER_IDS` from `lib/velo.ts`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the nav entry**

In `components/AppHeader.tsx`, add `{ href: "/leaderboard", label: "Leaderboard" }` to **both** the coach list and the athlete list.

- [ ] **Step 2: Build the component**

Create `components/Leaderboard.tsx`. The `seg` toggle and `chip` markup are copied from
`AthleteProfile` and `ProgressChart` so athletes meet controls they already know.

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, ApiError } from "@/lib/fetcher";
import { TRACKERS, TRACKER_IDS, fmt, fmtDate } from "@/lib/velo";
import type { TrackerId } from "@/lib/types";
import type { Board } from "@/lib/leaderboard";

const OZ = [5, 6, 7, 4, 3]; // ladder order, not numeric

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export default function Leaderboard() {
  const [tracker, setTracker] = useState<TrackerId>("mound");
  const [oz, setOz] = useState(5);

  const { data, error, isLoading } = useSWR<Board[]>(
    `/api/leaderboard?tracker=${tracker}&oz=${oz}`,
    fetcher,
  );

  return (
    <div className="lb">
      <div className="view-switch">
        <span className="eyebrow">Records</span>
        <div className="seg" role="group" aria-label="Tracker">
          {TRACKER_IDS.map((t) => (
            <button key={t} aria-pressed={tracker === t} onClick={() => setTracker(t)}>
              {TRACKERS[t].label}
            </button>
          ))}
        </div>
      </div>

      <div className="chips">
        {OZ.map((w) => (
          <button key={w} className="chip" aria-pressed={w === oz} onClick={() => setOz(w)}>
            {w} oz
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error instanceof ApiError ? error.message : "Couldn't load the leaderboard."}
        </p>
      )}

      {isLoading && <p className="widget-empty">Loading…</p>}

      {!isLoading && !error && !data?.length && (
        <p className="widget-empty">
          No 100% throws logged at this weight yet. Records show up here as soon as
          someone logs a session.
        </p>
      )}

      {data?.map((board) => (
        <section className="card pad lb-board" key={board.key}>
          <div className="sec-h">
            <h3>{board.title}</h3>
            <span className="sub">
              {TRACKERS[tracker].label} · {oz} oz
            </span>
          </div>

          <div className="lb-scroll">
            <table className="lb-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Athlete</th>
                  <th scope="col">Level</th>
                  <th scope="col">Hand</th>
                  <th scope="col">Velo</th>
                  <th scope="col">Set</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r) => (
                  <tr key={r.rank} className={r.isYou ? "is-you" : undefined}>
                    <td className="lb-rank">{r.rank}</td>
                    <td>
                      {r.name}
                      {r.isYou && <span className="lb-you">you</span>}
                    </td>
                    <td className="lb-dim">{r.band ?? "–"}</td>
                    <td className="lb-dim">{r.hand || "–"}</td>
                    <td className="lb-velo">{fmt(r.velocity)}</td>
                    <td className="lb-dim">{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {board.you && (
            <p className="lb-standing">
              You&apos;re {ordinal(board.you.rank)} — <b>{fmt(board.you.velocity)}</b>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add the page**

Create `app/leaderboard/page.tsx`:

```tsx
import Leaderboard from "@/components/Leaderboard";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return <Leaderboard />;
}
```

- [ ] **Step 4: Style it**

Append to `app/globals.css`. Tokens only — no literal colours, so both themes work:

```css
.lb-board { margin-top: 14px; }
.lb-scroll { overflow-x: auto; }
.lb-table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.lb-table th {
  text-align: left;
  font-family: var(--font-mono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--ink-faint);
  font-weight: 600;
  padding: 0 12px 7px 0;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.lb-table td {
  padding: 9px 12px 9px 0;
  border-bottom: 1px solid var(--line-soft);
}
.lb-rank {
  font-family: var(--font-display), sans-serif;
  font-size: 19px;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
  width: 1%;
}
.lb-velo {
  font-family: var(--font-display), sans-serif;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lb-dim { color: var(--ink-dim); white-space: nowrap; }
/* Marked by background and a label, never colour alone. */
.lb-table tr.is-you td { background: var(--accent-soft); }
.lb-you {
  font-family: var(--font-mono), monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  margin-left: 7px;
}
.lb-standing {
  margin: 10px 0 0;
  font-size: 13.5px;
  color: var(--ink-dim);
  border-top: 1px solid var(--line-soft);
  padding-top: 10px;
}
```

- [ ] **Step 5: Verify in a browser**

Run the dev server, seed, set levels and birth dates on two or three athletes, log a session for each, then open `/leaderboard`:

- the facility board lists one row per athlete, best first
- switching tracker and weight chips changes the board
- a signed-in athlete sees their own row highlighted
- an athlete ranked outside the visible rows sees their standing beneath
- confirm the number on the board matches that athlete's own PR tile on their page

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`

```bash
git add app/leaderboard components/Leaderboard.tsx components/AppHeader.tsx app/globals.css
git commit -m "Add the leaderboard page

Facility board plus one per level, filtered by the same tracker toggle
and weight chips used on the Progress chart so athletes meet controls
they already know.

An athlete outside the visible rows still sees their own standing, so
the page means something to everyone reading it and not only the top
five."
```

---

### Task 7: Documentation

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Document it**

Add a `## Leaderboard` section to `HANDOFF.md` covering: the two-mechanism band model and why (stamped level for program decisions, derived age for the youth split); that 12U/14U are never stored; that age resolves against the session date so birth dates need no backfill; the one-time stamp on first level set and its limitation; that `canSeeAthlete` is untouched and what the response deliberately excludes; and that archived athletes keep their records.

Add `athletes.birth_date`, `athletes.level` and `training_sessions.level` to the data-model block.

- [ ] **Step 2: Commit**

```bash
git add HANDOFF.md
git commit -m "Document the leaderboard's band model and read path"
```

---

## Notes for the executor

- **Do not run `/api/setup` against production.** Every verification step here targets the local PGlite database. Cole runs setup on Vercel himself, by hand, and needs to see `"schemaVersion":13` with `"missing":[]` in the response.
- **`npm test` only covers `lib/`.** Route and UI verification is by the curl and browser steps written into each task; there is no component test harness in this project and this plan does not add one.
- **Lint has 8 pre-existing errors** in `components/*.tsx` (`react-hooks/set-state-in-effect` and one `no-html-link-for-pages`). They are not yours to fix. Confirm the count does not grow.
