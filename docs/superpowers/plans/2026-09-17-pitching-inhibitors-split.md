# Pitching Inhibitors Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the twelve Pitching Inhibitors off the movement-screen record onto their own, so the two assessments can be recorded independently.

**Architecture:** A new `delivery_screens` table mirroring `movement_screens`, with its own routes, its own modal, and its own roster card on the Tests page. A chooser on the athlete page asks which assessment is being recorded. A one-time migration copies existing marks across. The twelve flaws and their mappings do not change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Postgres via `pg` (PGlite locally), Node's test runner via tsx.

**Spec:** `docs/superpowers/specs/2026-09-17-pitching-inhibitors-split-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing any Next.js code.** Required by `AGENTS.md`.
- **`npm run verify` is the gate** — lint, `tsc --noEmit`, `npm test`, `npm run build`. All four green before any commit. Chain with `&&`, never `;`.
- **Mutation-test every new assertion.** Break the source, confirm the named test fails, restore, confirm green. A test that has never failed has not been shown to work.
- **The upgrade path is the path that matters.** This app's database has rows. A migration verified only on a fresh database is not verified; that has shipped bugs here twice.
- **Never modify `canSeeAthlete` in `lib/scope.ts`.** The leaderboard stays the only cross-athlete visibility.
- **Coach-only fields are stripped server-side by role**, never merely hidden in the UI.
- **No em dashes in user-facing copy**, and no register a teenager would not use.
- **`lib/big12.ts` is not edited by this plan.** The twelve flaws, their labels, copy, causes and order are the app owner's and are already correct.
- **Nothing drops a column.** Dropping is the one destructive migration this app has never run.
- **PGlite is single-writer.** If a dev server is running against a PGlite database, do not open a second connection to it; it will hang rather than error.

## File Structure

| File | Responsibility |
|---|---|
| `lib/schema.ts` (modify) | The `delivery_screens` table, its unique index, the copy migration, `SCHEMA_VERSION` 26 to 27. |
| `lib/types.ts` (modify) | `DeliveryScreen`, `DeliveryOverviewRow`; `ScreenOverviewRow` loses `delivery`. |
| `lib/deliveryInput.ts` (create) | Validates a delivery write. Mirrors `lib/screenInput.ts`. |
| `lib/data.ts` (modify) | `listDeliveryScreens`, `upsertDeliveryScreen`, `deleteDeliveryScreen`, `listAllDeliveryScreens`. |
| `lib/big12Explain.ts` (modify) | `deliveryStatus` retires; `countInhibitors` replaces it. |
| `app/api/athletes/[id]/delivery/route.ts` (create) | GET / POST / DELETE, mirroring the screens route's authorization. |
| `app/api/delivery/overview/route.ts` (create) | The roster card's data, coach only. |
| `components/DeliveryModal.tsx` (create) | The inhibitors modal, lifted whole out of `ScreenModal`. |
| `components/ScreenModal.tsx` (modify) | Loses the inhibitors section entirely. |
| `components/RecordChooser.tsx` (create) | The two-button chooser. |
| `components/ScreenPanel.tsx` (modify) | Chooser instead of a direct modal; the inhibitors report reads the delivery record. |
| `components/TestsView.tsx` (modify) | Second roster card; the delivery line comes off the screen rows. |

---

### Task 1: The table and the migration

**Files:**
- Modify: `lib/schema.ts` (`SCHEMA_VERSION` at line 10; add after the `movement_screens` block)
- Test: `lib/schema.test.ts`

**Interfaces:**
- Produces: table `delivery_screens(id, athlete_id, date, flaws, notes, created_by, created_at, updated_at)`, unique index on `(athlete_id, date)`, `SCHEMA_VERSION = 27`.

**What makes this task different from an ordinary migration.** It has a data-moving step, and that step reads columns the rest of the app is about to stop reading. It must be safe to run any number of times, and a second run must never reach back to the old columns and overwrite an edit made since.

- [ ] **Step 1: Write the failing tests**

Append to `lib/schema.test.ts`:

```ts
test("the delivery screens table and its one-per-day index both exist", () => {
  const sql = schemaFile();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS delivery_screens/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS delivery_screens_athlete_date_uidx/,
  );
});

test("the index the migration conflicts on is created BEFORE the migration runs", () => {
  /*
   * ON CONFLICT (athlete_id, date) needs that unique index to exist. Ordered
   * the other way round this is a syntax error at setup time, not a silent
   * no-op, and every screen save stays broken until someone notices.
   */
  const sql = schemaFile();
  const index = sql.indexOf("delivery_screens_athlete_date_uidx");
  const migration = sql.indexOf("INSERT INTO delivery_screens");
  assert.ok(index > -1 && migration > -1, "one of the two statements is missing");
  assert.ok(index < migration, "the migration runs before its conflict target exists");
});

test("the migration carries marks forward and never reaches back", () => {
  const sql = schemaFile();
  assert.match(sql, /INSERT INTO delivery_screens[\s\S]*?FROM movement_screens/);
  assert.match(sql, /WHERE delivery_assessed = true/);
  assert.match(sql, /ON CONFLICT \(athlete_id, date\) DO NOTHING/);
  assert.ok(
    !/ON CONFLICT \(athlete_id, date\) DO UPDATE/.test(sql),
    "a re-run would overwrite an edit made since the first one",
  );
});

