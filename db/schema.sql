-- Generated from lib/schema.ts (SCHEMA_VERSION 10). Do not edit by hand.
-- Applied by GET /api/setup?key=SETUP_KEY

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
