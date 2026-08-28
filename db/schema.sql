-- Canonical schema for Velo Ladder — a human-readable copy of lib/schema.ts.
-- You do NOT need to run this by hand: visit
--   GET /api/setup?key=YOUR_SETUP_KEY          (schema only)
--   GET /api/setup?key=YOUR_SETUP_KEY&seed=1   (schema + import the one real session)
-- Every statement is idempotent, so re-running is safe.

-- ---------- Auth.js (text ids so everything is string-typed) ----------
CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name           text,
  email          text UNIQUE,
  "emailVerified" timestamptz,
  image          text
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                text NOT NULL,
  provider            text NOT NULL,
  "providerAccountId" text NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  id_token            text,
  scope               text,
  session_state       text,
  token_type          text,
  UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        timestamptz NOT NULL,
  "sessionToken" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier text NOT NULL,
  expires    timestamptz NOT NULL,
  token      text NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------- App ----------
CREATE TABLE IF NOT EXISTS athletes (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  hand         text NOT NULL DEFAULT '',
  invite_email text,
  user_id      text REFERENCES users(id) ON DELETE SET NULL,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_user_uidx
  ON athletes(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS athletes_invite_idx ON athletes(lower(invite_email));

CREATE TABLE IF NOT EXISTS training_sessions (
  id         text PRIMARY KEY,
  athlete_id text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('mound','pulldown')),
  date       date NOT NULL,
  notes      text NOT NULL DEFAULT '',
  throws     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"p1":[80,99,100,98], ...}
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_athlete_idx ON training_sessions(athlete_id, type, date);
