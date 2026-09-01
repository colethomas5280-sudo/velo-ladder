import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStatements } from "@/lib/db";
import { SCHEMA_SQL, SEED_SQL, SCHEMA_VERSION } from "@/lib/schema";

/* ------------------------------------------------------------------ *
 * The gap these tests close
 *
 * `execScript` has two branches. Production splits the script on top-level
 * semicolons and runs the statements one at a time; local dev hands the whole
 * string to PGlite's `exec`. Only the second was ever exercised.
 *
 * Worse, local PGlite persists to ./.pglite-data, so a local setup run almost
 * always meets a database that already has the tables. `ADD COLUMN IF NOT
 * EXISTS` against an existing table succeeds no matter where it sits in the
 * file — which is how an ALTER ordered before its CREATE TABLE passed locally
 * and would have failed on a fresh database.
 *
 * So each test below applies the real schema to a FRESH in-memory database
 * through the SAME splitting path production uses.
 * ------------------------------------------------------------------ */

type Db = { query: (t: string) => Promise<{ rows: Record<string, unknown>[] }> };

/** A brand-new in-memory Postgres. Never touches ./.pglite-data. */
async function freshDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  return new PGlite() as unknown as Db;
}

/** Apply a script the way production does: split, then one statement at a time. */
async function applyAsProduction(db: Db, script: string): Promise<number> {
  const statements = splitStatements(script);
  for (let i = 0; i < statements.length; i++) {
    try {
      await db.query(statements[i]);
    } catch (e) {
      const first = statements[i].split("\n")[0].slice(0, 120);
      throw new Error(
        `statement ${i + 1}/${statements.length} failed [${first}]: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return statements.length;
}

const tablesIn = async (db: Db): Promise<string[]> =>
  (
    await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    )
  ).rows.map((r) => String(r.table_name));

const columnsOf = async (db: Db, table: string): Promise<string[]> =>
  (
    await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}'
        ORDER BY column_name`,
    )
  ).rows.map((r) => String(r.column_name));

/* ------------------------------------------------------------------ *
 * splitStatements
 * ------------------------------------------------------------------ */

test("splitStatements breaks on top-level semicolons", () => {
  assert.deepEqual(splitStatements("SELECT 1; SELECT 2;"), [
    "SELECT 1",
    "SELECT 2",
  ]);
});

test("splitStatements does not need a trailing semicolon", () => {
  assert.deepEqual(splitStatements("SELECT 1"), ["SELECT 1"]);
});

test("splitStatements keeps a dollar-quoted block whole", () => {
  // The schema's DO block contains its own semicolons. Splitting on those
  // would hand Postgres a torn-in-half block.
  const script = "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$; SELECT 9;";
  const out = splitStatements(script);
  assert.equal(out.length, 2);
  assert.match(out[0], /BEGIN PERFORM 1; PERFORM 2; END/);
  assert.equal(out[1], "SELECT 9");
});

test("splitStatements handles a named dollar tag", () => {
  const out = splitStatements("DO $fn$ BEGIN PERFORM 1; END $fn$; SELECT 2;");
  assert.equal(out.length, 2);
});

test("splitStatements drops comment-only lines and empty chunks", () => {
  const script = `
-- a leading note
SELECT 1;
;
  -- indented note
SELECT 2;
`;
  assert.deepEqual(splitStatements(script), ["SELECT 1", "SELECT 2"]);
});

test("a semicolon inside a line comment does not split the statement", () => {
  /*
   * The regression this suite was written to catch, reduced to one line.
   * A retirement note in the schema read "...keep the same shape; nothing
   * reads it." That semicolon ended a statement, and the rest of the
   * sentence — plain English, no longer behind its `--` — was handed to
   * Postgres as SQL. Setup died on `syntax error at or near "nothing"`,
   * 28 statements short of finishing.
   */
  const script = [
    "ALTER TABLE athletes ADD COLUMN IF NOT EXISTS bats text;",
    "-- Retired. The column stays so databases keep the same shape;",
    "-- nothing reads it.",
    "ALTER TABLE athletes ADD COLUMN IF NOT EXISTS positions text;",
  ].join("\n");
  const out = splitStatements(script);
  assert.equal(out.length, 2, `comment text leaked into SQL: ${JSON.stringify(out)}`);
  assert.match(out[0], /bats text$/);
  assert.match(out[1], /positions text$/);
});

test("a semicolon inside a string literal does not split the statement", () => {
  assert.deepEqual(splitStatements("SELECT 'a;b';"), ["SELECT 'a;b'"]);
});

test("an escaped quote inside a literal does not end it early", () => {
  assert.deepEqual(splitStatements("SELECT 'it''s; fine';"), [
    "SELECT 'it''s; fine'",
  ]);
});

test("a comment cannot open a dollar block or a string", () => {
  // Comments are skipped before either is considered, so stray punctuation in
  // prose stays prose.
  const out = splitStatements("SELECT 1; -- $$ and an ' apostrophe\nSELECT 2;");
  assert.deepEqual(out, ["SELECT 1", "SELECT 2"]);
});

test("every statement the real schema splits into is SQL, not prose", () => {
  // The general form of the bug: whatever the comments say, nothing that is
  // not a statement should reach the database.
  for (const [name, script] of [
    ["SCHEMA_SQL", SCHEMA_SQL],
    ["SEED_SQL", SEED_SQL],
  ] as const) {
    for (const stmt of splitStatements(script)) {
      const head = stmt.split("\n")[0].trim();
      assert.match(
        head,
        /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|DO|COMMENT|SELECT|GRANT|WITH)\b/i,
        `${name} produced a non-statement: ${JSON.stringify(stmt.slice(0, 80))}`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The real schema, on a fresh database, through the production path
 * ------------------------------------------------------------------ */

test("the schema applies to an empty database", async () => {
  const db = await freshDb();
  const n = await applyAsProduction(db, SCHEMA_SQL);
  assert.ok(n > 30, `expected a substantial script, split into ${n} statements`);

  assert.deepEqual(await tablesIn(db), [
    "athletes",
    "recovery_entries",
    "resources",
    "setbacks",
    "training_sessions",
  ]);
});

test("every ALTER lands, so no column is added before its table exists", async () => {
  // The specific failure this suite exists for. On a fresh database an ALTER
  // ordered above its CREATE TABLE fails outright; against the already-built
  // local database it passed silently.
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);

  const athletes = await columnsOf(db, "athletes");
  for (const c of [
    "password_hash",
    "birth_date",
    "level",
    "first_name",
    "last_name",
    "height_in",
    "weight_lb",
    "weight_source",
    "weight_at",
    "guardian_name",
    "coach_notes",
  ])
    assert.ok(athletes.includes(c), `athletes.${c} missing`);

  assert.ok((await columnsOf(db, "training_sessions")).includes("level"));
  assert.ok((await columnsOf(db, "setbacks")).includes("severity"));
  for (const c of ["arm_readiness", "body_weight", "sleep_duration"])
    assert.ok((await columnsOf(db, "recovery_entries")).includes(c), c);
});

test("the schema is safe to run twice", async () => {
  // Cole re-runs /api/setup after every deploy that touches the schema, so a
  // second pass over an already-migrated database has to be a no-op.
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await applyAsProduction(db, SCHEMA_SQL);
  assert.equal((await tablesIn(db)).length, 5);
});

test("the seed applies on top of a fresh schema", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await applyAsProduction(db, SEED_SQL);
  const rows = await db.query("SELECT count(*)::int AS n FROM athletes");
  assert.ok(Number(rows.rows[0].n) >= 1, "seed inserted no athletes");
});

test("the seed is safe to run twice", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await applyAsProduction(db, SEED_SQL);
  const after1 = await db.query("SELECT count(*)::int AS n FROM athletes");
  await applyAsProduction(db, SEED_SQL);
  const after2 = await db.query("SELECT count(*)::int AS n FROM athletes");
  assert.equal(
    Number(after2.rows[0].n),
    Number(after1.rows[0].n),
    "a second seed run duplicated rows",
  );
});

/* ------------------------------------------------------------------ *
 * Static guards on the SQL text
 * ------------------------------------------------------------------ */

test("each ALTER TABLE sits below the CREATE TABLE it depends on", () => {
  // Catches the ordering fault by reading the file, without a database, so it
  // fails on the exact line rather than as a Postgres error further down.
  const created = new Map<string, number>();
  const lines = SCHEMA_SQL.split("\n");
  lines.forEach((line, i) => {
    const c = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(line);
    if (c && !created.has(c[1])) created.set(c[1], i);
  });
  lines.forEach((line, i) => {
    const a = /^ALTER TABLE (\w+)/.exec(line.trim());
    if (!a) return;
    const at = created.get(a[1]);
    assert.notEqual(at, undefined, `ALTER TABLE ${a[1]} but nothing creates it`);
    assert.ok(at! < i, `line ${i + 1}: ALTER TABLE ${a[1]} precedes its CREATE`);
  });
});

test("SCHEMA_VERSION is a whole number that only moves forward", () => {
  assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 14);
});
