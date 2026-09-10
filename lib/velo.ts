import type { TrackerId, Throws, TrainingSession } from "./types";

/* ------------------------------------------------------------------ *
 * Tracker configuration
 *
 * A "slot" is one weight column in the entry form (Pull-Down has two
 * 5 oz columns). A "group" folds one or more slots into a single record
 * — the two Pull-Down 5 oz sets share one 5 oz PR / average / floor.
 * ------------------------------------------------------------------ */

export interface Slot {
  key: string;
  oz: number;
  tag?: string;
}
export interface Group {
  oz: number;
  keys: string[];
}
export interface TrackerConfig {
  label: string;
  tag: string;
  slots: Slot[];
  groups: Group[];
}

export const TRACKERS: Record<TrackerId, TrackerConfig> = {
  mound: {
    label: "Mound",
    tag: "off the mound · game posture",
    // Same 5-6-7-5-4-3 ladder as pull-downs. "m5b" is the second 5 oz set; it
    // was added after the first sessions were logged, so older mound sessions
    // simply have no m5b entry and still read correctly.
    slots: [
      { key: "m5", oz: 5 },
      { key: "m6", oz: 6 },
      { key: "m7", oz: 7 },
      { key: "m5b", oz: 5 },
      { key: "m4", oz: 4 },
      { key: "m3", oz: 3 },
    ],
    groups: [
      { oz: 5, keys: ["m5", "m5b"] },
      { oz: 6, keys: ["m6"] },
      { oz: 7, keys: ["m7"] },
      { oz: 4, keys: ["m4"] },
      { oz: 3, keys: ["m3"] },
    ],
  },
  pulldown: {
    label: "Pull-Down",
    tag: "run-and-gun · max intent",
    slots: [
      { key: "p1", oz: 5 },
      { key: "p2", oz: 6 },
      { key: "p3", oz: 7 },
      { key: "p4", oz: 5 },
      { key: "p5", oz: 4 },
      { key: "p6", oz: 3 },
    ],
    groups: [
      { oz: 5, keys: ["p1", "p4"] },
      { oz: 6, keys: ["p2"] },
      { oz: 7, keys: ["p3"] },
      { oz: 4, keys: ["p5"] },
      { oz: 3, keys: ["p6"] },
    ],
  },
};

export const TRACKER_IDS: TrackerId[] = ["mound", "pulldown"];

