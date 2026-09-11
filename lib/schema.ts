import { seedLifts } from "./strength";

/**
 * Canonical database schema. Run once (and after any schema change) via
 * GET /api/setup?key=SETUP_KEY. Every statement is idempotent.
 * `db/schema.sql` is a human-readable copy of this.
 */
/** Bump when SCHEMA_SQL changes; surfaced by /api/setup to spot a stale deploy. */
export const SCHEMA_VERSION = 21;

/** Single-quote a value for inline SQL. Only ever sees our own constants. */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * The starting lift menu, as INSERTs.
 *
 * Generated from `seedLifts()` rather than typed out, so the list a fresh
 * database gets and the list the code describes cannot drift apart. Every row
 * is `ON CONFLICT DO NOTHING`: on Cole's database, which already has a menu
 * he has edited, this whole block is a no-op.
 */
const LIFT_SEED_SQL = seedLifts()
  .map(
    (l) =>
      `INSERT INTO lifts (key, name, lift_group, mode, help, position) VALUES (` +
      `${q(l.key)}, ${q(l.name)}, ${q(l.group)}, ${q(l.mode)}, ${q(l.help)}, ${l.position})` +
      ` ON CONFLICT (key) DO NOTHING;`,
  )
  .join("\n");

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS athletes (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  hand          text NOT NULL DEFAULT '',
  invite_email  text,
  password_hash text,
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS password_hash text;
-- Single-use invite: the athlete sets their own password from a link, so a
-- password never has to be sent to them over text or email.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS invite_token text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS invite_expires timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS athletes_invite_token_idx
  ON athletes(invite_token) WHERE invite_token IS NOT NULL;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS cns_threshold_pct real;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS height_in int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_lb numeric(5,1);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_source text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_at date;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS bats text;
-- Retired. Positions only ever held RHP/LHP, which the hand column already
-- encodes — two columns for one fact, free to contradict each other. The column
-- stays so fresh and existing databases keep the same shape; nothing reads it.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS positions text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS school text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS hs_grad_year int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS college_grad_year int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS guardian_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS guardian_phone text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS emergency_contact text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS injury_notes text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS coach_notes text;

-- Backfill first/last from the existing single name, splitting on the LAST
-- space. Runs once: only rows that have never been split are touched, so a
-- coach's later correction is never overwritten by a re-run of setup.
UPDATE athletes
   SET first_name = CASE
         WHEN position(' ' in btrim(name)) = 0 THEN btrim(name)
         ELSE btrim(substring(btrim(name) from 1 for length(btrim(name)) - position(' ' in reverse(btrim(name)))))
       END,
       last_name = CASE
         WHEN position(' ' in btrim(name)) = 0 THEN ''
         ELSE substring(btrim(name) from length(btrim(name)) - position(' ' in reverse(btrim(name))) + 2)
       END
 WHERE first_name IS NULL AND name IS NOT NULL;
CREATE INDEX IF NOT EXISTS athletes_email_idx ON athletes(lower(invite_email));

CREATE TABLE IF NOT EXISTS training_sessions (
  id         text PRIMARY KEY,
  athlete_id text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('mound','pulldown')),
  date       date NOT NULL,
  notes      text NOT NULL DEFAULT '',
  throws     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS level text;
CREATE INDEX IF NOT EXISTS ts_athlete_idx ON training_sessions(athlete_id, type, date);

-- Daily recovery check-in. One row per athlete per day (upserted), logged
-- whether or not they threw, so rest days count too.
-- Every 1-5 rating points the same way: 5 is always the good end.
-- sleep_hours is real (not numeric) so the driver hands back a number.
CREATE TABLE IF NOT EXISTS recovery_entries (
  id            text PRIMARY KEY,
  athlete_id    text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date          date NOT NULL,
  sleep_hours   real,
  sleep_quality int,
  soreness      int,
  energy        int,
  stress        int,
  mood          int,
  resting_hr    int,
  hrv           int,
  notes         text NOT NULL DEFAULT '',
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recovery_entries ADD COLUMN IF NOT EXISTS arm_status text;
ALTER TABLE recovery_entries ADD COLUMN IF NOT EXISTS diet int;
-- Arm readiness is a 1-4 scale (Driveline's), not 1-5. Kept at its native
-- range and normalised at scoring time rather than padded with a fake level.
ALTER TABLE recovery_entries ADD COLUMN IF NOT EXISTS arm_readiness int;
ALTER TABLE recovery_entries ADD COLUMN IF NOT EXISTS body_weight numeric(5,1);
ALTER TABLE recovery_entries ADD COLUMN IF NOT EXISTS sleep_duration int;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_athlete_date_idx
  ON recovery_entries(athlete_id, date);

-- Which branch of the setback logic fired, and when it cleared. Kept as
-- history (never hard-deleted) so per-athlete patterns stay visible.
CREATE TABLE IF NOT EXISTS setbacks (
  id          text PRIMARY KEY,
  athlete_id  text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('soreness','cns','injury')),
  opened_on   date NOT NULL,
  resolved_on date,
  resolved_by text,
  detail      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE setbacks ADD COLUMN IF NOT EXISTS severity text;

-- Backfill severity on injury flags opened before the column existed, reading
-- it back out of the detail line those flags already carry. Without this an
-- open flag from before the upgrade keeps the old, softer guidance forever.
UPDATE setbacks SET severity = CASE
    WHEN detail LIKE 'Pain limiting movement%' THEN 'pain-limiting'
    WHEN detail LIKE 'Pain reported%'          THEN 'pain'
  END
  WHERE kind = 'injury' AND severity IS NULL
    AND (detail LIKE 'Pain limiting movement%' OR detail LIKE 'Pain reported%');

CREATE INDEX IF NOT EXISTS setbacks_open_idx
  ON setbacks(athlete_id, kind) WHERE resolved_on IS NULL;

-- Shared library of protocols and how-tos. Coaches write, everyone reads.
CREATE TABLE IF NOT EXISTS resources (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  category   text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  link       text,
  position   int NOT NULL DEFAULT 0,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resources_order_idx
  ON resources(lower(category), position, lower(title)) WHERE archived = false;

-- Migration for databases created before the switch from magic-link auth to
-- passwords. Back then created_by and athletes.user_id referenced the Auth.js
-- adapter's users table, which the app no longer writes to. CREATE TABLE IF NOT
-- EXISTS never alters an existing table, so those constraints survive and every
-- session insert fails with a foreign key violation.
-- Scoped hard to our own two tables in public: a managed Postgres (Supabase)
-- has its own auth.users that this role does not own and must never touch.
-- Each drop is individually guarded so a permission problem can only skip that
-- one constraint, never fail the whole setup.
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT src.relname AS tbl, c.conname AS name
    FROM pg_constraint c
    JOIN pg_class src       ON src.oid = c.conrelid
    JOIN pg_namespace srcns ON srcns.oid = src.relnamespace
    JOIN pg_class ref       ON ref.oid = c.confrelid
    JOIN pg_namespace refns ON refns.oid = ref.relnamespace
    WHERE c.contype = 'f'
      AND srcns.nspname = 'public'
      AND src.relname IN ('athletes', 'training_sessions')
      AND refns.nspname = 'public'
      AND ref.relname = 'users'
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.name);
      RAISE NOTICE 'velo: dropped stale FK %.%', r.tbl, r.name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'velo: could not drop %.% (%)', r.tbl, r.name, SQLERRM;
    END;
  END LOOP;
END
$mig$;

-- v15: OnBaseU movement screens. Results are JSONB keyed by test.sub-test,
-- with an :L / :R suffix where the sub-test is graded per side, so revising
-- the battery is a config edit rather than a migration.
-- v16: training phase, and the one flag every re-screen trigger writes to.
-- rescreen_since is a date rather than a boolean so it can be compared
-- against the last screen: a flag raised before the most recent screen has
-- already been answered, and clears itself without anyone dismissing it.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS rescreen_since date;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS rescreen_reason text;

CREATE TABLE IF NOT EXISTS movement_screens (
  id          text PRIMARY KEY,
  athlete_id  text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date        date NOT NULL,
  results     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- One screen per athlete per day, so re-saving a date replaces it rather than
-- leaving two versions for the comparison view to disagree about.
-- v17: Push-Off stopped being two tests, one per surface, and became one
-- test that records which surface it was run on. An athlete only ever does
-- one, so the other stayed permanently unscreened and no screen could ever
-- be complete. Move whatever was recorded onto the merged keys.
--
-- Mound wins if a screen somehow carries both, which the old config allowed
-- and nobody should have done. The transformation is idempotent on its own —
-- a row with no old keys comes out unchanged — so the WHERE clause is there
-- to stop a re-run rewriting every screen, not to make it safe.
UPDATE movement_screens SET results =
  (results - 'push-off-mound.planted' - 'push-off-mound.released'
           - 'push-off-flat.planted'  - 'push-off-flat.released')
  || (CASE
        WHEN results ? 'push-off-mound.planted'
          THEN jsonb_build_object('push-off.surface', 'mound',
                                  'push-off.planted', results -> 'push-off-mound.planted')
        WHEN results ? 'push-off-flat.planted'
          THEN jsonb_build_object('push-off.surface', 'flat',
                                  'push-off.planted', results -> 'push-off-flat.planted')
        ELSE '{}'::jsonb
      END)
  || (CASE
        WHEN results ? 'push-off-mound.released'
          THEN jsonb_build_object('push-off.released', results -> 'push-off-mound.released')
        WHEN results ? 'push-off-flat.released'
          THEN jsonb_build_object('push-off.released', results -> 'push-off-flat.released')
        ELSE '{}'::jsonb
      END)
WHERE results ?| array['push-off-mound.planted', 'push-off-mound.released',
                       'push-off-flat.planted',  'push-off-flat.released'];

CREATE UNIQUE INDEX IF NOT EXISTS ms_athlete_date_uidx
  ON movement_screens(athlete_id, date);

-- v18: strength. One lifting day per athlete per date, like the check-in and
-- the screen — re-saving a date replaces it rather than leaving two versions
-- of the same afternoon for the history to disagree about.
--
-- The lifts column is JSONB keyed by lift key -> the working sets in order,
-- each {"w": pounds, "r": reps}: exactly the shape the entry form holds, and
-- the same trick training_sessions.throws plays. Revising the lift menu is
-- therefore a config edit, not a migration. Nothing here stores a lift's NAME.
CREATE TABLE IF NOT EXISTS lift_sessions (
  id         text PRIMARY KEY,
  athlete_id text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date       date NOT NULL,
  lifts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes      text NOT NULL DEFAULT '',
  level      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lift_athlete_date_uidx
  ON lift_sessions(athlete_id, date);

-- v20: recipes. Most of Cole's athletes are underweight, and the standards
-- page tells one he is 14 lb light without saying how. These are the how.
--
-- Separate from the resources library rather than a category of it, because
-- the whole point is the NUMBERS: an athlete looking for a 1000 kcal
-- breakfast needs to sort by calories, which free text cannot do.
--
-- Ingredients are JSONB strings in order, the same shape trick as throws and
-- lifts: a list that is only ever read whole and never queried into.
CREATE TABLE IF NOT EXISTS recipes (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'smoothie',
  calories    int,
  protein_g   int,
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  method      text NOT NULL DEFAULT '',
  notes       text NOT NULL DEFAULT '',
  position    int NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Biggest first is the order an athlete trying to gain actually wants.
CREATE INDEX IF NOT EXISTS recipes_order_idx
  ON recipes(calories DESC NULLS LAST, position, lower(title)) WHERE archived = false;

-- v21: what Cole's actual recipes turned out to carry, once he sent six.
--
-- Full macros, not just protein: three of the six are written as
-- "1,110 calories | 73g protein | 115g carbs | 40g fat".
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS carbs_g int;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fat_g int;
-- The one-line "why pick this one", which belongs on the row rather than
-- inside it: "the lightest and lowest-fat of these, good after training".
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS blurb text NOT NULL DEFAULT '';
-- Steps are numbered and discrete in every recipe he wrote, so they are a
-- list like the ingredients, not a paragraph. An ordered list also renders
-- as one, which a prose method never did.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Carry any prose method into the first step before the column goes, so no
-- recipe written against v20 loses its instructions. Production had none,
-- but "probably empty" is not a reason to drop a column holding text.
--
-- Wrapped in a guard because the UPDATE reads a column this block then drops:
-- run flat, the second pass fails on a column that no longer exists. Cole runs
-- setup after every deploy, so "works once" is not a migration.
DO $recipes$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'recipes' AND column_name = 'method'
  ) THEN
    UPDATE recipes SET steps = jsonb_build_array(method)
      WHERE method IS NOT NULL AND method <> '' AND steps = '[]'::jsonb;
    ALTER TABLE recipes DROP COLUMN method;
  END IF;
END
$recipes$;

-- v19: the lift menu became Cole's to edit rather than a constant in the
-- code. Keyed by the slug, because that slug is what every logged set is
-- filed under in lift_sessions.lifts — a surrogate id here would leave two
-- ways to name the same lift and no guarantee they agreed.
--
-- Retiring a lift archives it. That is what makes the seed below safe to
-- re-run: a lift Cole has removed stays in the table with archived = true,
-- so ON CONFLICT DO NOTHING cannot resurrect it on the next deploy.
CREATE TABLE IF NOT EXISTS lifts (
  key        text PRIMARY KEY,
  name       text NOT NULL,
  lift_group text NOT NULL DEFAULT '',
  mode       text NOT NULL DEFAULT 'load' CHECK (mode IN ('load','reps','time')),
  help       text NOT NULL DEFAULT '',
  position   int NOT NULL DEFAULT 0,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lifts_order_idx ON lifts(position, name)
  WHERE archived = false;
-- The mode list grew a 'time' once the program turned out to hold planks.
-- CREATE TABLE IF NOT EXISTS never updates an existing table, so a database
-- built before that keeps the old two-value constraint and every insert of a
-- hold fails. Replace it outright; both statements are idempotent.
ALTER TABLE lifts DROP CONSTRAINT IF EXISTS lifts_mode_check;
ALTER TABLE lifts ADD CONSTRAINT lifts_mode_check
  CHECK (mode IN ('load','reps','time'));
${LIFT_SEED_SQL}
`;

/** The one real session already logged, imported so there is live data on day one. */
export const SEED_SQL = `
INSERT INTO athletes (id, name, hand, first_name, last_name)
VALUES ('seed-md', 'Martin Duff', '', 'Martin', 'Duff')
ON CONFLICT (id) DO NOTHING;

INSERT INTO training_sessions (id, athlete_id, type, date, notes, throws)
VALUES ('seed-md-s1', 'seed-md', 'pulldown', '2026-08-28', '',
  '{"p1":[null,92.1,93.1,90.6],"p2":[null,89.4,88.8,89.4],"p4":[null,93.4,93.5,94.5],"p5":[null,97.1,94.4,97.1]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
`;

/**
 * Every table SCHEMA_SQL creates, read out of the SQL itself.
 *
 * Derived rather than listed, because the listed version drifted: `/api/setup`
 * carried a hand-typed copy that Cole reads after every deploy to confirm the
 * migration landed, and a table missing from that copy is a table whose
 * absence the check cannot report. It went a whole schema version without
 * `lift_sessions` in it.
 */
export function schemaTables(): string[] {
  /*
   * Comments stripped FIRST. Without that the scan reads its own prose: a
   * comment beginning "CREATE TABLE IF NOT EXISTS never updates an existing
   * table" put a table called `never` on the list, and `/api/setup` would
   * have reported it missing from a perfectly healthy database.
   */
  const sql = SCHEMA_SQL.replace(/--[^\n]*/g, "");
  return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)]
    .map((m) => m[1])
    .sort();
}

/**
 * `db/schema.sql` as it should be on disk — the same SQL with a header saying
 * where it came from. A human-readable copy for anyone who wants the shape of
 * the database without reading TypeScript.
 *
 * Kept honest by `lib/schemaFile.test.ts`, because the file calls itself
 * generated and that claim went stale for three schema versions: it had no
 * movement_screens table at all, and anyone reading it would reasonably have
 * concluded the screen was not stored.
 *
 * Rewrite it with:  npx tsx scripts/schema-sql.ts
 */
export function schemaFile(): string {
  return (
    `-- Generated from lib/schema.ts (SCHEMA_VERSION ${SCHEMA_VERSION}). Do not edit by hand.\n` +
    `-- Applied by GET /api/setup?key=SETUP_KEY\n` +
    SCHEMA_SQL
  );
}