test("nothing in this version drops a column", () => {
  assert.ok(!/DROP COLUMN/i.test(schemaFile()), "a migration dropped a column");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test lib/schema.test.ts`
Expected: FAIL, no `delivery_screens` in the schema.

- [ ] **Step 3: Add the table, the index and the migration**

In `lib/schema.ts`, after the `movement_screens` block and its own statements, add:

```sql
-- v27: Pitching Inhibitors became their own assessment.
--
-- They shipped on the movement screen row because Cole assessed both in one
-- session. He now records them independently, and on a shared row that breaks
-- twice: a row carrying only marks would read as a movement screen with no
-- tests and start the 8-week clock, and saving one half would blank the other,
-- because the upsert writes both.
CREATE TABLE IF NOT EXISTS delivery_screens (
  id          text PRIMARY KEY,
  athlete_id  text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date        date NOT NULL,
  flaws       jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- One assessment per athlete per day, and the conflict target the migration
-- below depends on. It must exist before that INSERT runs.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_screens_athlete_date_uidx
  ON delivery_screens(athlete_id, date);

-- Carry across whatever was recorded while the two shared a row. The id is
-- derived from the screen's, so a second run produces the same row rather
-- than a duplicate.
--
-- DO NOTHING, never DO UPDATE: once a row is here it IS the record, and a
-- re-run must not reach back to the old columns and undo an edit made since.
-- An assessed-but-clean screen arrives as flaws = '{}', which in this shape
-- still means "assessed, nothing found" — which is why delivery_assessed is
-- not carried across and does not need to be.
INSERT INTO delivery_screens (id, athlete_id, date, flaws, notes, created_by, created_at)
SELECT 'from-screen-' || id, athlete_id, date, flaws, '', created_by, created_at
  FROM movement_screens
 WHERE delivery_assessed = true
ON CONFLICT (athlete_id, date) DO NOTHING;
```

Then change line 10 to `export const SCHEMA_VERSION = 27;`.

Do NOT put a backtick inside any SQL comment in this file. The schema is a JavaScript template literal and a stray backtick has broken this repo's build twice.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx tsx --test lib/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the migration on a database that already has rows**

This is the step unit tests cannot do. Write this to a scratch file OUTSIDE the repo, run it, and delete it — do not commit a scratch file.

```js
process.env.USE_PGLITE = "1";
process.env.PGLITE_DIR = "/tmp/vl-delivery-upgrade";
const { execScript, sql } = await import("/ABSOLUTE/PATH/TO/REPO/lib/db.ts");
const { schemaFile } = await import("/ABSOLUTE/PATH/TO/REPO/lib/schema.ts");

// A database as it stands BEFORE this version: no delivery_screens at all.
const before = schemaFile()
  .replace(/CREATE TABLE IF NOT EXISTS delivery_screens[\s\S]*?\);/, "")
  .replace(/CREATE UNIQUE INDEX IF NOT EXISTS delivery_screens_athlete_date_uidx[\s\S]*?;/, "")
  .replace(/INSERT INTO delivery_screens[\s\S]*?DO NOTHING;/, "");
await execScript(before);

await sql`INSERT INTO athletes (id, name) VALUES ('a1', 'Test') ON CONFLICT (id) DO NOTHING`;
await sql`INSERT INTO movement_screens (id, athlete_id, date, flaws, delivery_assessed)
          VALUES ('s1', 'a1', '2026-01-01', '{"sway":true}'::jsonb, true)`;
await sql`INSERT INTO movement_screens (id, athlete_id, date, flaws, delivery_assessed)
          VALUES ('s2', 'a1', '2026-02-01', '{}'::jsonb, false)`;

await execScript(schemaFile());
console.log("after first run:", JSON.stringify(await sql`SELECT athlete_id, date, flaws FROM delivery_screens ORDER BY date`));

// An edit made after the migration must survive a second run.
await sql`UPDATE delivery_screens SET flaws = '{"high-hand":true}'::jsonb WHERE athlete_id = 'a1'`;
await execScript(schemaFile());
console.log("after second run:", JSON.stringify(await sql`SELECT athlete_id, date, flaws FROM delivery_screens ORDER BY date`));
console.log("row count:", JSON.stringify(await sql`SELECT count(*)::int AS n FROM delivery_screens`));
```

Expected, and all three must hold:
- After the first run: exactly one row, dated `2026-01-01`, `flaws` = `{"sway":true}`. The unassessed screen produced nothing.
- After the second run: still `{"high-hand":true}`. The edit survived.
- Row count: 1. No duplicate.

If the second run reverts the edit, the conflict clause is wrong. Fix it before moving on.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add lib/schema.ts lib/schema.test.ts db/schema.sql && git commit -m "Schema v27: Pitching Inhibitors get their own table"
```

`db/schema.sql` is regenerated from `lib/schema.ts` and `lib/schemaFile.test.ts` byte-compares them, so it belongs in this commit.

---

### Task 2: Types, validation and the data layer

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/deliveryInput.ts`
- Modify: `lib/data.ts`
- Modify: `lib/big12Explain.ts` (retire `deliveryStatus`, add `countInhibitors`)
- Test: `lib/deliveryInput.test.ts` (create), `lib/dataRows.test.ts`, `lib/big12Explain.test.ts`

**Interfaces:**
- Consumes: `FLAW_KEYS` from `lib/big12.ts`; `isCalendarDate`, `todayISO` from `lib/velo.ts`; `sql`, `isoDate` already used throughout `lib/data.ts`.
- Produces:
  - `interface DeliveryScreen { id: string; athleteId: string; date: string; flaws: Record<string, boolean>; notes: string }`
  - `interface DeliveryInput { date: string; flaws: Record<string, boolean>; notes: string }`
  - `interface DeliveryOverviewRow { athleteId: string; name: string; last: string | null; count: number; phase: string | null }`
  - `parseDeliveryInput(body: unknown, today: string): { ok: boolean; error?: string; value?: DeliveryInput }`
  - `toDeliveryScreen(r: Record<string, unknown>): DeliveryScreen`
  - `listDeliveryScreens(athleteId: string): Promise<DeliveryScreen[]>`
  - `upsertDeliveryScreen(athleteId: string, input: DeliveryInput, createdBy: string): Promise<DeliveryScreen>`
  - `deleteDeliveryScreen(athleteId: string, date: string): Promise<void>`
  - `listAllDeliveryScreens(): Promise<DeliveryOverviewRow[]>`
  - `countInhibitors(flaws: Record<string, boolean>): number`

**Read `lib/screenInput.ts` and the screen functions in `lib/data.ts` first** and mirror their shape. They are the pattern; this is the same thing with a smaller payload.

- [ ] **Step 1: Write the failing validation tests**

Create `lib/deliveryInput.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeliveryInput } from "@/lib/deliveryInput";

/* ------------------------------------------------------------------ *
 * Validating a delivery assessment
 *
 * All-or-nothing, like the screen write path: a request with one bad value is
 * refused with a message naming it, rather than being partly applied.
 *
 * The difference from a screen: an EMPTY assessment is valid here. A row IS
 * the statement that Cole watched the delivery, so saving with nothing ticked
 * means "I looked and found nothing" — which is a result, and the reason the
 * old delivery_assessed column is not needed any more.
 * ------------------------------------------------------------------ */

test("an assessment with nothing marked is valid, because the row is the assessment", () => {
  const got = parseDeliveryInput({ date: "2026-01-01" }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("marked flaws are kept", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { sway: true, "high-hand": true } },
    "2026-06-01",
  );
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, { sway: true, "high-hand": true });
});

