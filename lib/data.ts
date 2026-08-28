import { sql } from "@/lib/db";
import type { Athlete, TrainingSession, Throws, TrackerId } from "@/lib/types";

function toAthlete(r: Record<string, unknown>): Athlete {
  return {
    id: String(r.id),
    name: String(r.name),
    hand: (r.hand as Athlete["hand"]) || "",
    inviteEmail: (r.invite_email as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    archived: Boolean(r.archived),
  };
}

function isoDate(v: unknown): string {
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

export async function listAthletes(opts: {
  ids?: string[];
} = {}): Promise<Athlete[]> {
  const rows = opts.ids
    ? await sql`SELECT * FROM athletes WHERE archived = false AND id = ANY(${opts.ids}) ORDER BY lower(name)`
    : await sql`SELECT * FROM athletes WHERE archived = false ORDER BY lower(name)`;
  return (rows as Record<string, unknown>[]).map(toAthlete);
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
}): Promise<Athlete> {
  const id = crypto.randomUUID();
  const email = input.inviteEmail?.trim().toLowerCase() || null;
  const rows = (await sql`
    INSERT INTO athletes (id, name, hand, invite_email)
    VALUES (${id}, ${input.name.trim()}, ${input.hand || ""}, ${email})
    RETURNING *
  `) as Record<string, unknown>[];
  // link immediately if that email already has a login
  if (email) {
    await sql`
      UPDATE athletes SET user_id = u.id
      FROM users u
      WHERE athletes.id = ${id} AND athletes.user_id IS NULL AND lower(u.email) = ${email}
    `;
  }
  return toAthlete(rows[0]);
}

export async function updateAthlete(
  id: string,
  patch: { name?: string; hand?: string; inviteEmail?: string | null; archived?: boolean },
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
  const rows = (await sql`
    UPDATE athletes
    SET name = ${name}, hand = ${hand}, invite_email = ${inviteEmail}, archived = ${archived}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? toAthlete(rows[0]) : null;
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