/** All valid slot keys across both trackers — used for server-side validation. */
export const ALL_SLOT_KEYS = new Set(
  TRACKER_IDS.flatMap((t) => TRACKERS[t].slots.map((s) => s.key)),
);
export function slotKeysFor(type: TrackerId): Set<string> {
  return new Set(TRACKERS[type].slots.map((s) => s.key));
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export const EMPTY = "–"; // en-dash

export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) && n > 0 ? n : null;
}
export function mean(a: number[]): number | null {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
/**
 * Velocity for display: at most one decimal, and no trailing ".0".
 * 94.85 -> "94.9", 87 -> "87", 84.3 -> "84.3". Used for every velocity on
 * screen (PR, floor, average, session best) so they all read the same way.
 */
export function fmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return EMPTY;
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
/**
 * True iff `value` is a real `YYYY-MM-DD` calendar day.
 *
 * A shape-only regex is not enough. `2026-02-30` matches it, passes every
 * validator that only checks the shape, and dies in Postgres as
 * "date/time field value out of range" — a 500 where a 400 naming the problem
 * belongs. The round-trip through UTC is what catches a day that doesn't
 * exist: February 30th comes back out as March 2nd.
 *
 * Says nothing about whether the date is sensible — too old, in the future —
 * because those bounds differ per field. Callers add their own.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  /*
   * A full round-trip, and each part earns its place differently.
   *
   * The YEAR check is the only thing that catches a two-digit year: JS maps
   * 0-99 to 1900+, so `0099-06-15` comes back as 1999 with the month and day
   * intact. That is the half-typed year a native date input emits while
   * someone is still typing.
   *
   * Month and day catch everything else, and they are redundant with EACH
   * OTHER: an overflowing day rolls into the next month, and an overflowing
   * month rolls the year. Either one alone would do alongside the year check.
   * Both are kept because a round-trip that compares two thirds of a date is
   * something the next reader has to reason about rather than read.
   */
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export function fmtDate(iso: string): string {
  // Anything that isn't a real day goes back out as it came in. It used to
  // count hyphens and hand the pieces to Date, so "a-b-c" printed on screen
  // as the words "Invalid Date".
  if (!isCalendarDate(iso)) return iso || "";
  const p = iso.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function fmtDateShort(iso: string): string {
  if (!isCalendarDate(iso)) return iso || "";
  const p = iso.split("-");
  return `${+p[1]}/${+p[2]}`;
}
/**
 * Whole days from `a` to `b`, both YYYY-MM-DD. Negative when `b` is earlier.
 * Built in UTC so a daylight-saving boundary can't produce a 23-hour "day".
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/** `iso` moved by `delta` days, still YYYY-MM-DD. */
export function shiftDate(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Stats — everything works off the 100% throws (indices 1..4);
 * index 0 (the 80% primer) is never scored.
 * ------------------------------------------------------------------ */

/**
 * Boxes per weight: index 0 is the 80% primer, 1..4 are the 100% throws.
 * Sessions logged when there were only 3 scored boxes are stored as length-4
 * arrays; every read below walks the array it is given rather than assuming a
 * length, so both shapes work.
 */
export const BOXES_PER_SLOT = 5;
export const BOX_INDEXES = [0, 1, 2, 3, 4] as const;

/**
 * How many boxes at the front of a slot are primers rather than scored throws.
 *
 * Box 0 is the 80% primer. Nothing scores it — not the PR, not the average,
 * not the floor, and not the "did they enter a real throw" guard. It is the
 * single most load-bearing rule in the velocity half of the app, and it was
 * written three separate ways in this file: `slice(1)` twice and a loop
 * starting at 1. Three copies of one decision is three places for it to stop
 * agreeing.
 */
export const PRIMER_BOXES = 1;

/** The scored throws in a slot — everything after the primer. */
export function scoredBoxes<T>(slot: readonly T[]): T[] {
  return slot.slice(PRIMER_BOXES);
}

function hundredsOfSlot(sessions: TrainingSession[], key: string): number[] {
  const out: number[] = [];
  for (const s of sessions) {
    const t = s.throws[key];
    if (!t) continue;
    for (const box of scoredBoxes(t)) {
      const v = num(box);
      if (v) out.push(v);
    }
  }
  return out;
}

export function sBest(s: TrainingSession, key: string): number | null {
  const t = s.throws[key];
  if (!t) return null;
  let m: number | null = null;
  for (let i = 1; i < t.length; i++) {
    const v = num(t[i]);
    if (v) m = m == null ? v : Math.max(m, v);
  }
  return m;
}
export function sAvg(s: TrainingSession, key: string): number | null {
  const t = s.throws[key];
  if (!t) return null;
  const a: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const v = num(t[i]);
    if (v) a.push(v);
  }
  return mean(a);
}

export interface RecordStats {
  n: number;
  pr: number | null;
  avg: number | null;
  min: number | null;
}

export function hundredsG(sessions: TrainingSession[], keys: string[]): number[] {
  return keys.flatMap((k) => hundredsOfSlot(sessions, k));
}
export function sBestG(s: TrainingSession, keys: string[]): number | null {
  let m: number | null = null;
  for (const k of keys) {
    const b = sBest(s, k);
    if (b != null) m = m == null ? b : Math.max(m, b);
  }
  return m;
}
export function sAvgG(s: TrainingSession, keys: string[]): number | null {
  const a: number[] = [];
  for (const k of keys) {
    const t = s.throws[k];
    if (t) for (let i = 1; i < t.length; i++) {
      const v = num(t[i]);
      if (v) a.push(v);
    }
  }
  return mean(a);
}
export function sMinG(s: TrainingSession, keys: string[]): number | null {
  let m: number | null = null;
  for (const k of keys) {
    const t = s.throws[k];
    if (t) for (let i = 1; i < t.length; i++) {
      const v = num(t[i]);
      if (v) m = m == null ? v : Math.min(m, v);
    }
  }
  return m;
}
export function recStatsG(sessions: TrainingSession[], keys: string[]): RecordStats {
  const h = hundredsG(sessions, keys);
  return {
    n: h.length,
    pr: h.length ? Math.max(...h) : null,
    avg: mean(h),
    min: h.length ? Math.min(...h) : null,
  };
}

export function gid(g: Group): string {
  return g.keys.join("+");
}
export function groupById(cfg: TrackerConfig, id: string | undefined): Group {
  return cfg.groups.find((g) => gid(g) === id) || cfg.groups[0];
}
export function groupOf(cfg: TrackerConfig, key: string): Group {
  return cfg.groups.find((g) => g.keys.includes(key)) || { oz: 0, keys: [key] };
}

export function fiveOzPR(sessions: TrainingSession[], type: TrackerId): number | null {
  const g = TRACKERS[type].groups.find((x) => x.oz === 5);
  return g ? recStatsG(sessions, g.keys).pr : null;
}

/** A velocity together with the session date it happened on. */
export interface DatedValue {
  value: number;
  date: string;
}

/** Previous session's best for a record group, skipping the session being edited. */
export function lastBest(
  sessions: TrainingSession[],
  keys: string[],
  skipId?: string | null,
): DatedValue | null {
  const sorted = [...sessions].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : -1,
  );
  for (const s of sorted) {
    if (skipId && s.id === skipId) continue;
    const v = sBestG(s, keys);
    if (v != null) return { value: v, date: s.date };
  }
  return null;
}

/**
 * All-time best for a record group and the date it was set. On a tie the
 * earliest session wins — that is when the athlete first reached it.
 */
export function prWithDate(
  sessions: TrainingSession[],
  keys: string[],
): DatedValue | null {
  let best: DatedValue | null = null;
  for (const s of sessions) {
    const v = sBestG(s, keys);
    if (v == null) continue;
    if (!best || v > best.value || (v === best.value && s.date < best.date))
      best = { value: v, date: s.date };
  }
  return best;
}

export function sessionsOfType(
  sessions: TrainingSession[],
  type: TrackerId,
): TrainingSession[] {
  return sessions
    .filter((s) => s.type === type)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
    );
}

