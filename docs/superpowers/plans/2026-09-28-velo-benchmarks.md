# Velo Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach-only fastball velocity benchmark ladder with its sources and scoring guide, plus a calculator that places a pitcher's session against the right row.

**Architecture:** Three database tables seeded idempotently from a JSON snapshot, read through coach-only API routes. The placement logic is a pure module with no UI or database calls. None of this data is ever imported into a client component, which is a deliberate break from how every other config in this app reaches the browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Postgres via `pg` (PGlite locally), SWR, Node's test runner via tsx.

**Spec:** `docs/superpowers/specs/2026-09-28-velo-benchmarks-spec.md`, and its decisions addendum `docs/superpowers/specs/2026-09-28-velo-benchmarks-decisions.md`, which answers the spec's open items and WINS where the two disagree.

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing any Next.js code.** Required by `AGENTS.md`. This is not the Next.js in your training data.
- **`npm run verify` is the gate** — lint, `tsc --noEmit`, `npm test`, `npm run build`. All four green before any commit. Chain with `&&`, never `;`.
- **COACH-ONLY IS THE POINT OF THIS FEATURE.** Enforced server-side on every route. Athletes and parents must never receive this data in any form: SSR props, RSC payloads, client bundles, shared API responses, exports, or links.
- **Never import the seed JSON, `lib/veloSeed.ts`, or `lib/veloData.ts` into a client component.** `lib/clientSafe.test.ts` already walks every client component for value imports of server-only modules; it is the mechanism that enforces this.
- **Never modify `canSeeAthlete` in `lib/scope.ts`.**
- **Do not edit seed values.** If a value looks wrong, flag it in your report rather than fixing it.
- **Add no dependency.** The scoring guide gets a small hand-rolled renderer; two npm packages to render one static document is not necessary, and a renderer that only handles what this file contains cannot silently mis-render something it was never given.
- **Mutation-test every new assertion.** Break the source, confirm the named test fails, restore, confirm green.
- **The upgrade path is the path that matters.** This app's database has rows. A migration verified only on a fresh database is not verified; that has shipped bugs here twice.
- **No em dashes in user-facing copy**, and no register a teenager would not use.
- **Never present the benchmarks as more precise than they are.** Every placement carries its row's confidence rating and the disclosure text verbatim from the spec.

## File Structure

| File | Responsibility |
|---|---|
| `db/velo-ladder-seed-data.json` (exists) | The snapshot. 11 sources, 25 ranges. Never edited by code. |
| `lib/veloSeed.ts` (create) | SERVER ONLY. Reads the JSON, generates idempotent upsert SQL. |
| `lib/schema.ts` (modify) | Three tables, the seed SQL, `SCHEMA_VERSION` 27 to 28. |
| `lib/veloTypes.ts` (create) | Shared types. Types only, no values, so it is safe anywhere. |
| `lib/veloData.ts` (create) | SERVER ONLY. Reads the tables. |
| `lib/veloPlacement.ts` (create) | Pure classification. No UI, no database, no imports from either. |
| `lib/veloConfig.ts` (create) | The four constants, in one place. |
| `app/api/velo/ranges/route.ts` (create) | Coach-only. The ladder. |
| `app/api/velo/sources/route.ts` (create) | Coach-only. The 11 sources. |
| `app/velo/page.tsx` + `components/VeloLadder.tsx` (create) | The ladder table. |
| `components/VeloSources.tsx` (create) | The sources view. |
| `content/evaluation-scoring-guide.md` (exists) | The guide, as an editable content asset. |
| `lib/miniMarkdown.ts` (create) | The subset renderer. Pure, testable. |
| `app/velo/guide/page.tsx` (create) | Renders the guide. |
| `components/VeloCalculator.tsx` (create) | Phase 2 UI. |
| `components/AppHeader.tsx` (modify) | A nav entry in the coach list only. |

`lib/veloTypes.ts` is split from `lib/veloData.ts` on purpose: a client component may need the SHAPE of a range to render one it was handed, without being able to import the loader that fetches them all.

---

### Task 1: Tables and seed

**Files:**
- Create: `lib/veloSeed.ts`
- Modify: `lib/schema.ts` (`SCHEMA_VERSION` line 10; add after the existing tables)
- Test: `lib/veloSeed.test.ts` (create), `lib/schema.test.ts`

**Interfaces:**
- Produces: tables `velo_sources`, `velo_ranges`, `velo_range_sources`; `VELO_SEED_SQL: string`; `veloSnapshotDate(): string`; `SCHEMA_VERSION = 28`.

Read `lib/schema.ts`'s existing `LIFT_SEED_SQL` and `RECIPE_SEED_SQL` first; they are the pattern for generating idempotent seed SQL from a config, including how they escape strings.

**Two things that will bite you.** Do NOT put a backtick inside any SQL comment in `lib/schema.ts`; the whole schema is a JavaScript template literal and a stray backtick has broken this repo's build twice. And the seed text contains apostrophes and double quotes (`"50-55 is right on track"`), so escaping must be the existing helper, not string concatenation you invent.

- [ ] **Step 1: Write the failing tests**

Create `lib/veloSeed.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { VELO_SEED_SQL, veloSeedData, veloSnapshotDate } from "@/lib/veloSeed";

/* ------------------------------------------------------------------ *
 * The benchmark snapshot
 *
 * Notion is the source of truth; this is a snapshot of it. The seed is an
 * idempotent upsert by slug, so re-running with a newer export updates rows
 * in place rather than duplicating them.
 *
 * These tests pin the SHAPE and the counts, never the values. The values are
 * Cole's and are not code's to assert.
 * ------------------------------------------------------------------ */

test("the snapshot holds every source and range the spec counted", () => {
  assert.equal(veloSeedData.sources.length, 11);
  assert.equal(veloSeedData.ranges.length, 25);
});

test("four rows have no data yet, and they are the pro tiers", () => {
  /*
   * Independent Pro and the three MiLB rows. These must render "No data yet",
   * never 0 and never blank, so the loader has to be able to tell a missing
   * band from a zero one.
   */
  const empty = veloSeedData.ranges.filter(
    (r) => r.combined_low === null && r.rhp_low === null && r.lhp_low === null,
  );
  assert.deepEqual(
    empty.map((r) => r.slug).sort(),
    ["independent-pro", "milb-aaa", "milb-high-a-aa", "milb-rookie-low-a"],
  );
  for (const r of empty) assert.equal(r.confidence, null);
});

test("every range's sources exist", () => {
  const known = new Set(veloSeedData.sources.map((s) => s.slug));
  for (const r of veloSeedData.ranges)
    for (const slug of r.source_slugs)
      assert.ok(known.has(slug), `${r.slug} cites '${slug}', which is not a source`);
});

test("display order is unique and complete", () => {
  const orders = veloSeedData.ranges.map((r) => r.display_order).sort((a, b) => a - b);
  assert.deepEqual(orders, Array.from({ length: 25 }, (_, i) => i + 1));
});

test("row types are only the three the spec defines", () => {
  for (const r of veloSeedData.ranges)
    assert.ok(["primary", "anchor", "secondary"].includes(r.row_type), r.slug);
});

test("the seed upserts by slug rather than inserting blindly", () => {
  assert.match(VELO_SEED_SQL, /INSERT INTO velo_sources[\s\S]*?ON CONFLICT \(slug\) DO UPDATE/);
  assert.match(VELO_SEED_SQL, /INSERT INTO velo_ranges[\s\S]*?ON CONFLICT \(slug\) DO UPDATE/);
});

test("the seed deletes nothing", () => {
  /*
   * The spec is explicit: do not remove rows missing from the file unless a
   * prune flag is passed, and there is no prune flag. A DELETE here would
   * silently drop a row Cole had added in Notion and not yet re-exported.
   */
  assert.ok(!/DELETE FROM velo_/i.test(VELO_SEED_SQL));
});

test("an apostrophe in the source text does not break the SQL", () => {
  /*
   * The notes contain "50-55 is right on track" with quotes, and several rows
   * use apostrophes. Naive concatenation produces SQL that will not parse.
   */
  assert.ok(VELO_SEED_SQL.includes("right on track"));
  const singles = (VELO_SEED_SQL.match(/'/g) ?? []).length;
  assert.equal(singles % 2, 0, "an unbalanced quote means an unescaped apostrophe");
});

test("the snapshot date is exposed for the UI to show", () => {
  assert.equal(veloSnapshotDate(), "2026-09-28");
});
```

