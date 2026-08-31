import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import type {
  Athlete,
  AthleteOverview,
  TrainingSession,
  Throws,
  TrackerId,
  Resource,
  RecoveryEntry,
  Setback,
} from "@/lib/types";
import { evaluate, CNS_DEFAULT_PCT } from "@/lib/setback";
import type { LeaderboardAthlete } from "./leaderboard";

function toAthlete(r: Record<string, unknown>): Athlete {
  return {
    id: String(r.id),
    name: String(r.name),
    hand: (r.hand as Athlete["hand"]) || "",
    inviteEmail: (r.invite_email as string | null) ?? null,
    hasPassword: !!r.password_hash,
    hasInvite: !!r.invite_token,
    cnsThresholdPct: r.cns_threshold_pct == null ? null : Number(r.cns_threshold_pct),
    birthDate: r.birth_date ? isoDate(r.birth_date) : null,
    level: (r.level as string | null) ?? null,
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
    level: (r.level as string | null) ?? null,
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
    cnsThresholdPct?: number | null;
    level?: string | null;
    birthDate?: string | null;
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
  const cns =
    patch.cnsThresholdPct === undefined
      ? cur.cnsThresholdPct
      : patch.cnsThresholdPct;
  const level = patch.level === undefined ? cur.level : patch.level;
  const birthDate =
    patch.birthDate === undefined ? cur.birthDate : patch.birthDate || null;

  if (patch.password) {
    const hash = await hashPassword(patch.password);
    const rows = (await sql`
      UPDATE athletes
      SET name = ${name}, hand = ${hand}, invite_email = ${inviteEmail},
          archived = ${archived}, cns_threshold_pct = ${cns},
          level = ${level}, birth_date = ${birthDate}, password_hash = ${hash}
      WHERE id = ${id} RETURNING *
    `) as Record<string, unknown>[];
    const updated = rows[0] ? toAthlete(rows[0]) : null;
    if (updated) await stampUnleveledSessions(id, level);
    return updated;
  }

  const rows = (await sql`
    UPDATE athletes
    SET name = ${name}, hand = ${hand}, invite_email = ${inviteEmail},
        archived = ${archived}, cns_threshold_pct = ${cns},
        level = ${level}, birth_date = ${birthDate}
    WHERE id = ${id} RETURNING *
  `) as Record<string, unknown>[];
  const updated = rows[0] ? toAthlete(rows[0]) : null;
  if (updated) await stampUnleveledSessions(id, level);
  return updated;
}

/*
 * Backfill the stamp, once. Sessions that already carry a level are never
 * rewritten, so moving an athlete from Youth to High School leaves his old
 * marks where they were and only new sessions get the new level.
 */
export async function stampUnleveledSessions(
  athleteId: string,
  level: string | null,
): Promise<void> {
  if (!level) return;
  await sql`
    UPDATE training_sessions SET level = ${level}
    WHERE athlete_id = ${athleteId} AND level IS NULL
  `;
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
  level: string | null,
  birthDate: string | null,
): Promise<InviteTarget | null> {
  const hash = await hashPassword(password);
  const rows = (await sql`
    UPDATE athletes
    SET password_hash = ${hash}, invite_token = NULL, invite_expires = NULL,
        level = ${level}, birth_date = ${birthDate}
    WHERE invite_token = ${token}
      AND archived = false
      AND invite_expires IS NOT NULL
      AND invite_expires > now()
    RETURNING id, name, invite_email
  `) as Record<string, unknown>[];
  const r = rows[0];
  if (r) await stampUnleveledSessions(String(r.id), level);
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
  const athlete = await getAthlete(input.athleteId);
  const level = athlete?.level ?? null;
  const rows = (await sql`
    INSERT INTO training_sessions (id, athlete_id, type, date, notes, throws, created_by, level)
    VALUES (${id}, ${input.athleteId}, ${input.type}, ${input.date}, ${input.notes},
            ${JSON.stringify(input.throws)}::jsonb, ${input.createdBy}, ${level})
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

/* ---------------- recovery ---------------- */

function toRecovery(r: Record<string, unknown>): RecoveryEntry {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    athleteId: String(r.athlete_id),
    date: isoDate(r.date),
    sleepHours: n(r.sleep_hours),
    sleepQuality: n(r.sleep_quality),
    soreness: n(r.soreness),
    energy: n(r.energy),
    stress: n(r.stress),
    mood: n(r.mood),
    diet: n(r.diet),
    armReadiness: n(r.arm_readiness),
    bodyWeight: n(r.body_weight),
    sleepDuration: n(r.sleep_duration),
    restingHr: n(r.resting_hr),
    hrv: n(r.hrv),
    armStatus: (r.arm_status as RecoveryEntry["armStatus"]) ?? null,
    notes: String(r.notes ?? ""),
  };
}

export async function listRecovery(athleteId: string): Promise<RecoveryEntry[]> {
  const rows = (await sql`
    SELECT * FROM recovery_entries WHERE athlete_id = ${athleteId}
    ORDER BY date ASC
  `) as Record<string, unknown>[];
  return rows.map(toRecovery);
}

export interface RecoveryInput {
  date: string;
  sleepHours?: number | null;
  sleepQuality?: number | null;
  soreness?: number | null;
  energy?: number | null;
  stress?: number | null;
  mood?: number | null;
  diet?: number | null;
  armReadiness?: number | null;
  bodyWeight?: number | null;
  sleepDuration?: number | null;
  restingHr?: number | null;
  hrv?: number | null;
  armStatus?: import("@/lib/types").ArmStatus | null;
  notes?: string;
}

/**
 * One check-in per athlete per day: saving the same date again updates it
 * rather than stacking duplicates.
 */
export async function upsertRecovery(
  athleteId: string,
  input: RecoveryInput,
  createdBy: string,
): Promise<RecoveryEntry> {
  const id = crypto.randomUUID();
  const rows = (await sql`
    INSERT INTO recovery_entries
      (id, athlete_id, date, sleep_hours, sleep_quality, soreness, energy,
       stress, mood, diet, arm_readiness, body_weight, sleep_duration,
       resting_hr, hrv, arm_status, notes, created_by)
    VALUES
      (${id}, ${athleteId}, ${input.date}, ${input.sleepHours ?? null},
       ${input.sleepQuality ?? null}, ${input.soreness ?? null},
       ${input.energy ?? null}, ${input.stress ?? null}, ${input.mood ?? null},
       ${input.diet ?? null}, ${input.armReadiness ?? null},
       ${input.bodyWeight ?? null}, ${input.sleepDuration ?? null},
       ${input.restingHr ?? null}, ${input.hrv ?? null},
       ${input.armStatus ?? null}, ${input.notes ?? ""}, ${createdBy})
    ON CONFLICT (athlete_id, date) DO UPDATE SET
      sleep_hours = EXCLUDED.sleep_hours,
      sleep_quality = EXCLUDED.sleep_quality,
      soreness = EXCLUDED.soreness,
      energy = EXCLUDED.energy,
      stress = EXCLUDED.stress,
      mood = EXCLUDED.mood,
      diet = EXCLUDED.diet,
      arm_readiness = EXCLUDED.arm_readiness,
      body_weight = EXCLUDED.body_weight,
      sleep_duration = EXCLUDED.sleep_duration,
      resting_hr = EXCLUDED.resting_hr,
      hrv = EXCLUDED.hrv,
      arm_status = EXCLUDED.arm_status,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING *
  `) as Record<string, unknown>[];
  return toRecovery(rows[0]);
}

export async function deleteRecovery(
  athleteId: string,
  date: string,
): Promise<void> {
  await sql`DELETE FROM recovery_entries WHERE athlete_id = ${athleteId} AND date = ${date}`;
}

/* ---------------- setbacks ---------------- */

function toSetback(r: Record<string, unknown>): Setback {
  return {
    id: String(r.id),
    athleteId: String(r.athlete_id),
    kind: r.kind as Setback["kind"],
    openedOn: isoDate(r.opened_on),
    resolvedOn: r.resolved_on ? isoDate(r.resolved_on) : null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    detail: String(r.detail ?? ""),
    severity: (r.severity as string | null) ?? null,
  };
}

export async function listSetbacks(
  athleteId: string,
  opts: { openOnly?: boolean } = {},
): Promise<Setback[]> {
  const rows = opts.openOnly
    ? await sql`SELECT * FROM setbacks WHERE athlete_id = ${athleteId} AND resolved_on IS NULL ORDER BY opened_on DESC`
    : await sql`SELECT * FROM setbacks WHERE athlete_id = ${athleteId} ORDER BY opened_on DESC LIMIT 40`;
  return (rows as Record<string, unknown>[]).map(toSetback);
}

/** Every open flag across the roster, for the coach dashboard. */
export async function listOpenSetbacks(): Promise<
  (Setback & { name: string })[]
> {
  const rows = (await sql`
    SELECT s.*, a.name FROM setbacks s
    JOIN athletes a ON a.id = s.athlete_id
    WHERE s.resolved_on IS NULL AND a.archived = false
    ORDER BY
      CASE s.kind WHEN 'injury' THEN 0 WHEN 'cns' THEN 1 ELSE 2 END,
      s.opened_on
  `) as Record<string, unknown>[];
  return rows.map((r) => ({ ...toSetback(r), name: String(r.name) }));
}

export async function resolveSetback(
  id: string,
  by: string,
): Promise<Setback | null> {
  const rows = (await sql`
    UPDATE setbacks SET resolved_on = CURRENT_DATE, resolved_by = ${by}
    WHERE id = ${id} AND resolved_on IS NULL
    RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? toSetback(rows[0]) : null;
}

/**
 * Bring the stored flags in line with what the data currently says. Runs after
 * any session or check-in is written, so no scheduled job is needed.
 *
 * Soreness and CNS open and close themselves. Injury opens automatically but
 * is NEVER auto-resolved — a coach has to review it before an athlete goes
 * back to full-intent work.
 */
export async function reconcileSetbacks(athleteId: string): Promise<Setback[]> {
  const athlete = await getAthlete(athleteId);
  if (!athlete || athlete.archived) return [];

  const [sessions, entries, open] = await Promise.all([
    listSessions(athleteId),
    listRecovery(athleteId),
    listSetbacks(athleteId, { openOnly: true }),
  ]);

  const findings = evaluate(
    sessions,
    entries,
    athlete.cnsThresholdPct ?? CNS_DEFAULT_PCT,
  );
  const firing = new Set(findings.map((f) => f.kind));

  for (const f of findings) {
    const already = open.find((o) => o.kind === f.kind);
    if (already) {
      // Keep the reason current — a soreness flag opened on day 1 should read
      // "3 days running" by day 3, not still say 1.
      if (already.detail !== f.detail)
        await sql`UPDATE setbacks SET detail = ${f.detail} WHERE id = ${already.id}`;
      /*
       * Severity only ever escalates. It records how bad this episode got at
       * its worst, so a later, milder report can't walk a shutdown back — that
       * is the coach's call, made by clearing the flag.
       */
      if (f.severity === "pain-limiting" && already.severity !== "pain-limiting")
        await sql`UPDATE setbacks SET severity = ${f.severity} WHERE id = ${already.id}`;
      continue;
    }
    await sql`
      INSERT INTO setbacks (id, athlete_id, kind, opened_on, detail, severity)
      VALUES (${crypto.randomUUID()}, ${athleteId}, ${f.kind}, CURRENT_DATE,
              ${f.detail}, ${f.severity ?? null})
    `;
  }

  for (const o of open) {
    if (o.kind === "injury") continue; // human checkpoint required
    if (!firing.has(o.kind))
      await sql`
        UPDATE setbacks SET resolved_on = CURRENT_DATE, resolved_by = 'auto'
        WHERE id = ${o.id} AND resolved_on IS NULL
      `;
  }

  return listSetbacks(athleteId, { openOnly: true });
}

/**
 * Everything the leaderboard needs, and nothing else. Archived athletes are
 * included on purpose: a departing athlete should not wipe a facility record
 * he set.
 */
export async function listLeaderboardData(): Promise<{
  athletes: LeaderboardAthlete[];
  sessions: TrainingSession[];
}> {
  const [aRows, sRows] = await Promise.all([
    sql`SELECT id, name, hand, birth_date, level FROM athletes`,
    sql`SELECT * FROM training_sessions`,
  ]);
  return {
    athletes: (aRows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      hand: (r.hand as string) || "",
      birthDate: r.birth_date ? isoDate(r.birth_date) : null,
      level: (r.level as LeaderboardAthlete["level"]) ?? null,
    })),
    sessions: (sRows as Record<string, unknown>[]).map(toSession),
  };
}