/* ------------------------------------------------------------------ *
 * Session-write validation (mirrors the client entry guard)
 * ------------------------------------------------------------------ */

export interface SessionInput {
  type: TrackerId;
  date: string;
  notes?: string;
  throws: Throws;
}

export function validateSessionInput(input: unknown): {
  ok: boolean;
  error?: string;
  value?: SessionInput;
} {
  if (!input || typeof input !== "object") return { ok: false, error: "Body must be an object" };
  const o = input as Record<string, unknown>;

  if (o.type !== "mound" && o.type !== "pulldown")
    return { ok: false, error: "type must be 'mound' or 'pulldown'" };
  const type = o.type as TrackerId;

  const date = String(o.date || "");
  if (!isCalendarDate(date))
    return { ok: false, error: "date must be a real day, as YYYY-MM-DD" };

  const notes = typeof o.notes === "string" ? o.notes.slice(0, 2000) : "";

  if (!o.throws || typeof o.throws !== "object")
    return { ok: false, error: "throws must be an object" };
  const validKeys = slotKeysFor(type);
  const throws: Throws = {};
  let hasHundred = false;
  for (const [k, raw] of Object.entries(o.throws as Record<string, unknown>)) {
    if (!validKeys.has(k)) return { ok: false, error: `unknown slot '${k}' for ${type}` };
    if (!Array.isArray(raw) || raw.length < 4 || raw.length > BOXES_PER_SLOT)
      return { ok: false, error: `throws['${k}'] must be an array of 4 or ${BOXES_PER_SLOT}` };
    const arr = raw.map((v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return isFinite(n) && n > 0 && n <= 130 ? n : null;
    });
    if (arr.some((v) => v != null)) throws[k] = arr;
    if (scoredBoxes(arr).some((v) => v != null)) hasHundred = true;
  }
  if (!hasHundred) return { ok: false, error: "at least one 100% throw is required" };

  return { ok: true, value: { type, date, notes, throws } };
}

/* ------------------------------------------------------------------ *
 * Draft -> session payload (client side, before POST)
 * ------------------------------------------------------------------ */

export function throwsFromDraft(
  draftThrows: Record<string, string[]>,
  slotKeys: string[],
): { throws: Throws; hasHundred: boolean } {
  const throws: Throws = {};
  for (const key of slotKeys) {
    const raw = draftThrows[key];
    if (!raw) continue;
    const arr = BOX_INDEXES.map((i) => num(raw[i]));
    if (arr.some((v) => v != null)) throws[key] = arr;
  }
  const hasHundred = Object.values(throws).some((a) =>
    scoredBoxes(a).some((v) => v != null),
  );
  return { throws, hasHundred };
}

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */

export function sessionsToCsv(
  athleteName: string,
  sessions: TrainingSession[],
): string {
  const rows: (string | number)[][] = [
    [
      "athlete",
      "date",
      "tracker",
      "weight_oz",
      "slot",
      "throw_80",
      "throw_1",
      "throw_2",
      "throw_3",
      "throw_4",
      "session_max",
      "session_avg",
    ],
  ];
  for (const type of TRACKER_IDS) {
    for (const s of sessionsOfType(sessions, type)) {
      for (const sl of TRACKERS[type].slots) {
        const t = s.throws[sl.key];
        if (!t) continue;
        const best = sBest(s, sl.key);
        const avg = sAvg(s, sl.key);
        rows.push([
          athleteName,
          s.date,
          type,
          sl.oz,
          sl.key,
          t[0] ?? "",
          t[1] ?? "",
          t[2] ?? "",
          t[3] ?? "",
          t[4] ?? "",
          best == null ? "" : fmt(best),
          avg == null ? "" : fmt(avg),
        ]);
      }
    }
  }
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}