test("a flaw key nobody recognises is refused by name", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { "sway-ish": true } },
    "2026-06-01",
  );
  assert.equal(got.ok, false);
  assert.match(got.error!, /sway-ish/);
});

test("an unticked flaw is dropped rather than stored as false", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { sway: false } },
    "2026-06-01",
  );
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("a date that is not a real day is refused", () => {
  const got = parseDeliveryInput({ date: "2026-02-31" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /date/i);
});

test("a date in the future is refused", () => {
  const got = parseDeliveryInput({ date: "2026-07-01" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /future/i);
});

test("flaws must be an object, and the error says so", () => {
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: "sway" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /flaws must be an object/);
});

test("an array is not an object, and does not report a bogus flaw key", () => {
  /*
   * Object.entries(["sway"]) yields key "0", so without an array guard the
   * error names a flaw that was never in the request.
   */
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: ["sway"] }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /flaws must be an object/);
});

test("notes default to empty rather than undefined", () => {
  const got = parseDeliveryInput({ date: "2026-01-01" }, "2026-06-01");
  assert.equal(got.value!.notes, "");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test lib/deliveryInput.test.ts`
Expected: FAIL, cannot find module `@/lib/deliveryInput`.

- [ ] **Step 3: Write the validator**

Create `lib/deliveryInput.ts`:

```ts
import { FLAW_KEYS } from "./big12";
import { isCalendarDate } from "./velo";

/* ------------------------------------------------------------------ *
 * Validating a delivery assessment before it is stored
 *
 * All-or-nothing, like the screen write path: a request with one bad value is
 * refused with a message naming it rather than being partly applied.
 *
 * An EMPTY assessment is valid, which is the one real difference. The row is
 * the statement that the delivery was watched, so nothing ticked means
 * "I looked and found nothing" — a result, and the reason the shared row's
 * delivery_assessed column retires with this change.
 * ------------------------------------------------------------------ */

export interface DeliveryInput {
  date: string;
  flaws: Record<string, boolean>;
  notes: string;
}

export interface ParsedDelivery {
  ok: boolean;
  error?: string;
  value?: DeliveryInput;
}

export function parseDeliveryInput(body: unknown, today: string): ParsedDelivery {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  const date = String(b.date ?? "");
  if (!isCalendarDate(date))
    return { ok: false, error: "date must be a real day, as YYYY-MM-DD" };
  if (date > today) return { ok: false, error: "date can't be in the future" };

  if (
    b.flaws !== undefined &&
    (typeof b.flaws !== "object" || b.flaws === null || Array.isArray(b.flaws))
  )
    return { ok: false, error: "flaws must be an object" };

  const raw = (b.flaws ?? {}) as Record<string, unknown>;
  const flaws: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!FLAW_KEYS.has(key)) return { ok: false, error: `unknown flaw '${key}'` };
    // Unticked is an absence. Storing false would make "he does not have this"
    // and "nobody looked" two different-looking records meaning the same thing.
    if (value === true) flaws[key] = true;
  }

  return { ok: true, value: { date, flaws, notes: String(b.notes ?? "") } };
}
```

- [ ] **Step 4: Run the validation tests**

Run: `npx tsx --test lib/deliveryInput.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Replace `deliveryStatus` with `countInhibitors`**

In `lib/big12Explain.ts`, delete `DeliveryStatus` and `deliveryStatus` and add:

