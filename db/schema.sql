-- Generated from lib/schema.ts — apply with GET /api/setup?key=SETUP_KEY

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

-- seed --

INSERT INTO athletes (id, name, hand)
VALUES ('seed-md', 'Martin Duff', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO training_sessions (id, athlete_id, type, date, notes, throws)
VALUES ('seed-md-s1', 'seed-md', 'pulldown', '2026-08-28', '',
  '{"p1":[null,92.1,93.1,90.6],"p2":[null,89.4,88.8,89.4],"p4":[null,93.4,93.5,94.5],"p5":[null,97.1,94.4,97.1]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
