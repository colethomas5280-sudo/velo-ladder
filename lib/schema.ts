/**
 * Canonical database schema. Run once (and after any schema change) via
 * GET /api/setup?key=SETUP_KEY. Every statement is idempotent.
 * `db/schema.sql` is a human-readable copy of this.
 */
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