```ts
/**
 * How many of the twelve are marked.
 *
 * Filtered through FLAW_KEYS: a key that is not one of the twelve was never a
 * flaw Cole ticked and must not inflate the number he reads.
 *
 * There is no "assessed" state to report any more. A delivery row IS the
 * assessment, so absence of a row is the absence of one, and the roster shows
 * that by which list an athlete is in rather than by a value on the row.
 */
export function countInhibitors(flaws: Record<string, boolean>): number {
  return Object.keys(flaws).filter((k) => flaws[k] === true && FLAW_KEYS.has(k))
    .length;
}
```

In `lib/big12Explain.test.ts`, replace the five `deliveryStatus` tests with:

```ts
test("marked flaws are counted", () => {
  assert.equal(countInhibitors({ sway: true, "high-hand": true }), 2);
});

test("an assessment with nothing marked counts zero rather than failing", () => {
  assert.equal(countInhibitors({}), 0);
});

test("a flaw stored as false is not counted", () => {
  assert.equal(countInhibitors({ sway: true, "late-riser": false }), 1);
});

test("a key that is not one of the twelve is not counted", () => {
  assert.equal(countInhibitors({ "sway-ish": true }), 0);
});
```

Update that file's import to bring in `countInhibitors` instead of `deliveryStatus`.

- [ ] **Step 6: Add the types**

In `lib/types.ts`:

```ts
export interface DeliveryScreen {
  id: string;
  athleteId: string;
  date: string;
  /** Big 12 marks. A key present and true means Cole saw that flaw. */
  flaws: Record<string, boolean>;
  notes: string;
}

export interface DeliveryOverviewRow {
  athleteId: string;
  name: string;
  /** The most recent assessment, or null when there has never been one. */
  last: string | null;
  /** Marks on that most recent assessment. */
  count: number;
  /** Training block — in-season pauses the clock, same as the screen. */
  phase: string | null;
}
```

Remove `delivery: DeliveryStatus | null;` from `ScreenOverviewRow` and remove the now-unused `DeliveryStatus` import. Task 6 removes the UI that read it; `tsc` will point at anything left over.

- [ ] **Step 7: Write the failing data-layer test**

Append to `lib/dataRows.test.ts`:

```ts
test("a delivery row reads back with its marks and notes", () => {
  const d = toDeliveryScreen({
    id: "d1", athlete_id: "a1", date: "2026-01-01",
    flaws: { sway: true }, notes: "filmed from the side",
  });
  assert.deepEqual(d.flaws, { sway: true });
  assert.equal(d.notes, "filmed from the side");
  assert.equal(d.athleteId, "a1");
});

test("a delivery row with no marks is still an assessment", () => {
  const d = toDeliveryScreen({ id: "d1", athlete_id: "a1", date: "2026-01-01" });
  assert.deepEqual(d.flaws, {});
  assert.equal(d.notes, "");
});
```

Import `toDeliveryScreen` from `@/lib/data` at the top of that file.

- [ ] **Step 8: Write the data layer**

In `lib/data.ts`, beside the screen functions:

```ts
export function toDeliveryScreen(r: Record<string, unknown>): DeliveryScreen {
  return {
    id: String(r.id),
    athleteId: String(r.athlete_id),
    date: isoDate(r.date),
    flaws: (r.flaws ?? {}) as Record<string, boolean>,
    notes: String(r.notes ?? ""),
  };
}

export async function listDeliveryScreens(athleteId: string): Promise<DeliveryScreen[]> {
  const rows = (await sql`
    SELECT * FROM delivery_screens WHERE athlete_id = ${athleteId} ORDER BY date DESC
  `) as Record<string, unknown>[];
  return rows.map(toDeliveryScreen);
}

export async function upsertDeliveryScreen(
  athleteId: string,
  input: DeliveryInput,
  createdBy: string,
): Promise<DeliveryScreen> {
  const id = crypto.randomUUID();
  const rows = (await sql`
    INSERT INTO delivery_screens (id, athlete_id, date, flaws, notes, created_by)
    VALUES (${id}, ${athleteId}, ${input.date},
            ${JSON.stringify(input.flaws)}::jsonb, ${input.notes}, ${createdBy})
    ON CONFLICT (athlete_id, date) DO UPDATE SET
      flaws = EXCLUDED.flaws,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING *
  `) as Record<string, unknown>[];
  return toDeliveryScreen(rows[0]);
}

export async function deleteDeliveryScreen(athleteId: string, date: string): Promise<void> {
  await sql`
    DELETE FROM delivery_screens WHERE athlete_id = ${athleteId} AND date = ${date}
  `;
}

/**
 * Every athlete with their most recent assessment, for the Tests roster.
 *
 * An athlete who has never been assessed still appears, with last = null. The
 * card needs them: "nobody has looked at this pitcher's delivery" is the whole
 * point of having a queue.
 */
export async function listAllDeliveryScreens(): Promise<DeliveryOverviewRow[]> {
  const rows = (await sql`
    SELECT a.id AS athlete_id, a.name, a.phase, d.date, d.flaws
      FROM athletes a
      LEFT JOIN delivery_screens d ON d.athlete_id = a.id
     WHERE a.archived = false
     ORDER BY a.name, d.date
  `) as Record<string, unknown>[];

  const byAthlete = new Map<string, DeliveryOverviewRow>();
  for (const r of rows) {
    const id = String(r.athlete_id);
    const entry = byAthlete.get(id) ?? {
      athleteId: id,
      name: String(r.name),
      last: null,
      count: 0,
      phase: (r.phase as string | null) ?? null,
    };
    // The LEFT JOIN gives one null row for an athlete never assessed. Rows are
    // ordered by date, so the last one seen is the most recent.
    if (r.date) {
      entry.last = isoDate(r.date);
      entry.count = countInhibitors((r.flaws ?? {}) as Record<string, boolean>);
    }
    byAthlete.set(id, entry);
  }
  return [...byAthlete.values()];
}
```

