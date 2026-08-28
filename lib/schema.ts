/**
 * Canonical database schema. Run once via GET /api/setup?key=SETUP_KEY.
 * Every statement is idempotent, so re-running is safe.
 * `db/schema.sql` is a human-readable copy of this.
 */
export const SCHEMA_SQL = `
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
  throws     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_athlete_idx ON training_sessions(athlete_id, type, date);
`;

/** The one real session already logged, imported so there is live data on day one. */
export const SEED_SQL = `
INSERT INTO athletes (id, name, hand)
VALUES ('seed-md', 'Martin Duff', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO training_sessions (id, athlete_id, type, date, notes, throws)
VALUES ('seed-md-s1', 'seed-md', 'pulldown', '2026-08-28', '',
  '{"p1":[null,92.1,93.1,90.6],"p2":[null,89.4,88.8,89.4],"p4":[null,93.4,93.5,94.5],"p5":[null,97.1,94.4,97.1]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
`;
