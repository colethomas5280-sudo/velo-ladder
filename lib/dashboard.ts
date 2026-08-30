import { sql } from "@/lib/db";
import { isoDate } from "@/lib/data";
import type { TrackerId, Throws } from "@/lib/types";
import { TRACKERS, TRACKER_IDS, sBestG, todayISO } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * Coach dashboard payload — one query, everything computed in memory.
 * A facility's whole history is a few hundred rows; this stays well
 * inside a serverless request.
 * ------------------------------------------------------------------ */

export interface LeaderRow {
  athleteId: string;
  name: string;
  velo: number;
  oz: number;
  tracker: TrackerId;
}
export interface PrRow {
  athleteId: string;
  name: string;
  velo: number;
  previous: number | null;
  oz: number;
  tracker: TrackerId;
  date: string;
}
export interface StaleRow {
  athleteId: string;
  name: string;
  lastDate: string | null;
  days: number | null;
}
export interface ActivityRow {
  athleteId: string;
  name: string;
  tracker: TrackerId;
  date: string;
  best: number | null;
}
export interface DashboardData {
  leaderboard: { date: string | null; rows: LeaderRow[] };
  recentPrs: PrRow[];
  stale: StaleRow[];
  pendingInvites: { athleteId: string; name: string; hasEmail: boolean }[];
  activity: ActivityRow[];
  resources: { id: string; title: string; category: string }[];
  snapshot: {
    athletes: number;
    sessionsThisWeek: number;
    activeThisWeek: number;
    prsThisWeek: number;
  };
}

const STALE_DAYS = 14;
const RECENT_DAYS = 7;

function daysAgo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const then = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  const now = Date.UTC(ty, tm - 1, td);
  return Math.round((now - then) / 86_400_000);
}

interface Row {
  athleteId: string;
  name: string;
  type: TrackerId;
  date: string;
  throws: Throws;
}

export async function getDashboard(): Promise<DashboardData> {
  const athleteRows = (await sql`
    SELECT id, name, invite_email, password_hash, invite_token
    FROM athletes WHERE archived = false ORDER BY lower(name)
  `) as Record<string, unknown>[];

  const sessionRows = (await sql`
    SELECT s.athlete_id, s.type, s.date, s.throws, a.name AS athlete_name
    FROM training_sessions s
    JOIN athletes a ON a.id = s.athlete_id
    WHERE a.archived = false
    ORDER BY s.date ASC, s.created_at ASC
  `) as Record<string, unknown>[];

  const sessions: Row[] = sessionRows.map((r) => ({
    athleteId: String(r.athlete_id),
    name: String(r.athlete_name),
    type: r.type as TrackerId,
    date: isoDate(r.date),
    throws:
      typeof r.throws === "string"
        ? (JSON.parse(r.throws) as Throws)
        : ((r.throws as Throws) ?? {}),
  }));

  /* ---- leaderboard: the most recent day anyone threw ---- */
  const lastDay = sessions.length ? sessions[sessions.length - 1].date : null;
  const leaderRows: LeaderRow[] = [];
  if (lastDay) {
    // best single throw per athlete that day, and which weight it came from
    const bestPer = new Map<string, LeaderRow>();
    for (const s of sessions.filter((x) => x.date === lastDay)) {
      for (const g of TRACKERS[s.type].groups) {
        const v = sBestG({ throws: s.throws } as never, g.keys);
        if (v == null) continue;
        const cur = bestPer.get(s.athleteId);
        if (!cur || v > cur.velo)
          bestPer.set(s.athleteId, {
            athleteId: s.athleteId,
            name: s.name,
            velo: v,
            oz: g.oz,
            tracker: s.type,
          });
      }
    }
    leaderRows.push(...[...bestPer.values()].sort((a, b) => b.velo - a.velo));
  }

  /* ---- PRs: a session whose best beats everything before it ---- */
  const recentPrs: PrRow[] = [];
  let prsThisWeek = 0;
  const byAthlete = new Map<string, Row[]>();
  for (const s of sessions) {
    const arr = byAthlete.get(s.athleteId) ?? [];
    arr.push(s);
    byAthlete.set(s.athleteId, arr);
  }
  for (const [athleteId, rows] of byAthlete) {
    for (const tracker of TRACKER_IDS) {
      const mine = rows.filter((r) => r.type === tracker);
      if (!mine.length) continue;
      for (const g of TRACKERS[tracker].groups) {
        let running: number | null = null;
        for (const s of mine) {
          const v = sBestG({ throws: s.throws } as never, g.keys);
          if (v == null) continue;
          if (running != null && v > running) {
            const age = daysAgo(s.date);
            if (age <= RECENT_DAYS) {
              prsThisWeek++;
              recentPrs.push({
                athleteId,
                name: s.name,
                velo: v,
                previous: running,
                oz: g.oz,
                tracker,
                date: s.date,
              });
            }
          }
          if (running == null || v > running) running = v;
        }
      }
    }
  }
  recentPrs.sort((a, b) => (a.date === b.date ? b.velo - a.velo : a.date < b.date ? 1 : -1));

  /* ---- stale + pending invites ---- */
  const lastByAthlete = new Map<string, string>();
  for (const s of sessions) lastByAthlete.set(s.athleteId, s.date);

  const stale: StaleRow[] = [];
  const pendingInvites: DashboardData["pendingInvites"] = [];
  for (const a of athleteRows) {
    const id = String(a.id);
    const name = String(a.name);
    const last = lastByAthlete.get(id) ?? null;
    const days = last ? daysAgo(last) : null;
    // Someone still setting up their account is listed once, as an invite —
    // "hasn't thrown in a while" is noise until they can actually log in.
    if (!a.password_hash) {
      pendingInvites.push({ athleteId: id, name, hasEmail: !!a.invite_email });
      continue;
    }
    if (last == null || days! >= STALE_DAYS)
      stale.push({ athleteId: id, name, lastDate: last, days });
  }
  stale.sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));

  /* ---- recent activity + snapshot ---- */
  const activity: ActivityRow[] = [...sessions]
    .reverse()
    .slice(0, 8)
    .map((s) => {
      let best: number | null = null;
      for (const g of TRACKERS[s.type].groups) {
        const v = sBestG({ throws: s.throws } as never, g.keys);
        if (v != null && (best == null || v > best)) best = v;
      }
      return {
        athleteId: s.athleteId,
        name: s.name,
        tracker: s.type,
        date: s.date,
        best,
      };
    });

  const resourceRows = (await sql`
    SELECT id, title, category FROM resources WHERE archived = false
    ORDER BY lower(category), position, lower(title) LIMIT 6
  `) as Record<string, unknown>[];

  const thisWeek = sessions.filter((s) => daysAgo(s.date) <= RECENT_DAYS);
  return {
    leaderboard: { date: lastDay, rows: leaderRows },
    recentPrs: recentPrs.slice(0, 8),
    stale: stale.slice(0, 8),
    pendingInvites,
    activity,
    resources: resourceRows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      category: String(r.category ?? ""),
    })),
    snapshot: {
      athletes: athleteRows.length,
      sessionsThisWeek: thisWeek.length,
      activeThisWeek: new Set(thisWeek.map((s) => s.athleteId)).size,
      prsThisWeek,
    },
  };
}