Import `DeliveryScreen`, `DeliveryOverviewRow` from `./types`, `DeliveryInput` from `./deliveryInput`, and `countInhibitors` from `./big12Explain`.

- [ ] **Step 9: Run the tests**

Run: `npx tsx --test lib/dataRows.test.ts lib/deliveryInput.test.ts lib/big12Explain.test.ts`
Expected: PASS.

- [ ] **Step 10: Mutation-test the two that carry the most**

In `lib/deliveryInput.ts`, change `if (!FLAW_KEYS.has(key))` to `if (false)`. Run the delivery input tests.
Expected: FAIL on "a flaw key nobody recognises is refused by name". Restore.

In `lib/data.ts`, change `listAllDeliveryScreens` to set `entry.count` before the `if (r.date)` guard rather than inside it. Run `npx tsx --test lib/dataRows.test.ts`; if nothing fails, that path has no coverage — add a test that an athlete with no assessment reads `last: null, count: 0`, confirm it fails under the mutation, then restore.

- [ ] **Step 11: Verify and commit**

```bash
npm run verify && git add lib/types.ts lib/deliveryInput.ts lib/deliveryInput.test.ts lib/data.ts lib/dataRows.test.ts lib/big12Explain.ts lib/big12Explain.test.ts && git commit -m "Store a delivery assessment on its own record"
```

---

### Task 3: The routes

**Files:**
- Create: `app/api/athletes/[id]/delivery/route.ts`
- Create: `app/api/delivery/overview/route.ts`
- Test: `lib/deliveryRoute.test.ts` (create)

**Interfaces:**
- Consumes: `getScope`, `canSeeAthlete` from `lib/scope.ts`; `listDeliveryScreens`, `upsertDeliveryScreen`, `deleteDeliveryScreen`, `listAllDeliveryScreens` from `lib/data.ts`; `parseDeliveryInput` from `lib/deliveryInput.ts`; `visibleScreen` from `lib/screen.ts`; `json`, `unauthorized`, `forbidden`, `badRequest`, `guard` from `lib/http.ts`.
- Produces: `GET|POST|DELETE /api/athletes/:id/delivery`, `GET /api/delivery/overview`.

**Read `app/api/athletes/[id]/screens/route.ts` first and mirror it exactly.** Same authorization, same shape, same `runtime`/`dynamic` exports. `await ctx.params` is the current Next convention and that file shows it; do not change the pattern.

`visibleScreen` is generic over `{ notes?: string }`, so it strips a delivery row's notes for an athlete without needing a second function. Use it. Do not add a UI-only gate for notes anywhere.

- [ ] **Step 1: Write the failing test**

Create `lib/deliveryRoute.test.ts`, following the shape of `lib/liftRoute.test.ts` in this repo (read it first for how routes are exercised here):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test lib/deliveryRoute.test.ts`
Expected: PASS already if Task 2 is complete — these pin the contract rather than drive new code. If either fails, Task 2 is incomplete; fix that before writing the route.

- [ ] **Step 3: Write the athlete route**

Create `app/api/athletes/[id]/delivery/route.ts`:

```ts
import { getScope, canSeeAthlete } from "@/lib/scope";
import {
  listDeliveryScreens,
  upsertDeliveryScreen,
  deleteDeliveryScreen,
} from "@/lib/data";
import { visibleScreen } from "@/lib/screen";
import { parseDeliveryInput } from "@/lib/deliveryInput";
import { isCalendarDate, todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An athlete reads their own assessments; only a coach records or removes one.
 * Same rule as the movement screen, and for the same reason: this is
 * administered, not self-reported.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  const isCoach = scope.role === "coach";
  return guard(async () => {
    const rows = await listDeliveryScreens(id);
    return json(rows.map((d) => visibleScreen(d, isCoach)));
  }, "Loading the delivery assessments failed");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const parsed = parseDeliveryInput(
    await request.json().catch(() => ({})),
    todayISO(),
  );
  if (!parsed.ok) return badRequest(parsed.error ?? "Invalid assessment");

  return guard(
    async () => json(await upsertDeliveryScreen(id, parsed.value!, scope.email), 201),
    "Saving the delivery assessment failed",
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!isCalendarDate(date)) return badRequest("date required");
  return guard(async () => {
    await deleteDeliveryScreen(id, date);
    return json({ ok: true });
  }, "Deleting the delivery assessment failed");
}
```

- [ ] **Step 4: Write the overview route**

Create `app/api/delivery/overview/route.ts`, mirroring `app/api/screens/overview/route.ts`:

```ts
import { getScope } from "@/lib/scope";
import { listAllDeliveryScreens } from "@/lib/data";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The roster card. Coach only, like the screen overview beside it. */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(
    async () => json(await listAllDeliveryScreens()),
    "Loading the delivery overview failed",
  );
}
```

- [ ] **Step 5: Check the leak sweep covers the new route**

This repo has a test that sweeps API routes for coach-only fields reaching an athlete. Find it (`lib/athleteWire.test.ts`) and read how it enumerates routes. If it works from a list, add the new athlete route to that list. If it discovers routes from the filesystem, confirm it picks the new one up and that notes are stripped.

Run: `npx tsx --test lib/athleteWire.test.ts`
Expected: PASS, with the new route covered rather than skipped.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add "app/api/athletes/[id]/delivery/route.ts" app/api/delivery/overview/route.ts lib/deliveryRoute.test.ts lib/athleteWire.test.ts && git commit -m "Routes for recording and reading a delivery assessment"
```