Append to `lib/schema.test.ts`:

```ts
test("the velo benchmark tables and their join table exist", () => {
  const sql = schemaFile();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS velo_sources/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS velo_ranges/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS velo_range_sources/);
});

test("velocity columns are nullable, because four rows have no data yet", () => {
  /*
   * A NOT NULL with a 0 default would turn "nobody has sourced this" into
   * "this level throws 0 mph", which the UI cannot tell apart.
   */
  const sql = schemaFile();
  const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS velo_ranges"));
  const body = table.slice(0, table.indexOf(");"));
  for (const col of ["rhp_low", "rhp_high", "lhp_low", "lhp_high", "combined_low", "combined_high", "elite_trajectory_ref"])
    assert.ok(!new RegExp(`${col}[^,]*NOT NULL`).test(body), `${col} is NOT NULL`);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test lib/veloSeed.test.ts lib/schema.test.ts`
Expected: FAIL, cannot find module `@/lib/veloSeed`.

- [ ] **Step 3: Write the seed module**

Create `lib/veloSeed.ts`. It reads the JSON at module load and generates SQL.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The benchmark snapshot, and the SQL that seeds it
 *
 * SERVER ONLY. Nothing in components/ may import this file, and
 * lib/clientSafe.test.ts enforces that. The whole point of this feature is
 * that athletes never receive these numbers, and a value import into a client
 * component would ship all 25 rows to every browser that loads the app.
 *
 * Notion is the source of truth. This is a dated snapshot of it, re-exported
 * by hand. The seed upserts by slug so a newer export updates rows in place,
 * and deletes nothing: a row missing from the file is far more likely to be a
 * partial export than a deliberate removal.
 * ------------------------------------------------------------------ */

export interface VeloSourceSeed {
  slug: string;
  title: string;
  author: string;
  data_type: string;
  quality: string;
  limitations_summary: string;
  notion_url: string;
  published_date: string | null;
}

export interface VeloRangeSeed {
  slug: string;
  level: string;
  category: string;
  row_type: string;
  rhp_low: number | null;
  rhp_high: number | null;
  lhp_low: number | null;
  lhp_high: number | null;
  combined_low: number | null;
  combined_high: number | null;
  elite_trajectory_ref: number | null;
  confidence: string | null;
  source_slugs: string[];
  notes: string;
  last_updated: string | null;
  notion_url: string;
  display_order: number;
}

interface VeloSeedFile {
  meta: { snapshot_date: string };
  sources: VeloSourceSeed[];
  ranges: VeloRangeSeed[];
}

export const veloSeedData: VeloSeedFile = JSON.parse(
  readFileSync(join(process.cwd(), "db", "velo-ladder-seed-data.json"), "utf8"),
);

/** Shown in the UI as "Data snapshot", so a coach knows how old this is. */
export function veloSnapshotDate(): string {
  return veloSeedData.meta.snapshot_date;
}

/** Single-quote escaping for a SQL literal, or NULL. */
const q = (v: string | null): string =>
  v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
const n = (v: number | null): string => (v === null ? "NULL" : String(v));

const sourceRows = veloSeedData.sources
  .map(
    (s) =>
      `INSERT INTO velo_sources (slug, title, author, data_type, quality, published_date, limitations_summary, notion_url) VALUES (${q(s.slug)}, ${q(s.title)}, ${q(s.author)}, ${q(s.data_type)}, ${q(s.quality)}, ${s.published_date === null ? "NULL" : `${q(s.published_date)}::date`}, ${q(s.limitations_summary)}, ${q(s.notion_url)}) ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, author = EXCLUDED.author, data_type = EXCLUDED.data_type, quality = EXCLUDED.quality, published_date = EXCLUDED.published_date, limitations_summary = EXCLUDED.limitations_summary, notion_url = EXCLUDED.notion_url;`,
  )
  .join("\n");

const rangeRows = veloSeedData.ranges
  .map(
    (r) =>
      `INSERT INTO velo_ranges (slug, level, category, row_type, display_order, rhp_low, rhp_high, lhp_low, lhp_high, combined_low, combined_high, elite_trajectory_ref, confidence, notes, last_updated, notion_url) VALUES (${q(r.slug)}, ${q(r.level)}, ${q(r.category)}, ${q(r.row_type)}, ${r.display_order}, ${n(r.rhp_low)}, ${n(r.rhp_high)}, ${n(r.lhp_low)}, ${n(r.lhp_high)}, ${n(r.combined_low)}, ${n(r.combined_high)}, ${n(r.elite_trajectory_ref)}, ${q(r.confidence)}, ${q(r.notes)}, ${r.last_updated === null ? "NULL" : `${q(r.last_updated)}::date`}, ${q(r.notion_url)}) ON CONFLICT (slug) DO UPDATE SET level = EXCLUDED.level, category = EXCLUDED.category, row_type = EXCLUDED.row_type, display_order = EXCLUDED.display_order, rhp_low = EXCLUDED.rhp_low, rhp_high = EXCLUDED.rhp_high, lhp_low = EXCLUDED.lhp_low, lhp_high = EXCLUDED.lhp_high, combined_low = EXCLUDED.combined_low, combined_high = EXCLUDED.combined_high, elite_trajectory_ref = EXCLUDED.elite_trajectory_ref, confidence = EXCLUDED.confidence, notes = EXCLUDED.notes, last_updated = EXCLUDED.last_updated, notion_url = EXCLUDED.notion_url;`,
  )
  .join("\n");

