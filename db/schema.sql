-- Canonical schema for Velo Ladder — a human-readable copy of lib/schema.ts.
-- You do NOT need to run this by hand: visit
--   GET /api/setup?key=YOUR_SETUP_KEY          (schema only)
--   GET /api/setup?key=YOUR_SETUP_KEY&seed=1   (schema + import the one real session)
-- Every statement is idempotent. Re-run after any schema change.

CREATE TABLE IF NOT EXISTS athletes (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  hand          text NOT NULL DEFAULT '',
  invite_email  text,                 -- the email this athlete logs in with
  password_hash text,                 -- bcrypt; null until the coach sets one
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS password_hash text;
CREATE INDEX IF NOT EXISTS athletes_email_idx ON athletes(lower(invite_email));

CREATE TABLE IF NOT EXISTS training_sessions (
  id         text PRIMARY KEY,
  athlete_id text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('mound','pulldown')),
  date       date NOT NULL,
  notes      text NOT NULL DEFAULT '',
  throws     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"p1":[80,99,100,98], ...}
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_athlete_idx ON training_sessions(athlete_id, type, date);