---

### Task 4: The inhibitors modal

**Files:**
- Create: `components/DeliveryModal.tsx`
- Modify: `components/ScreenModal.tsx` (remove the inhibitors section entirely)
- Test: `components/DeliveryModal.test.tsx` (create), `components/ScreenModal.test.tsx`

**Interfaces:**
- Consumes: `BIG_12` from `lib/big12.ts`; `DeliveryScreen` from `lib/types.ts`.
- Produces: `<DeliveryModal athleteId date initial onClose onSaved />` posting to `/api/athletes/:id/delivery`.

**Read `components/ScreenModal.tsx` in full first.** The inhibitors section already exists there: the twelve checkboxes in `BIG_12` order, each a collapsible card showing `description` and `howToSpot` as two separate blocks with a "How to spot it" label. Move that markup and its styles across unchanged. Its copy is the app owner's and none of it changes.

What goes and what stays:
- The `deliveryAssessed` checkbox GOES. A saved row is the assessment now, so a separate flag says nothing. Its disabled-while-flaws-ticked logic goes with it.
- The twelve checkboxes, their collapse behaviour, and their copy MOVE to the new modal.
- `ScreenModal` keeps the physical tests, the date, the notes, and its save path, and loses every reference to flaws and `deliveryAssessed`.

The new modal carries its own date and notes, matching how `ScreenModal` handles both.

- [ ] **Step 1: Write the failing tests**

Create `components/DeliveryModal.test.tsx`, using the real helpers from `components/testRender.tsx` and following `components/ScreenModal.test.tsx` for how a modal is rendered and submitted here:

```tsx
test("the twelve are offered in the app owner's order", () => {
  // render the modal, then:
  const boxes = [...document.querySelectorAll('input[name^="flaw:"]')];
  assert.equal(boxes.length, 12);
  assert.deepEqual(
    boxes.map((b) => b.getAttribute("name")),
    BIG_12.map((f) => `flaw:${f.key}`),
  );
});

test("a flaw's description and how-to-spot stay two blocks, not one string", () => {
  // open the first flaw card, then assert two separate .ms-help elements and
  // that the body text does not contain the two strings joined by one space.
});

test("saving with nothing ticked still records an assessment", () => {
  // submit without ticking anything; assert the POST body is
  // { date, flaws: {}, notes: "" } and that it was sent at all.
});

test("there is no separate assessed checkbox any more", () => {
  assert.equal(document.querySelector('input[name="deliveryAssessed"]'), null);
});

test("an existing assessment opens with its marks already ticked", () => {
  // render with initial = { date, flaws: { sway: true }, notes: "" }
  // assert the sway box is checked.
});
```

Fill each body in using the real helpers. Every assertion above must be present; none may be dropped because a helper is awkward.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/DeliveryModal.test.tsx`
Expected: FAIL, no such module.

- [ ] **Step 3: Build the modal and strip ScreenModal**

Create `components/DeliveryModal.tsx` with the moved markup, and remove from `components/ScreenModal.tsx`: the inhibitors section, the `flaws`/`deliveryAssessed` state, both fields from its POST body, and the `BIG_12` import.

`ScreenModal`'s existing tests that mention flaws or the assessed checkbox are now testing behaviour that has moved. Move those assertions to the delivery modal's tests rather than deleting them; a test deleted because the code moved is coverage lost.

- [ ] **Step 4: Run both test files**

Run: `npx tsx --test components/DeliveryModal.test.tsx components/ScreenModal.test.tsx`
Expected: PASS, and `ScreenModal.test.tsx` no longer references flaws.

- [ ] **Step 5: Mutation-test the order**

In `components/DeliveryModal.tsx`, render `[...BIG_12].reverse()` instead of `BIG_12`. Run the delivery modal tests.
Expected: FAIL on the order test. Restore.

If it does NOT fail, the order test is asserting presence rather than order and must be fixed before moving on.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add components/DeliveryModal.tsx components/DeliveryModal.test.tsx components/ScreenModal.tsx components/ScreenModal.test.tsx && git commit -m "Lift the inhibitors out into their own modal"
```

---

### Task 5: The chooser

**Files:**
- Create: `components/RecordChooser.tsx`
- Modify: `components/ScreenPanel.tsx` (the "Record a screen" button at line 252 and the modal at line 448)
- Test: `components/ScreenPanel.test.tsx`

**Interfaces:**
- Consumes: `ScreenModal`, `DeliveryModal`.
- Produces: `<RecordChooser onPick={(kind: "screen" | "delivery") => void} onClose={() => void} />`.

Today "Record a screen" opens `ScreenModal` directly. It now opens a chooser with two buttons, **Movement screen** and **Pitching Inhibitors**, each opening its own modal. An athlete with neither assessment sees the same chooser rather than a different flow.

Keep the button's own label plain. "Record a screen" still fits when the choice follows.

- [ ] **Step 1: Write the failing tests**

Append to `components/ScreenPanel.test.tsx`:

