import { test, after } from "node:test";
import assert from "node:assert/strict";
import { splitStatements } from "@/lib/db";
import { SCHEMA_SQL, SEED_SQL, SCHEMA_VERSION, schemaTables } from "@/lib/schema";
import { seedLifts } from "@/lib/strength";

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

/*
 * Every database this file opens, so they can all be shut afterwards. An
 * in-memory PGlite is still a live WASM instance holding the event loop open,
 * and this file opens one per test.
 */
const opened: { close(): Promise<void> }[] = [];
after(async () => {
  for (const db of opened) await db.close().catch(() => {});
});

/** A brand-new in-memory Postgres. Never touches ./.pglite-data. */
async function freshDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  opened.push(db as unknown as { close(): Promise<void> });
  return db as unknown as Db;
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
    "lift_sessions",
    "lifts",
    "movement_screens",
    "recovery_entries",
    "resources",
    "setbacks",
    "training_sessions",
  ]);
});

/*
 * `/api/setup` reports which tables are present, and Cole reads that response
 * after every deploy. The list it checks against is derived from this SQL —
 * this is what proves the derivation is right rather than merely consistent.
 */
test("the tables the setup check looks for are the tables the schema creates", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  assert.deepEqual(schemaTables(), await tablesIn(db));
  assert.ok(schemaTables().includes("lift_sessions"), "the one the typed list missed");
});

/*
 * The seed INSERTs are generated from `seedLifts()`, so this is what stops
 * "what the code says a new database starts with" and "what it actually
 * starts with" from drifting — including the `lift_group` column name, which
 * differs from the field it carries because `group` is reserved in SQL.
 */
test("a fresh database starts with exactly the seeded lift menu", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  const rows = (
    await db.query(
      "SELECT key, name, lift_group, mode, help, position, archived FROM lifts ORDER BY position",
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => ({
      key: String(r.key),
      name: String(r.name),
      group: String(r.lift_group),
      mode: String(r.mode),
      help: String(r.help),
      position: Number(r.position),
      archived: Boolean(r.archived),
    })),
    seedLifts(),
  );
});

/*
 * Cole edits the menu himself, and setup runs again on every schema change.
 * A seed that re-inserted would resurrect lifts he had removed — which is the
 * whole reason removing one archives it rather than deleting the row.
 */
test("re-running setup does not resurrect a lift the coach retired", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await db.query("UPDATE lifts SET archived = true WHERE key = 'hip-thrust'");
  await db.query("UPDATE lifts SET name = 'Trap bar pull' WHERE key = 'trap-bar-deadlift'");
  await applyAsProduction(db, SCHEMA_SQL);

  const rows = (
    await db.query("SELECT key, name, archived FROM lifts WHERE key IN ('hip-thrust','trap-bar-deadlift')")
  ).rows;
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  assert.equal(Boolean(byKey.get("hip-thrust")!.archived), true, "still retired");
  assert.equal(
    String(byKey.get("trap-bar-deadlift")!.name),
    "Trap bar pull",
    "and his rename survived too",
  );
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
  assert.ok((await columnsOf(db, "lift_sessions")).includes("lifts"));
  assert.ok((await columnsOf(db, "setbacks")).includes("severity"));
  for (const c of ["arm_readiness", "body_weight", "sleep_duration"])
    assert.ok((await columnsOf(db, "recovery_entries")).includes(c), c);
});

test("the schema is safe to run twice", async () => {
  // Cole re-runs /api/setup after every deploy that touches the schema, so a
  // second pass over an already-migrated database has to be a no-op.
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  // Against the first pass, not against a typed count: a hardcoded 6 fails
  // the next time a table is added, which says nothing about idempotence.
  const once = await tablesIn(db);
  await applyAsProduction(db, SCHEMA_SQL);
  assert.deepEqual(await tablesIn(db), once);
});

/*
 * v17 merged the two Push-Off tests into one. Screens recorded before that
 * hold the old keys, and losing them would quietly drop a reading from every
 * screen Cole has already run.
 */
test("v17 moves an old Push-Off reading onto the merged keys", async () => {
  const db = await freshDb();
  await applyAsProduction(db, SCHEMA_SQL);
  await db.query(`
    INSERT INTO athletes (id, name) VALUES ('a1', 'Old Screen')
  `);
  await db.query(`
    INSERT INTO movement_screens (id, athlete_id, date, results) VALUES
      ('s1', 'a1', '2026-08-01', '{"push-off-mound.planted":"gt-6","push-off-mound.released":"gt-half","hip-45.45-degree-angle:L":"greater"}'),
      ('s2', 'a1', '2026-08-02', '{"push-off-flat.planted":"5-to-6","push-off-flat.released":"none"}'),
      ('s3', 'a1', '2026-08-03', '{"hip-45.45-degree-angle:L":"greater"}')
  `);

  await applyAsProduction(db, SCHEMA_SQL);
  const rows = await db.query(
    "SELECT id, results FROM movement_screens ORDER BY id",
  );
  const by = Object.fromEntries(
    rows.rows.map((r: Record<string, unknown>) => [r.id, r.results as Record<string, string>]),
  );

  assert.deepEqual(by.s1, {
    "push-off.surface": "mound",
    "push-off.planted": "gt-6",
    "push-off.released": "gt-half",
    "hip-45.45-degree-angle:L": "greater",
  });
  assert.deepEqual(by.s2, {
    "push-off.surface": "flat",
    "push-off.planted": "5-to-6",
    "push-off.released": "none",
  });
  assert.deepEqual(by.s3, { "hip-45.45-degree-angle:L": "greater" }, "untouched");

  // Cole re-runs setup after every schema deploy, so a second pass must not
  // undo or duplicate any of that.
  await applyAsProduction(db, SCHEMA_SQL);
  const again = await db.query("SELECT results FROM movement_screens WHERE id = 's1'");
  assert.deepEqual(again.rows[0].results, by.s1);
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
