import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import type {
  Athlete,
  AthleteOverview,
  TrainingSession,
  Throws,
  TrackerId,
  Resource,
} from "@/lib/types";

function toAthlete(r: Record<string, unknown>): Athlete {
  return {
    id: String(r.id),
    name: String(r.name),
    hand: (r.hand as Athlete["hand"]) || "",
    inviteEmail: (r.invite_email as string | null) ?? null,
    hasPassword: !!r.password_hash,
    hasInvite: !!r.invite_token,
    archived: Boolean(r.archived),
  };
}

/** Postgres gives DATE as a string (we set a type parser); PGlite gives a Date. */
export function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toSession(r: Record<string, unknown>): TrainingSession {
  return {
    id: String(r.id),
    athleteId: String(r.athlete_id),
    type: r.type as TrackerId,
    date: isoDate(r.date),
    notes: String(r.notes ?? ""),
    throws:
      typeof r.throws === "string"
        ? (JSON.parse(r.throws) as Throws)
        : ((r.throws as Throws) ?? {}),
  };
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);

export async function listAthletes(
  opts: { ids?: string[] } = {},
): Promise<Athlete[]> {
  const rows = opts.ids
    ? await sql`SELECT * FROM athletes WHERE archived = false AND id = ANY(${opts.ids}) ORDER BY lower(name)`
    : await sql`SELECT * FROM athletes WHERE archived = false ORDER BY lower(name)`;
  return (rows as Record<string, unknown>[]).map(toAthlete);
}