```tsx
test("recording asks which assessment before opening anything", () => {
  // render the coach panel, click the record button, then:
  assert.match(document.body.textContent!, /movement screen/i);
  assert.match(document.body.textContent!, /pitching inhibitors/i);
});

test("choosing the movement screen opens the screen modal, not the inhibitors one", () => {
  // click record, click the Movement screen button, then assert a control that
  // only the screen modal renders is present, and that no flaw checkbox is.
  assert.equal(document.querySelector('input[name^="flaw:"]'), null);
});

test("choosing inhibitors opens the twelve, not the sixteen tests", () => {
  // click record, click the Pitching Inhibitors button, then:
  assert.equal([...document.querySelectorAll('input[name^="flaw:"]')].length, 12);
});

test("an athlete is never offered the chooser", () => {
  // render with isCoach false; the record button is not rendered at all.
});
```

Fill each in with this file's real helpers.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/ScreenPanel.test.tsx`
Expected: FAIL, the chooser text is not rendered.

- [ ] **Step 3: Build the chooser and wire it**

Create `components/RecordChooser.tsx` following whatever dialog pattern `ScreenModal` already uses for its shell, so the two look like one app. Two buttons, each with a line saying what it records: the movement screen is the sixteen physical tests, Pitching Inhibitors is the twelve things you watch for in the delivery.

Write that copy plainly. No em dashes, nothing a teenager would not say.

In `ScreenPanel`, the record button opens the chooser; the chooser's pick opens the matching modal.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test components/ScreenPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the routing**

In `ScreenPanel`, make both chooser picks open `ScreenModal`. Run the tests.
Expected: FAIL on "choosing inhibitors opens the twelve". Restore.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add components/RecordChooser.tsx components/ScreenPanel.tsx components/ScreenPanel.test.tsx && git commit -m "Ask which assessment before opening a modal"
```

---

### Task 6: The second roster card

**Files:**
- Modify: `components/TestsView.tsx`
- Test: `components/TestsView.test.tsx`

**Interfaces:**
- Consumes: `DeliveryOverviewRow` from `lib/types.ts`; `GET /api/delivery/overview`; `RETEST_CADENCE`, `retestState` from `lib/screen.ts`.
- Produces: no new exports.

A second card below Movement screen, in the same formatting: heading, cadence caption, roster rows, and a "not assessed yet" list beneath for athletes who have never been assessed.

A row shows `no inhibitors` or `N inhibitors`, when it was done, and the clock. The cadence is `RETEST_CADENCE.full`, 8 weeks, reusing the existing constant rather than introducing a second notion of due.

**The delivery line added to the movement screen's rows comes OUT.** It was put there when the two shared a record. With a card of its own it says the same thing twice in two places, and two views saying the same thing is how they drift into disagreeing. Remove the `tr-delivery` markup from the screen rows, its CSS rule, and the tests that assert it.

- [ ] **Step 1: Write the failing tests**

Append to `components/TestsView.test.tsx`, using this file's real `roster` helper and extending its SWR map with `"/api/delivery/overview"`:

```tsx
test("an athlete never assessed is listed as not assessed yet, not as clean", () => {
  // deliveries: [{ athleteId, name, last: null, count: 0, phase: null }]
  assert.match(document.body.textContent!, /not assessed yet/i);
  assert.doesNotMatch(document.body.textContent!, /no inhibitors/i);
});

test("an assessment with nothing found reads as a result", () => {
  // last: today, count: 0
  assert.match(document.body.textContent!, /no inhibitors/i);
});

test("marks are counted, and one is not called 1 inhibitors", () => {
  // last: today, count: 1
  assert.match(document.body.textContent!, /1 inhibitor(?!s)/i);
});

test("the clock is the 8-week one, from the config", () => {
  // assert the caption names RETEST_CADENCE.full / 7 weeks rather than a
  // hardcoded 8, so changing the constant changes the card.
});

test("an assessment older than the cadence is flagged", () => {
  // last: daysAgo(RETEST_CADENCE.full + 7), assert an overdue badge
});