const joinRows = veloSeedData.ranges
  .flatMap((r) =>
    r.source_slugs.map(
      (s) =>
        `INSERT INTO velo_range_sources (range_slug, source_slug) VALUES (${q(r.slug)}, ${q(s)}) ON CONFLICT (range_slug, source_slug) DO NOTHING;`,
    ),
  )
  .join("\n");

export const VELO_SEED_SQL = [sourceRows, rangeRows, joinRows].join("\n");
```

- [ ] **Step 4: Add the tables to the schema**

In `lib/schema.ts`, import `VELO_SEED_SQL` from `./veloSeed`, add the tables after the existing ones, and interpolate the seed the way `LIFT_SEED_SQL` is interpolated:

```sql
-- v28: the coach-only fastball velocity benchmark ladder.
--
-- Notion is the source of truth; these tables hold a dated snapshot that Cole
-- re-exports by hand. Every velocity column is nullable because four rows
-- (Independent Pro and the three MiLB tiers) have no sourced data yet, and a
-- 0 default would turn "nobody has looked this up" into "this level throws 0".
CREATE TABLE IF NOT EXISTS velo_sources (
  slug                text PRIMARY KEY,
  title               text NOT NULL,
  author              text NOT NULL DEFAULT '',
  data_type           text NOT NULL DEFAULT '',
  quality             text NOT NULL DEFAULT '',
  published_date      date,
  limitations_summary text NOT NULL DEFAULT '',
  notion_url          text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS velo_ranges (
  slug                 text PRIMARY KEY,
  level                text NOT NULL,
  category             text NOT NULL,
  row_type             text NOT NULL DEFAULT 'primary',
  display_order        integer NOT NULL DEFAULT 0,
  rhp_low              numeric,
  rhp_high             numeric,
  lhp_low              numeric,
  lhp_high             numeric,
  combined_low         numeric,
  combined_high        numeric,
  elite_trajectory_ref numeric,
  confidence           text,
  notes                text NOT NULL DEFAULT '',
  last_updated         date,
  notion_url           text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS velo_range_sources (
  range_slug  text NOT NULL REFERENCES velo_ranges(slug) ON DELETE CASCADE,
  source_slug text NOT NULL REFERENCES velo_sources(slug) ON DELETE CASCADE,
  PRIMARY KEY (range_slug, source_slug)
);
```

Then change line 10 to `export const SCHEMA_VERSION = 28;`.

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test lib/veloSeed.test.ts lib/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the seed on a database that already has rows**

Write this to a scratch file OUTSIDE the repo, run it, delete it. Use a fresh `PGLITE_DIR`; PGlite is single-writer and will hang rather than error if something else holds the directory.

```js
process.env.USE_PGLITE = "1";
process.env.PGLITE_DIR = "/tmp/vl-velo-upgrade";
const { execScript, sql } = await import("/ABSOLUTE/PATH/lib/db.ts");
const { schemaFile } = await import("/ABSOLUTE/PATH/lib/schema.ts");

// A database as it stands BEFORE this version: no velo tables at all.
const before = schemaFile()
  .replace(/CREATE TABLE IF NOT EXISTS velo_[\s\S]*?\);/g, "")
  .replace(/INSERT INTO velo_[^\n]*\n?/g, "");
await execScript(before);
await execScript(schemaFile());
console.log("counts:", JSON.stringify(await sql`
  SELECT (SELECT count(*)::int FROM velo_sources) AS sources,
         (SELECT count(*)::int FROM velo_ranges) AS ranges,
         (SELECT count(*)::int FROM velo_range_sources) AS links`));

// A coach corrects a note in the app; a re-seed must not silently revert it.
// It SHOULD, because Notion is the source of truth and the upsert is how a
// correction there reaches here. Confirm which happens and report it.
await sql`UPDATE velo_ranges SET notes = 'EDITED' WHERE slug = '13u'`;
await execScript(schemaFile());
console.log("after re-seed:", JSON.stringify(await sql`SELECT notes FROM velo_ranges WHERE slug = '13u'`));
console.log("counts again:", JSON.stringify(await sql`SELECT count(*)::int AS n FROM velo_ranges`));

// Spot-check three rows against the JSON, per the spec's definition of done.
console.log(JSON.stringify(await sql`
  SELECT slug, combined_low, combined_high, rhp_low, rhp_high, elite_trajectory_ref, confidence
    FROM velo_ranges WHERE slug IN ('13u','juco','ncaa-d1-power-4') ORDER BY slug`));
```

Expected: 11 sources, 25 ranges, 68 links (counted from the JSON: the sum of every row's `source_slugs`). Re-running does not duplicate (still 25). The three spot-checked rows match the JSON exactly: 13U combined 55-75 ref 72 High; JUCO RHP 82-90 Medium; D1 Power 4 RHP 90-97 Medium.

Report what happened to the edited note. The upsert overwrites it, which is correct — Notion is the source of truth and this is how a correction there lands — but say so explicitly in your report so Cole knows editing in the database does not stick.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify && git add lib/veloSeed.ts lib/veloSeed.test.ts lib/schema.ts lib/schema.test.ts db/schema.sql && git commit -m "Schema v28: the velo benchmark ladder, seeded from the Notion snapshot"
```

`db/schema.sql` is regenerated from `lib/schema.ts` and `lib/schemaFile.test.ts` byte-compares them, so it belongs in this commit.

---

### Task 2: Server-only loader and coach-only routes

**Files:**
- Create: `lib/veloTypes.ts`, `lib/veloData.ts`
- Create: `app/api/velo/ranges/route.ts`, `app/api/velo/sources/route.ts`
- Test: `lib/veloRoute.test.ts` (create)

**Interfaces:**
- Consumes: `getScope` from `lib/scope.ts`; `sql` from `lib/db.ts`; `json`, `unauthorized`, `forbidden`, `guard` from `lib/http.ts`.
- Produces:
  - `lib/veloTypes.ts`: `interface VeloBand { kind: "RHP" | "LHP" | "Combined"; low: number; high: number; midpoint: number }`, `interface VeloRange { slug, level, category, rowType: "primary" | "anchor" | "secondary", displayOrder: number, rhpLow, rhpHigh, lhpLow, lhpHigh, combinedLow, combinedHigh, eliteTrajectoryRef: number | null (all bands `number | null`), confidence: string | null, notes: string, lastUpdated: string | null, notionUrl: string, sourceSlugs: string[] }`, `interface VeloSource { slug, title, author, dataType, quality, publishedDate: string | null, limitationsSummary, notionUrl }`
  - `lib/veloData.ts`: `listVeloRanges(): Promise<VeloRange[]>`, `listVeloSources(): Promise<VeloSource[]>`
  - `GET /api/velo/ranges`, `GET /api/velo/sources`, both coach-only.

**Read `app/api/screens/overview/route.ts` first.** It is a coach-only GET and is the pattern: `getScope()`, `if (!scope) return unauthorized()`, `if (scope.role !== "coach") return forbidden()`, then `guard(...)`. Match it exactly, including the `runtime` and `dynamic` exports. `await params` is the current Next convention where params exist; these routes have none.

`lib/veloTypes.ts` contains ONLY types and interfaces, no values. TypeScript erases it, so a client component may import a type from it without pulling anything into the bundle. `lib/veloData.ts` imports `lib/db.ts` and must never be imported by a client component.

**Cache headers.** The spec requires responses not be cached in a way that could serve one user's view to another. Read how the existing coach-only routes handle this. If they set nothing, add `Cache-Control: private, no-store` to these two responses and say in your report that you added it, since this data is role-gated in a way the others' data is not.

- [ ] **Step 1: Write the failing test**

Create `lib/veloRoute.test.ts`, following `lib/deliveryRoute.test.ts` for how this repo exercises real handlers with a real database and a mocked scope:

```ts
test("an athlete cannot read the ladder", async () => {
  // signed in as a non-coach email; GET /api/velo/ranges
  assert.equal(res.status, 403);
});

test("an athlete cannot read the sources", async () => {
  assert.equal(res.status, 403);
});

test("a signed-out request is refused before anything is read", async () => {
  // no session at all
  assert.equal(res.status, 401);
});

test("a coach gets all 25 rows in display order", async () => {
  const rows = await res.json();
  assert.equal(rows.length, 25);
  assert.deepEqual([...rows].sort((a, b) => a.displayOrder - b.displayOrder), rows);
});

test("a coach gets all 11 sources", async () => {
  assert.equal((await res.json()).length, 11);
});

test("a row with no data comes back with nulls, not zeros", async () => {
  /*
   * The UI must be able to render "No data yet". A 0 would render as a real
   * benchmark of zero miles an hour.
   */
  const row = rows.find((r) => r.slug === "milb-aaa");
  assert.equal(row.combinedLow, null);
  assert.equal(row.rhpLow, null);
  assert.equal(row.confidence, null);
});

test("each row carries its own source slugs", async () => {
  const row = rows.find((r) => r.slug === "13u");
  assert.equal(row.sourceSlugs.length, 7);
});
```

Fill each in using the real helpers in `lib/deliveryRoute.test.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test lib/veloRoute.test.ts`
Expected: FAIL, the routes do not exist.

- [ ] **Step 3: Write the types and the loader**

`lib/veloTypes.ts` holds the three interfaces above and nothing else.

`lib/veloData.ts`:

```ts
import { sql } from "./db";
import type { VeloRange, VeloSource } from "./veloTypes";

/* ------------------------------------------------------------------ *
 * Reading the benchmark ladder
 *
 * SERVER ONLY. A client component importing anything from this file pulls the
 * Postgres driver into the browser bundle, which has already broken a build in
 * this repo once, and would ship coach-only benchmarks to every athlete.
 * lib/clientSafe.test.ts enforces it.
 *
 * Numbers come back from pg as strings for a numeric column, so every band is
 * parsed explicitly. A null stays null: four rows have no sourced data and the
 * UI must render "No data yet" rather than a zero.
 * ------------------------------------------------------------------ */

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function listVeloRanges(): Promise<VeloRange[]> {
  const rows = (await sql`
    SELECT r.*, COALESCE(
             (SELECT array_agg(s.source_slug ORDER BY s.source_slug)
                FROM velo_range_sources s WHERE s.range_slug = r.slug),
             '{}') AS source_slugs
      FROM velo_ranges r
     ORDER BY r.display_order
  `) as Record<string, unknown>[];

  return rows.map((r) => ({
    slug: String(r.slug),
    level: String(r.level),
    category: String(r.category),
    rowType: String(r.row_type) as VeloRange["rowType"],
    displayOrder: Number(r.display_order),
    rhpLow: num(r.rhp_low),
    rhpHigh: num(r.rhp_high),
    lhpLow: num(r.lhp_low),
    lhpHigh: num(r.lhp_high),
    combinedLow: num(r.combined_low),
    combinedHigh: num(r.combined_high),
    eliteTrajectoryRef: num(r.elite_trajectory_ref),
    confidence: (r.confidence as string | null) ?? null,
    notes: String(r.notes ?? ""),
    lastUpdated: r.last_updated ? String(r.last_updated).slice(0, 10) : null,
    notionUrl: String(r.notion_url ?? ""),
    sourceSlugs: (r.source_slugs ?? []) as string[],
  }));
}

export async function listVeloSources(): Promise<VeloSource[]> {
  const rows = (await sql`SELECT * FROM velo_sources ORDER BY title`) as Record<string, unknown>[];
  return rows.map((s) => ({
    slug: String(s.slug),
    title: String(s.title),
    author: String(s.author ?? ""),
    dataType: String(s.data_type ?? ""),
    quality: String(s.quality ?? ""),
    publishedDate: s.published_date ? String(s.published_date).slice(0, 10) : null,
    limitationsSummary: String(s.limitations_summary ?? ""),
    notionUrl: String(s.notion_url ?? ""),
  }));
}
```

- [ ] **Step 4: Write the two routes**

Both follow `app/api/screens/overview/route.ts` exactly. For example:

```ts
import { getScope } from "@/lib/scope";
import { listVeloRanges } from "@/lib/veloData";
import { json, unauthorized, forbidden, guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coach only, enforced here rather than in the UI.
 *
 * This is the whole point of the feature: an athlete or a parent must never
 * receive these numbers, and hiding a nav link does not achieve that.
 */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();
  return guard(async () => json(await listVeloRanges()), "Loading the velo ladder failed");
}
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test lib/veloRoute.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Mutation-test the gate**

Remove `if (scope.role !== "coach") return forbidden();` from the ranges route. Run the test file.
Expected: FAIL on "an athlete cannot read the ladder". Restore, confirm green. Repeat for the sources route.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify && git add lib/veloTypes.ts lib/veloData.ts app/api/velo lib/veloRoute.test.ts && git commit -m "Coach-only routes for the velo ladder and its sources"
```

---

### Task 3: The placement classifier

**Files:**
- Create: `lib/veloConfig.ts`, `lib/veloPlacement.ts`
- Test: `lib/veloPlacement.test.ts` (create)

**Interfaces:**
- Consumes: `VeloRange`, `VeloBand` from `lib/veloTypes.ts` (types only).
- Produces:
  - `lib/veloConfig.ts`: `OUTLIER_BUFFER_MPH = 3`, `PEAK_GAP_FLAG_MPH = 4`, `NOTABLY_BEHIND_BUFFER_MPH = 5`, `FATIGUE_GAP_FLAG_MPH = 6`, `MIN_MPH = 30`, `MAX_MPH = 110`
  - `lib/veloPlacement.ts`: `type Placement = "OUTLIER_ELITE_TRAJECTORY" | "OUTLIER_ABOVE_RANGE" | "ABOVE_AVERAGE" | "AVERAGE_UPPER_HALF" | "AVERAGE_LOWER_HALF" | "BELOW_AVERAGE" | "NOTABLY_BEHIND" | "NO_DATA"`; `type PlacementFlag = "PROJECTABILITY_GAP" | "FATIGUE_OR_CONSISTENCY" | "PEAK_ABOVE_BAND"`; `bandFor(range, hand): VeloBand | null`; `evaluate(input): PlacementResult | PlacementError`

This module is PURE. No React, no fetch, no database, no imports from `lib/veloData.ts`. That is what makes it testable and what the spec asks for.

**The classification order, with the 13U cap the decisions addendum settled.** Using sitting (average) velocity, first match wins:

1. Row has `eliteTrajectoryRef` AND `sitting >= eliteTrajectoryRef` AND `sitting > band.high` → `OUTLIER_ELITE_TRAJECTORY`
2. Row has NO `eliteTrajectoryRef` AND `sitting >= band.high + OUTLIER_BUFFER_MPH` → `OUTLIER_ABOVE_RANGE`
3. `sitting > band.high` → `ABOVE_AVERAGE`
4. `sitting >= band.low` → `AVERAGE_UPPER_HALF` if `sitting >= midpoint`, else `AVERAGE_LOWER_HALF`
5. `sitting <= band.low - NOTABLY_BEHIND_BUFFER_MPH` → `NOTABLY_BEHIND`
6. otherwise → `BELOW_AVERAGE`

Rule 1's second condition is the cap. Without it a 13-year-old sitting 73 is called elite while inside his own 55-75 band, because that row's ref (72) is below its high (75). Never use the word "outlier" for the low side.

**Band selection:** RHP band if hand is R and RHP bounds exist; LHP band if hand is L and LHP bounds exist; else Combined; else `NO_DATA` and do not guess. If a hand was given but the row only has Combined, use Combined and add the note "Sources for this row do not split by hand."

**Validation:** all three inputs numeric; `floor <= sitting <= peak`; each between `MIN_MPH` and `MAX_MPH`. Hand required when the row has hand-specific bands. Reject `anchor` and `secondary` rows as not classifiable.

**Flags** (informational, never change the classification): `PROJECTABILITY_GAP` if `peak - sitting >= PEAK_GAP_FLAG_MPH`; `FATIGUE_OR_CONSISTENCY` if `sitting - floor >= FATIGUE_GAP_FLAG_MPH`; `PEAK_ABOVE_BAND` if `peak > band.high`.

**Disclosures**, returned as an array of strings, verbatim:

- Always: `Row confidence: {confidence}. This placement is only as certain as that rating.`
- Always: `Percentile-based outlier claims are only defensible for 13U and 18U (Eisenmann data). Elsewhere, "outlier" is a judgment call against a typical-range band, not a statistical claim.`
- On `OUTLIER_ABOVE_RANGE`: `The outlier line here is High + {buffer} mph, an adjustable judgment call.`
- On `OUTLIER_ELITE_TRAJECTORY`: `The elite reference reflects the teenage velocity of pitchers who reached MLB; that sample skews toward tall, early-maturing pitchers.`
- On `NOTABLY_BEHIND` or `BELOW_AVERAGE`: `Sitting below the range is common with late development and is not a red flag by itself.`

- [ ] **Step 1: Write the failing tests**

Create `lib/veloPlacement.test.ts`. These are the spec's pinned cases plus the two the decisions addendum adds. Build each `VeloRange` fixture from the real values in `db/velo-ladder-seed-data.json`; do not invent bands.

```ts
/* ------------------------------------------------------------------ *
 * Placing a session against the ladder
 *
 * Pinned from the spec's table. The numbers are Cole's benchmarks, not this
 * module's to adjust: if a case here fails, the classifier is wrong, not the
 * expectation.
 * ------------------------------------------------------------------ */

test("1: 16U, 74/79/83, sits in the upper half with a projectability gap", () => {
  // 16U Combined 69-85, midpoint 77, ref 89, Medium
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
  assert.deepEqual(r.band, { kind: "Combined", low: 69, high: 85, midpoint: 77 });
  assert.equal(r.confidence, "Medium");
  assert.deepEqual(r.flags, ["PROJECTABILITY_GAP"]);
});

test("2: JUCO RHP, 84/88/91, upper half with the peak above the band", () => {
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
  assert.deepEqual(r.band, { kind: "RHP", low: 82, high: 90, midpoint: 86 });
  assert.deepEqual(r.flags, ["PEAK_ABOVE_BAND"]);
});

test("3: 16U, 85/89/92, is elite trajectory at exactly the reference", () => {
  // 89 >= ref 89 AND 89 > high 85, so the cap does not block it
  assert.equal(r.placement, "OUTLIER_ELITE_TRAJECTORY");
});

test("4: JUCO RHP, sitting 91 is above average and 93 is an outlier", () => {
  assert.equal(at(91).placement, "ABOVE_AVERAGE");
  assert.equal(at(93).placement, "OUTLIER_ABOVE_RANGE"); // high 90 + buffer 3
});

test("5: 16U at 68 and 65 is below average, at 64 notably behind", () => {
  // low 69, buffer 5, so the line is 64
  assert.equal(at(68).placement, "BELOW_AVERAGE");
  assert.equal(at(65).placement, "BELOW_AVERAGE");
  assert.equal(at(64).placement, "NOTABLY_BEHIND");
});

test("6: D1 Power 4 at 92 reads differently for a lefty and a righty", () => {
  // LHP 88-94 midpoint 91 -> upper; RHP 90-97 midpoint 93.5 -> lower
  assert.equal(left.placement, "AVERAGE_UPPER_HALF");
  assert.equal(right.placement, "AVERAGE_LOWER_HALF");
});

test("7: MiLB AAA has no data and is not classified", () => {
  assert.equal(r.placement, "NO_DATA");
});

test("8: a lefty on a 16U row uses Combined and says the sources do not split", () => {
  assert.equal(r.band.kind, "Combined");
  assert.ok(r.notes.some((n) => n.includes("do not split by hand")));
});

test("9: D1 Power 4 with no hand is a validation error", () => {
  assert.equal(r.ok, false);
  assert.match(r.error, /hand/i);
});

test("10: the Rapsodo anchor and a Go Big tier are not classifiable", () => {
  assert.equal(anchor.ok, false);
  assert.equal(secondary.ok, false);
});

test("11: a peak below the average is a validation error", () => {
  assert.equal(r.ok, false);
});

test("12: 13U at 73 is inside his band, so he is NOT called elite", () => {
  /*
   * 13U's elite ref (72) sits BELOW its own band high (75). Without the cap
   * this reads as elite trajectory while the pitcher is squarely inside the
   * normal range for his age. Cole capped it: being at the top of normal is
   * not elite.
   */
  assert.equal(r.placement, "AVERAGE_UPPER_HALF"); // band 55-75, midpoint 65
});

test("13U at 75, the very top of the band, is still not elite", () => {
  assert.equal(r.placement, "AVERAGE_UPPER_HALF");
});

test("13U at 76 IS elite, so the cap is a cap and not a removal", () => {
  assert.equal(r.placement, "OUTLIER_ELITE_TRAJECTORY");
});

test("a velocity outside 30 to 110 is refused", () => {
  assert.equal(at(120).ok, false);
  assert.equal(at(20).ok, false);
});

test("every result carries the row's confidence and the percentile disclosure", () => {
  assert.ok(r.disclosures.some((d) => d.includes("only as certain as that rating")));
  assert.ok(r.disclosures.some((d) => d.includes("only defensible for 13U and 18U")));
});

test("a below-average result says late development is not a red flag", () => {
  assert.ok(r.disclosures.some((d) => d.includes("not a red flag by itself")));
});

test("the low side is never called an outlier", () => {
  /*
   * The guide is explicit. Several sources say sitting below the range is
   * normal, and outlier language risks pathologising a late developer.
   */
  const all = [at(64), at(65), at(68)];
  for (const r of all)
    for (const text of [r.label, ...r.disclosures])
      assert.ok(!/outlier/i.test(text), text);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test lib/veloPlacement.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the config and the classifier**

`lib/veloConfig.ts` holds the six constants with a comment on each saying where the number came from: 3 and 4 from the scoring guide, 5 and 6 confirmed by Cole on 2026-09-28, 30 and 110 as the sanity bounds from the spec.

`lib/veloPlacement.ts` implements `bandFor` and `evaluate` per the rules above. Keep every disclosure string in one exported constant so the test can assert against the same text the UI renders, rather than a copy that can drift.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test lib/veloPlacement.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-test the cap and the buffer**

Delete `&& sitting > band.high` from rule 1. Run the tests.
Expected: FAIL on "13U at 73 is inside his band" and "13U at 75". Restore.

Change `NOTABLY_BEHIND_BUFFER_MPH` to 3. Expected: FAIL on case 5 at 65. Restore.

Reverse rules 1 and 3 so `ABOVE_AVERAGE` is checked first. Expected: FAIL on case 3. Restore, confirm green.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add lib/veloConfig.ts lib/veloPlacement.ts lib/veloPlacement.test.ts && git commit -m "Place a session against the ladder, with the 13U elite check capped"
```

---

### Task 4: The ladder page and the sources view

**Files:**
- Create: `app/velo/page.tsx`, `components/VeloLadder.tsx`, `components/VeloSources.tsx`
- Modify: `components/AppHeader.tsx` (the coach link list at line 19)
- Test: `components/VeloLadder.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/velo/ranges`, `GET /api/velo/sources`; `VeloRange`, `VeloSource` from `lib/veloTypes.ts` (TYPE imports only).

**The snapshot date:** `veloSnapshotDate()` lives in `lib/veloSeed.ts`, which is server-only and reads the JSON off disk, so a client component cannot import it. Resolve it in `app/velo/page.tsx`, which is a server component, and pass it to `<VeloLadder snapshotDate={...} />` as a prop. Do NOT add it to the `/api/velo/ranges` response: Task 2's tests assert that route returns a bare array of 25 rows, and wrapping it in an object to carry one string would break them for no gain.

**Read `components/TestsView.tsx` first** for how a coach-only page is composed here: the SWR fetch, the `/api/me` role check, the card and table markup, and the badge classes. Read `components/StrengthStandards.tsx` for how a reference table with bands is laid out. Match those rather than inventing a third style.

**The nav entry goes in the coach array only** — `components/AppHeader.tsx` already splits its links by role, so add `{ href: "/velo", label: "Velo Ladder" }` to the `isCoach` list and to neither of the others.

What the ladder renders:
- Grouped by category in `displayOrder`: Youth (8U-12U), Youth (13U-14U), High School, College, Independent/Pro, Affiliated MiLB/MLB.
- Columns: Level, band (RHP and LHP when present, else Combined), Elite Ref (13U-18U only), Confidence badge, source count.
- A row with no band renders **No data yet**. Never 0, never blank.
- `anchor` and `secondary` rows are visibly marked reference-only and read as not classifiable.
- Row detail on expand: the notes, and each source with its quality badge and Notion link.
- A legend explaining the four confidence levels.
- The banner, verbatim: `Coach-only. Benchmarks are directional; check the Confidence rating before relying on a placement.`
- The snapshot date, labelled `Data snapshot`.

- [ ] **Step 1: Write the failing tests**

Append to `components/VeloLadder.test.tsx`, using the real helpers from `components/testRender.tsx` and following `components/TestsView.test.tsx` for how a coach-only view is rendered with a mocked SWR map:

```tsx
test("every category and all 25 rows render, in display order", () => {
  // assert the six category headings appear and 25 level cells render
});

test("a row with no sourced data says so instead of showing a number", () => {
  // MiLB AAA
  assert.match(document.body.textContent!, /no data yet/i);
  assert.doesNotMatch(document.body.textContent!, /MiLB — AAA[^]*?\b0\b/);
});

test("a hand-split row shows both bands, a combined row shows one", () => {
  // JUCO shows RHP 82-90 and LHP 80-87; 16U shows 69-85 with no RHP/LHP label
});

test("the elite reference only appears on the 13U to 18U rows", () => {
  // present on 16u-hs-jv-soph, absent on juco
});

test("the anchor and secondary rows are marked reference-only", () => {
  // Rapsodo anchor and the three Go Big tiers carry a visible marker
});

test("the banner and the snapshot date are both shown", () => {
  assert.match(document.body.textContent!, /check the Confidence rating/i);
  assert.match(document.body.textContent!, /2026-09-28|Sep 28, 2026/);
});

test("an athlete never renders the ladder at all", () => {
  // me.role === "athlete": the component renders nothing of substance
  assert.doesNotMatch(document.body.textContent!, /Elite Trajectory|69-85/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/VeloLadder.test.tsx`
Expected: FAIL, no such module.

- [ ] **Step 3: Build the page, the table and the sources view**

`app/velo/page.tsx` is a thin server page that renders the client component, matching how `app/tests/page.tsx` does it.

`components/VeloSources.tsx` lists all 11 sources with quality badge, data type, published date and the limitations summary, each linking to Notion. Put it behind a tab or a section on the same page, whichever matches how this app already handles a secondary view.

Import types from `lib/veloTypes.ts` with `import type`. Do NOT import `lib/veloData.ts` or `lib/veloSeed.ts` anywhere under `components/` or `app/**/page.tsx` — `lib/clientSafe.test.ts` will fail the build if you do, which is the point.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test components/VeloLadder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the no-data rendering**

Make the empty-band branch render the raw value instead of "No data yet". Run the tests.
Expected: FAIL on "a row with no sourced data says so". Restore.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add app/velo components/VeloLadder.tsx components/VeloSources.tsx components/VeloLadder.test.tsx components/AppHeader.tsx app/globals.css && git commit -m "The velo ladder and its sources, coach only"
```

---

### Task 5: The scoring guide

**Files:**
- Create: `lib/miniMarkdown.ts`, `app/velo/guide/page.tsx`
- Test: `lib/miniMarkdown.test.ts` (create)

**Interfaces:**
- Produces: `renderMarkdown(src: string): MarkdownNode[]` where `MarkdownNode` is a discriminated union of `{ kind: "heading"; level: 1 | 2 | 3; text: string }`, `{ kind: "paragraph"; text: string }`, `{ kind: "list"; items: string[] }`, `{ kind: "table"; header: string[]; rows: string[][] }`.

The guide at `content/evaluation-scoring-guide.md` stays a content asset so Cole can edit the text without touching code. It uses exactly five constructs: headings, bold inline, unordered lists, tables, and paragraphs. The renderer handles those five and nothing else.

**Why not `react-markdown`:** the spec says add no dependency unless necessary. Two packages to render one static document is not necessary, this app has no UI dependencies at all beyond React and SWR, and a renderer that only handles what this file contains cannot silently mis-render something it was never given.

Bold is the one inline construct: render `**text**` as `<strong>`. Do not attempt links, code, images, or nested lists; the guide has none. If a future edit adds one, it renders as literal text rather than breaking, and that is the right failure.

- [ ] **Step 1: Write the failing tests**

```ts
test("a heading becomes a heading at its level", () => {
  assert.deepEqual(renderMarkdown("## The Process"), [
    { kind: "heading", level: 2, text: "The Process" },
  ]);
});

test("a table keeps its header and its rows", () => {
  const md = "| Where | Call it |\n|---|---|\n| Below | Below average |";
  assert.deepEqual(renderMarkdown(md), [
    { kind: "table", header: ["Where", "Call it"], rows: [["Below", "Below average"]] },
  ]);
});

test("a dash list becomes a list", () => {
  assert.deepEqual(renderMarkdown("- one\n- two"), [
    { kind: "list", items: ["one", "two"] },
  ]);
});

test("paragraphs are separated by blank lines, not by newlines", () => {
  const got = renderMarkdown("line one\nstill one\n\nline two");
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, "paragraph");
});