export async function listAthleteOverview(): Promise<AthleteOverview[]> {
  const rows = (await sql`
    SELECT a.*,
      COUNT(*) FILTER (WHERE s.type = 'mound')    AS mound_n,
      COUNT(*) FILTER (WHERE s.type = 'pulldown') AS pulldown_n,
      MAX(s.date) AS last_date
    FROM athletes a
    LEFT JOIN training_sessions s ON s.athlete_id = a.id
    WHERE a.archived = false
    GROUP BY a.id
    ORDER BY lower(a.name)
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...toAthlete(r),
    mound: Number(r.mound_n ?? 0),
    pulldown: Number(r.pulldown_n ?? 0),
    lastDate: r.last_date ? isoDate(r.last_date) : null,
  }));
}

export async function getAthlete(id: string): Promise<Athlete | null> {
  const rows = (await sql`SELECT * FROM athletes WHERE id = ${id}`) as Record<
    string,
    unknown
  >[];
  return rows[0] ? toAthlete(rows[0]) : null;
}

export async function createAthlete(input: {
  name: string;
  hand?: string;
  inviteEmail?: string | null;
  password?: string | null;
}): Promise<Athlete> {
  const id = crypto.randomUUID();
  const email = input.inviteEmail?.trim().toLowerCase() || null;
  const hash = input.password ? await hashPassword(input.password) : null;
  const rows = (await sql`
    INSERT INTO athletes (id, name, hand, invite_email, password_hash)
    VALUES (${id}, ${input.name.trim()}, ${input.hand || ""}, ${email}, ${hash})
    RETURNING *
  `) as Record<string, unknown>[];
  return toAthlete(rows[0]);
}

export async function updateAthlete(
  id: string,
  patch: {
    name?: string;
    hand?: string;
    inviteEmail?: string | null;
    archived?: boolean;
    password?: string;
  },
): Promise<Athlete | null> {
  const cur = await getAthlete(id);
  if (!cur) return null;
  const name = patch.name?.trim() ?? cur.name;
  const hand = patch.hand ?? cur.hand;
  const inviteEmail =
    patch.inviteEmail === undefined
      ? cur.inviteEmail
      : patch.inviteEmail?.trim().toLowerCase() || null;
  const archived = patch.archived ?? cur.archived;

  if (patch.password) {
    const hash = await hashPassword(patch.password);
    const rows = (await sql`
      UPDATE athletes
      SET name = ${name}, hand = ${hand}, invite_email = ${inviteEmail},
          archived = ${archived}, password_hash = ${hash}
      WHERE id = ${id} RETURNING *
    `) as Record<string, unknown>[];
    return rows[0] ? toAthlete(rows[0]) : null;
  }

  const rows = (await sql`
    UPDATE athletes
    SET name = ${name}, hand = ${hand}, invite_email = ${inviteEmail}, archived = ${archived}
    WHERE id = ${id} RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? toAthlete(rows[0]) : null;
}

/* ---------------- invites ---------------- */

/** How long a freshly issued invite link stays usable. */
export const INVITE_TTL_DAYS = 14;

/**
 * Issue a fresh single-use invite for an athlete and return the raw token.
 * Any previous invite for that athlete stops working — the token column is
 * overwritten — so re-inviting safely revokes a link that went to the wrong
 * person. The raw token is returned once here and never included in any
 * athlete listing.
 */
export async function createInvite(id: string): Promise<string | null> {
  const cur = await getAthlete(id);
  if (!cur || cur.archived) return null;
  const token = randomToken();
  await sql`
    UPDATE athletes
    SET invite_token = ${token},
        invite_expires = now() + ${`${INVITE_TTL_DAYS} days`}::interval
    WHERE id = ${id}
  `;
  return token;
}

export async function revokeInvite(id: string): Promise<void> {
  await sql`UPDATE athletes SET invite_token = NULL, invite_expires = NULL WHERE id = ${id}`;
}

export interface InviteTarget {
  id: string;
  name: string;
  email: string | null;
}

/** Look up a pending, unexpired invite. Returns null for unknown/expired/used. */
export async function getInvite(token: string): Promise<InviteTarget | null> {
  if (!token) return null;
  const rows = (await sql`
    SELECT id, name, invite_email FROM athletes
    WHERE invite_token = ${token}
      AND archived = false
      AND invite_expires IS NOT NULL
      AND invite_expires > now()
    LIMIT 1
  `) as Record<string, unknown>[];
  const r = rows[0];
  return r
    ? {
        id: String(r.id),
        name: String(r.name),
        email: (r.invite_email as string | null) ?? null,
      }
    : null;
}

/**
 * Spend the invite: set the athlete's password and clear the token in one
 * statement, so the same link can't be redeemed twice even if two requests
 * arrive together. Returns the athlete, or null if the token was already used.
 */
export async function consumeInvite(
  token: string,
  password: string,
): Promise<InviteTarget | null> {
  const hash = await hashPassword(password);
  const rows = (await sql`
    UPDATE athletes
    SET password_hash = ${hash}, invite_token = NULL, invite_expires = NULL
    WHERE invite_token = ${token}
      AND archived = false
      AND invite_expires IS NOT NULL
      AND invite_expires > now()
    RETURNING id, name, invite_email
  `) as Record<string, unknown>[];
  const r = rows[0];
  return r
    ? {
        id: String(r.id),
        name: String(r.name),
        email: (r.invite_email as string | null) ?? null,
      }
    : null;
}

function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function listSessions(athleteId: string): Promise<TrainingSession[]> {
  const rows = (await sql`
    SELECT * FROM training_sessions WHERE athlete_id = ${athleteId}
    ORDER BY date ASC, created_at ASC
  `) as Record<string, unknown>[];
  return rows.map(toSession);
}

export async function getSession(id: string): Promise<TrainingSession | null> {
  const rows = (await sql`SELECT * FROM training_sessions WHERE id = ${id}`) as Record<
    string,
    unknown
  >[];
  return rows[0] ? toSession(rows[0]) : null;
}

export async function createSession(input: {
  athleteId: string;
  type: TrackerId;
  date: string;
  notes: string;
  throws: Throws;
  createdBy: string;
}): Promise<TrainingSession> {
  const id = crypto.randomUUID();
  const rows = (await sql`
    INSERT INTO training_sessions (id, athlete_id, type, date, notes, throws, created_by)
    VALUES (${id}, ${input.athleteId}, ${input.type}, ${input.date}, ${input.notes},
            ${JSON.stringify(input.throws)}::jsonb, ${input.createdBy})
    RETURNING *
  `) as Record<string, unknown>[];
  return toSession(rows[0]);
}

export async function updateSession(
  id: string,
  patch: { date?: string; notes?: string; throws?: Throws },
): Promise<TrainingSession | null> {
  const cur = await getSession(id);
  if (!cur) return null;
  const date = patch.date ?? cur.date;
  const notes = patch.notes ?? cur.notes;
  const throws = patch.throws ?? cur.throws;
  const rows = (await sql`
    UPDATE training_sessions
    SET date = ${date}, notes = ${notes}, throws = ${JSON.stringify(throws)}::jsonb,
        updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? toSession(rows[0]) : null;
}

export async function deleteSession(id: string): Promise<void> {
  await sql`DELETE FROM training_sessions WHERE id = ${id}`;
}

/* ---------------- resources ---------------- */

function toResource(r: Record<string, unknown>): Resource {
  return {
    id: String(r.id),
    title: String(r.title),
    category: String(r.category ?? ""),
    body: String(r.body ?? ""),
    link: (r.link as string | null) ?? null,
    position: Number(r.position ?? 0),
    archived: Boolean(r.archived),
  };
}

export async function listResources(): Promise<Resource[]> {
  const rows = (await sql`
    SELECT * FROM resources WHERE archived = false
    ORDER BY lower(category), position, lower(title)
  `) as Record<string, unknown>[];
  return rows.map(toResource);
}

export async function createResource(input: {
  title: string;
  category?: string;
  body?: string;
  link?: string | null;
}): Promise<Resource> {
  const id = crypto.randomUUID();
  const rows = (await sql`
    INSERT INTO resources (id, title, category, body, link)
    VALUES (${id}, ${input.title.trim()}, ${input.category?.trim() || ""},
            ${input.body ?? ""}, ${input.link?.trim() || null})
    RETURNING *
  `) as Record<string, unknown>[];
  return toResource(rows[0]);
}

export async function updateResource(
  id: string,
  patch: {
    title?: string;
    category?: string;
    body?: string;
    link?: string | null;
    position?: number;
    archived?: boolean;
  },
): Promise<Resource | null> {
  const rows = (await sql`SELECT * FROM resources WHERE id = ${id}`) as Record<
    string,
    unknown
  >[];
  if (!rows[0]) return null;
  const cur = toResource(rows[0]);
  const out = (await sql`
    UPDATE resources SET
      title = ${patch.title?.trim() ?? cur.title},
      category = ${patch.category?.trim() ?? cur.category},
      body = ${patch.body ?? cur.body},
      link = ${patch.link === undefined ? cur.link : patch.link?.trim() || null},
      position = ${patch.position ?? cur.position},
      archived = ${patch.archived ?? cur.archived},
      updated_at = now()
    WHERE id = ${id} RETURNING *
  `) as Record<string, unknown>[];
  return out[0] ? toResource(out[0]) : null;
}
