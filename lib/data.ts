import bcrypt from "bcryptjs";
import { sql, pgPool } from "@/lib/db";
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
import { joinName, splitName } from "./profile";
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
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    heightIn: r.height_in == null ? null : Number(r.height_in),
    weightLb: r.weight_lb == null ? null : Number(r.weight_lb),
    weightSource: (r.weight_source as string | null) ?? null,
    weightAt: r.weight_at ? isoDate(r.weight_at) : null,
    bats: (r.bats as string | null) ?? null,
    positions: (r.positions as string | null) ?? null,
    school: (r.school as string | null) ?? null,
    hsGradYear: r.hs_grad_year == null ? null : Number(r.hs_grad_year),
    collegeGradYear: r.college_grad_year == null ? null : Number(r.college_grad_year),
    status: (r.status as string | null) ?? null,
    guardianName: (r.guardian_name as string | null) ?? null,
    guardianPhone: (r.guardian_phone as string | null) ?? null,
    emergencyContact: (r.emergency_contact as string | null) ?? null,
    injuryNotes: (r.injury_notes as string | null) ?? null,
    coachNotes: (r.coach_notes as string | null) ?? null,
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
  // Split on insert so a new athlete is never stored unsplit, and derive `name`
  // from the halves so it can only ever be first + " " + last.
  const { first, last } = splitName(input.name);
  const name = joinName(first, last) || input.name.trim();
  const rows = (await sql`
    INSERT INTO athletes (id, name, hand, invite_email, password_hash, first_name, last_name)
    VALUES (${id}, ${name}, ${input.hand || ""}, ${email}, ${hash}, ${first}, ${last})
    RETURNING *
  `) as Record<string, unknown>[];
  return toAthlete(rows[0]);
}

/**
 * Column for each camelCase profile key. Driving the write off one map, rather
 * than seventeen hand-written ternaries, is what keeps a field from being
 * silently forgotten on the way to the database.
 */
const PROFILE_COLUMNS = {
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone",
  heightIn: "height_in",
  weightLb: "weight_lb",
  weightSource: "weight_source",
  weightAt: "weight_at",
  bats: "bats",
  positions: "positions",
  school: "school",
  hsGradYear: "hs_grad_year",
  collegeGradYear: "college_grad_year",
  status: "status",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  emergencyContact: "emergency_contact",
  injuryNotes: "injury_notes",
  coachNotes: "coach_notes",
  level: "level",
  birthDate: "birth_date",
  hand: "hand",
  inviteEmail: "invite_email",
} satisfies Record<string, string>;

/**
 * Every profile key accepts `undefined` (leave the stored value alone), a
 * value, or `null` (clear it). `name` stays accepted for the roster's inline
 * rename, but is never written directly — it is derived from first + last.
 */
export type AthletePatch = Partial<
  Record<keyof typeof PROFILE_COLUMNS, string | number | null>
> & {
  name?: string | null;
  archived?: boolean;
  password?: string;
  cnsThresholdPct?: number | null;
};

export async function updateAthlete(
  id: string,
  patch: AthletePatch,
): Promise<Athlete | null> {
  const cur = await getAthlete(id);
  if (!cur) return null;

  // The roster's inline rename PATCHes `name` directly. Accept it, split it,
  // and let the derivation below rebuild `name` — otherwise renaming an
  // athlete silently stops working.
  if (
    patch.name !== undefined &&
    patch.firstName === undefined &&
    patch.lastName === undefined
  ) {
    const s = splitName(String(patch.name ?? ""));
    patch.firstName = s.first;
    patch.lastName = s.last;
  }

  // Logins are matched on lower(invite_email), so a raw write of
  // "Bob@Example.COM " would lock that athlete out of his own account.
  if (patch.inviteEmail !== undefined)
    patch.inviteEmail =
      String(patch.inviteEmail ?? "").trim().toLowerCase() || null;

  /*
   * `name` is a display string, never independently authored. Deriving it
   * here — the single write path — is what stops it drifting from the
   * first/last columns the profile edits.
   */
  const first =
    patch.firstName !== undefined
      ? String(patch.firstName ?? "")
      : cur.firstName ?? splitName(cur.name).first;
  const last =
    patch.lastName !== undefined
      ? String(patch.lastName ?? "")
      : cur.lastName ?? splitName(cur.name).last;
  const name = joinName(first, last) || cur.name;

  /*
   * Build the SET list from only the keys actually present in the patch. An
   * absent key is never mentioned in the UPDATE; a key set to `null` is
   * written as NULL. `name` is always set, since it is derived, not supplied.
   */
  const cols: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    cols.push(`${col} = $${vals.length}`);
  };

  set("name", name);
  for (const [key, col] of Object.entries(PROFILE_COLUMNS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) set(col, v);
  }
  if (patch.archived !== undefined) set("archived", patch.archived);
  if (patch.cnsThresholdPct !== undefined)
    set("cns_threshold_pct", patch.cnsThresholdPct);
  if (patch.password) set("password_hash", await hashPassword(patch.password));

  vals.push(id);
  const rows = (
    await pgPool.query(
      `UPDATE athletes SET ${cols.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    )
  ).rows;
  const updated = rows[0] ? toAthlete(rows[0]) : null;

  const level =
    patch.level === undefined ? cur.level : (patch.level as string | null);
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
  // COALESCE, not assignment: the athlete can fill a blank the coach left, but
  // must never clear a value the coach already entered. Re-inviting is how the
  // app does password recovery (AthletesTable "New invite"), and both pickers
  // default to empty, so an unconditional write silently nulls the coach's
  // level + birth date every time an existing athlete redeems a fresh link.
  const rows = (await sql`
    UPDATE athletes
    SET password_hash = ${hash}, invite_token = NULL, invite_expires = NULL,
        level = COALESCE(${level}::text, level),
        birth_date = COALESCE(${birthDate}::date, birth_date)
    WHERE invite_token = ${token}
      AND archived = false
      AND invite_expires IS NOT NULL
      AND invite_expires > now()
    RETURNING id, name, invite_email
  `) as Record<string, unknown>[];
  const r = rows[0];
  // Deliberately NOT stamping existing sessions from the athlete's self-declared
  // level: a wrong pick ("Pro" at 15) would permanently rewrite his whole
  // history with no UI to undo it. athletes.level is still set, so his FUTURE
  // sessions stamp correctly; the backfill of existing history waits for the
  // coach's first roster edit — which is what makes "coach edits win" true.
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
    sql`SELECT * FROM training_sessions ORDER BY date ASC, created_at ASC, id ASC`,
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