test("the screen card no longer carries a delivery line", () => {
  /*
   * It lived there while the two shared a record. Saying it in two places is
   * how two views drift into disagreeing about the same athlete.
   */
  assert.doesNotMatch(document.body.textContent!, /delivery not assessed/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/TestsView.test.tsx`
Expected: FAIL, no second card.

- [ ] **Step 3: Build the card**

Read how the movement screen card is built in this file and follow it: same heading and caption structure, same row markup, same split into an assessed list and a never-assessed list.

Fetch `/api/delivery/overview` with SWR beside the existing overview fetch.

Then remove the `tr-delivery` markup, the `.tr-work em.tr-delivery` rule in `app/globals.css`, and the delivery tests added to this file earlier.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test components/TestsView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the two that matter**

Change the never-assessed list to fall through to the assessed one. Run the tests.
Expected: FAIL on "an athlete never assessed is listed as not assessed yet". Restore.

Change the cadence caption to a hardcoded 8. Run the tests.
Expected: FAIL on "the clock is the 8-week one, from the config". Restore. If it does not fail, that test is reading the number rather than the constant and must be fixed.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add components/TestsView.tsx components/TestsView.test.tsx app/globals.css && git commit -m "A card of its own for Pitching Inhibitors"
```

---

### Task 7: The report reads the delivery record

**Files:**
- Modify: `components/ScreenPanel.tsx`
- Test: `components/ScreenPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/athletes/:id/delivery`; `explainScreen` from `lib/big12Explain.ts`; `standingScreen` from `lib/screen.ts`.
- Produces: no new exports.

The inhibitors section currently reads `screen.flaws` and `screen.deliveryAssessed` off the picked screen row. It now reads the athlete's most recent delivery assessment, which has its own date.

**The part that needs care.** Explanations still come from the movement screen, resolved against `standingScreen` truncated to the DELIVERY date, not the screen's. A limitation recorded before the assessment explains it; one recorded after it does not. `standingScreen` already truncates to a date; pass the delivery date rather than the screen's.

The three states become two plus an absence:
- No assessment on record: say so. No flaw list.
- An assessment with nothing marked: "Assessed, nothing found." Still a result and must never render as the absence above.
- An assessment with marks: each flaw with its explanation, exactly as now.

- [ ] **Step 1: Write the failing tests**

Append to `components/ScreenPanel.test.tsx`:

```tsx
test("no assessment on record says so, rather than showing an empty list", () => {
  // deliveries: []
  assert.match(document.body.textContent!, /no delivery assessment/i);
});

test("an assessment with nothing found reads as a result", () => {
  // deliveries: [{ date: TODAY, flaws: {}, notes: "" }]
  assert.match(document.body.textContent!, /nothing found/i);
  assert.doesNotMatch(document.body.textContent!, /no delivery assessment/i);
});

test("explanations come from the screen as it stood on the assessment's date", () => {
  /*
   * A limitation recorded AFTER the delivery was watched cannot explain what
   * was seen that day. Screen dated today with hip-45 limited, assessment
   * dated 60 days ago marking Sway: the report must NOT offer that limitation.
   */
  // screens: [screenOf({...hip-45 limited...}) dated TODAY]
  // deliveries: [{ date: daysAgo(60), flaws: { sway: true } }]
  assert.match(document.body.textContent!, /nothing on this screen/i);
});

test("a limitation recorded before the assessment does explain it", () => {
  // screens: dated daysAgo(90) with hip-45 limited
  // deliveries: [{ date: daysAgo(60), flaws: { sway: true } }]
  assert.match(document.body.textContent!, /backside hip rotation/i);
});

test("an athlete with inhibitors and no screen at all gets them all unexplained", () => {
  // screens: [], deliveries: [{ date: TODAY, flaws: { sway: true } }]
  // Correct, and must not render as an error or a crash.
  assert.match(document.body.textContent!, /Sway/);
  assert.match(document.body.textContent!, /nothing on this screen/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/ScreenPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wire it**

Fetch the athlete's delivery assessments, take the most recent, and pass its flaws to `explainScreen` along with `standingScreen(screens, SCREEN_TESTS)` truncated to that assessment's date.

Remove every read of `screen.flaws` and `screen.deliveryAssessed` from this file.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test components/ScreenPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the date truncation**

Pass the screen's own standing results instead of truncating to the delivery date. Run the tests.
Expected: FAIL on "explanations come from the screen as it stood on the assessment's date". Restore.

- [ ] **Step 6: Look at it in a browser**

```bash
npm run dev
```

You will need a coach login. Do NOT read the real `COACH_PASSWORD` out of `.env.local`. Start the server with throwaway values instead:

```bash
USE_PGLITE=1 PGLITE_DIR=/tmp/vl-delivery-ui COACH_EMAILS=<the email in .env.local's COACH_EMAILS> COACH_PASSWORD=throwaway-local-verify AUTH_SECRET=throwaway-local-secret SETUP_KEY=throwaway npm run dev
```

Check: the chooser offers both and each opens the right modal; the Tests page shows two cards that look like siblings; an athlete with an assessment and no screen reads sensibly rather than looking broken.

If you cannot drive a browser, say so plainly in your report rather than claiming you did.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify && git add components/ScreenPanel.tsx components/ScreenPanel.test.tsx && git commit -m "Report the inhibitors from their own record"
```

---

## Shipping

Schema changed, so this needs a setup run, and the order matters more than usual: the delivery routes write to a table that does not exist until the migration runs.

1. Push, wait for the Vercel deployment to report Ready, and check its commit.
2. Visit `https://velo-ladder.vercel.app/api/setup?key=YOUR_SETUP_KEY`. Never ask the owner for that key and never echo it.
3. Check `commit` against what was pushed. If it does not match, nothing else in the response describes the code you think is running.
4. Expect `schemaVersion: 27` and `missing: []`.
5. Open an athlete who had an assessment recorded before this change and confirm it still shows, with the same marks. That is the migration, and it is the only part a test cannot fully prove.

## Self-review notes

Checked against the spec, section by section:

- `delivery_screens`, its unique index, schema 27: Task 1.
- The migration, its `DO NOTHING`, and the proof on a database with rows: Task 1 Step 5.
- `delivery_assessed` retiring, old columns left unread: Tasks 1 and 2.
- Routes mirroring the screen's authorization, notes stripped by `visibleScreen`: Task 3.
- The chooser: Task 5.
- The second card, its 8-week clock, and the delivery line coming off the screen rows: Task 6.
- The report reading its own record, resolved as of the delivery date: Task 7.
- Out of scope and absent from every task: dropping columns, a spot-check cadence for inhibitors, any change to `lib/big12.ts`.

Two things deliberately left to the implementer, both because the real code must be read rather than guessed: the exact test helpers in the component test files, and how `lib/athleteWire.test.ts` enumerates routes. Each is called out in the task that needs it.