test("the real guide renders without losing a section", () => {
  /*
   * The point of pinning this: Cole edits the guide as text. If an edit uses
   * something the renderer does not handle, that must be visible here rather
   * than as a blank patch on the page.
   */
  const src = readFileSync("content/evaluation-scoring-guide.md", "utf8");
  const nodes = renderMarkdown(src);
  const headings = nodes.filter((n) => n.kind === "heading").map((n) => n.text);
  assert.ok(headings.includes("Evaluation Scoring Guide"));
  assert.ok(headings.includes("Worked Examples"));
  assert.ok(headings.includes("Limitation to disclose every time"));
  assert.equal(nodes.filter((n) => n.kind === "table").length, 1);
});

test("nothing in the guide renders as an empty node", () => {
  const nodes = renderMarkdown(readFileSync("content/evaluation-scoring-guide.md", "utf8"));
  for (const n of nodes)
    if (n.kind === "paragraph" || n.kind === "heading")
      assert.ok(n.text.trim().length > 0, JSON.stringify(n));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test lib/miniMarkdown.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the renderer and the page**

`lib/miniMarkdown.ts` is pure and has no React in it; it returns nodes. The page maps nodes to elements using this app's existing table and text classes.

The guide page is coach-only. Read the guide file server-side in `app/velo/guide/page.tsx` and pass the rendered nodes down, so the markdown file is never fetched by a browser.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test lib/miniMarkdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-test the guide check**

Delete the `| --- |` separator handling so tables parse as paragraphs. Run the tests.
Expected: FAIL on "a table keeps its header" and on the real-guide table count. Restore.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add lib/miniMarkdown.ts lib/miniMarkdown.test.ts app/velo/guide && git commit -m "Render the evaluation scoring guide from its markdown source"
```

---

### Task 6: The placement calculator

**Files:**
- Create: `components/VeloCalculator.tsx`
- Modify: `components/VeloLadder.tsx` (add the calculator to the page)
- Test: `components/VeloCalculator.test.tsx` (create)

**Interfaces:**
- Consumes: `evaluate`, `bandFor` from `lib/veloPlacement.ts`; `VeloRange` from `lib/veloTypes.ts`.
- Produces: no new exports.

`lib/veloPlacement.ts` is pure and already fully tested, so this task is the UI around it and nothing more. Do NOT reimplement any classification logic here; if something is missing from `evaluate`, that is a finding to report rather than to patch in the component.

What it renders: a level select listing `primary` rows only, with the four empty rows disabled and labelled "No data yet"; an R/L hand toggle; three number inputs for session Low, Average and High; an Evaluate button; a result card; and a "Copy write-up" button.

The result card shows, per the spec: the row's level and category, the band used with its low, high and midpoint, the classification with its coach-facing label, the row's confidence and its sources with quality ratings, the elite reference when present, the narrative flags, and every disclosure string.

Do not save anything. There is no athlete field and no persistence; the spec puts that out of scope.

- [ ] **Step 1: Write the failing tests**

```tsx
test("only primary rows are selectable, and the empty ones are disabled", () => {
  // the Rapsodo anchor and the three Go Big tiers are absent from the select;
  // MiLB AAA is present but disabled and labelled "No data yet"
});

test("evaluating a 16U session shows the placement, the band and the confidence", () => {
  // 74 / 79 / 83 -> upper half of 69-85, Medium
  assert.match(document.body.textContent!, /upper half/i);
  assert.match(document.body.textContent!, /69/);
  assert.match(document.body.textContent!, /Medium/);
});

test("a peak below the average is refused with a message, not a placement", () => {
  assert.match(document.body.textContent!, /high.*(cannot|must)/i);
});

test("the disclosures always appear with a result", () => {
  assert.match(document.body.textContent!, /only as certain as that rating/i);
  assert.match(document.body.textContent!, /only defensible for 13U and 18U/i);
});

test("a hand-split row demands a hand", () => {
  // D1 Power 4 with no hand selected: a validation message, no placement
});

test("the write-up copies the placement, the confidence and the disclosures", () => {
  // click Copy write-up, assert the text handed to the clipboard contains all three
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test components/VeloCalculator.test.tsx`
Expected: FAIL, no such module.

- [ ] **Step 3: Build it**

Follow how `components/ScreenModal.tsx` handles a form with validation and an error line, and how this app already renders a badge.

For "Copy write-up", read whether this repo already has a clipboard helper (the CSV export path may have one). If it does, use it. If not, write the smallest one and note in your report that you added it.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test components/VeloCalculator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the disclosure**

Remove the disclosures from the result card. Run the tests.
Expected: FAIL on "the disclosures always appear with a result". Restore.

This is the assertion that matters most in this task. A placement without its confidence rating and its percentile caveat is the thing the spec says never to ship.

- [ ] **Step 6: Look at it in a browser**

You will need a coach login. Do NOT read the real `COACH_PASSWORD` from `.env.local`. Start the dev server with throwaway values and a fresh `PGLITE_DIR` under the scratchpad, run `/api/setup` against it with the throwaway key, then work through the spec's worked examples: 16U 74/79/83 and JUCO RHP 84/88/91. Both should match the guide's stated calls exactly.

If you cannot drive a browser, say so plainly rather than claiming you did.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify && git add components/VeloCalculator.tsx components/VeloCalculator.test.tsx components/VeloLadder.tsx && git commit -m "Place a session against the ladder from the coach page"
```

---

### Task 7: Prove athletes cannot reach any of it

**Files:**
- Modify: `lib/clientSafe.test.ts`
- Test: `lib/veloLeak.test.ts` (create)

**Interfaces:**
- Consumes: everything built so far.
- Produces: no exports. This task is the spec's section 3 verification, which is the hard requirement the whole feature rests on.

The spec names four sentinel strings: `Elite Trajectory`, `Velocity Ranges`, `velo_ranges`, `Eisenmann`. None may appear in anything an athlete receives.

- [ ] **Step 1: Write the failing tests**

Create `lib/veloLeak.test.ts`:

```ts
/* ------------------------------------------------------------------ *
 * The benchmarks never reach an athlete
 *
 * This is the requirement the feature exists under, and the one that cannot
 * be checked by looking at a screen: the numbers can be absent from every
 * page an athlete sees and still be sitting in the JavaScript their browser
 * downloaded. Hidden is not the same as not sent.
 * ------------------------------------------------------------------ */

const SENTINELS = ["Elite Trajectory", "Velocity Ranges", "velo_ranges", "Eisenmann"];

test("no client component imports the seed or the loader", () => {
  // walk components/ and app/**/*.tsx for value imports of
  // lib/veloSeed or lib/veloData; a `import type` is fine, a value import is not
});

test("the built client bundle contains none of the sentinel strings", () => {
  /*
   * Runs against .next/static after a build. If the build output is not
   * present, FAIL with a message saying to run `npm run build` first — do not
   * skip, because a skipped test here reads as a pass.
   */
});

test("every velo route refuses an athlete", async () => {
  // /api/velo/ranges and /api/velo/sources, athlete scope, both 403
});

test("every velo route refuses a signed-out request", async () => {
  // both 401
});

test("the athlete nav has no velo entry", () => {
  // AppHeader with an athlete role renders no /velo link
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build && npx tsx --test lib/veloLeak.test.ts`
Expected: at least the bundle test fails if anything leaked; the route tests should already pass from Task 2.

- [ ] **Step 3: Fix whatever leaked**

If the bundle test fails, find the import that carried it and break that path. Do not weaken the test. Do not add the sentinel to an allowlist.

- [ ] **Step 4: Extend the existing client-safety test**

`lib/clientSafe.test.ts` already walks client components for value imports of server-only modules. Add `lib/veloSeed` and `lib/veloData` to whatever list it uses, so this is enforced by the test that already exists rather than only by the new one.

- [ ] **Step 5: Run everything**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 6: Mutation-test the leak sweep**

Add `import { veloSeedData } from "@/lib/veloSeed";` to `components/VeloLadder.tsx` and use a value from it. Run `npm run build && npx tsx --test lib/veloLeak.test.ts lib/clientSafe.test.ts`.
Expected: FAIL on both the client-safety test and the bundle sentinel test. Restore, rebuild, confirm green.

This mutation is the one that proves the feature's central promise. Report its exact output.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify && git add lib/veloLeak.test.ts lib/clientSafe.test.ts && git commit -m "Prove the benchmarks never reach an athlete"
```

---

## Shipping

Schema changed, so this needs a setup run.

1. Push, wait for Vercel to report Ready, and check the deployment's commit.
2. Visit `https://velo-ladder.vercel.app/api/setup?key=YOUR_SETUP_KEY`. Never ask Cole for that key and never echo it.
3. Check `commit` against what was pushed. If it does not match, nothing else in the response describes the code that is running.
4. Expect `schemaVersion: 28` and `missing: []`.
5. Open `/velo` as the coach. Expect 25 rows, 11 sources, and four rows reading "No data yet".
6. Spot-check 13U, JUCO and NCAA D1 Power 4 against `db/velo-ladder-seed-data.json`.

## Summary to hand Cole when this is done

Write him a short note covering: what was added and where it lives, that the nav entry is coach-only, how to re-seed after a fresh Notion export (replace `db/velo-ladder-seed-data.json`, push, run setup), and how to edit the scoring guide text (`content/evaluation-scoring-guide.md`, no code change needed).

## Self-review notes

Checked against the spec and its decisions addendum:

- Three tables, nullable velocity columns, idempotent upsert by slug, no deletes: Task 1.
- 25 ranges, 11 sources, 4 "No data yet", snapshot date in the UI: Tasks 1 and 4.
- Coach-only enforced server-side on every route; nothing in a shared client bundle; private cache headers: Tasks 2 and 7.
- The three spot-checked rows: Task 1 Step 6 and the shipping checklist.
- Ladder grouped by category with bands, elite ref, confidence badge and source count; row detail; legend; banner; anchor and secondary marked reference-only: Task 4.
- Sources view with quality, data type, date and limitations: Task 4.
- Scoring guide as an editable content asset: Task 5.
- Phase 2 calculator with the spec's UI, validation, band selection, classification order, flags, output and disclosures: Tasks 3 and 6.
- All twelve pinned cases plus the three the 13U cap adds: Task 3.
- The four constants in one config file: Task 3.
- Section 3's verification, including the sentinel strings: Task 7.

Out of scope and absent from every task: Trackman file import, saving evaluations to athlete profiles, pitch types other than fastball, Notion API sync, any athlete-facing view, sourcing the missing pro-level data.

One thing deliberately left to the implementer in Tasks 4, 5 and 6: the exact test helpers in the component test files. This repo's component tests use helpers that a plan written from memory gets wrong, so each task names the real file to copy the setup from instead.
