import { isCalendarDate } from "./velo";
import {
  MAX_REPS,
  MAX_SECONDS,
  MAX_SETS,
  MAX_WEIGHT,
  type Lift,
  type LiftSet,
  type Lifts,
  type Menu,
} from "./strength";

/* ------------------------------------------------------------------ *
 * Validating a lifting day before it is stored
 *
 * All-or-nothing, like the screen and the profile: a request with one bad set
 * is refused with a message naming it, rather than being partly applied. A
 * day half-saved is worse than one not saved — the athlete has racked the bar
 * believing it was recorded.
 *
 * The rejections are worth being fussy about here. Weight and reps are the
 * two numbers the whole tracker is built on, and a slipped keypad sets a PR
 * that no real session will ever beat.
 * ------------------------------------------------------------------ */

export interface ParsedLiftDay {
  ok: boolean;
  error?: string;
  value?: { date: string; lifts: Lifts; notes: string };
}

/** Blank in any of the spellings a form can produce. */
const blank = (v: unknown) => v === null || v === undefined || v === "";

function parseSet(
  raw: unknown,
  lift: Lift,
  n: number,
): { set: LiftSet | null } | { error: string } {
  const where = `set ${n} of ${lift.name}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: `${where} must be an object` };
  const s = raw as Record<string, unknown>;

  const hasW = !blank(s.w);
  const hasR = !blank(s.r);
  // A row the athlete tabbed through and left empty is not an error.
  if (!hasW && !hasR) return { set: null };

  // On a hold, `r` is seconds — same field, and the mode says what it counts.
  const counts = lift.mode === "time" ? "seconds" : "reps";
  const ceiling = lift.mode === "time" ? MAX_SECONDS : MAX_REPS;
  if (!hasR) return { error: `${where} has a weight but no ${counts}` };
  const r = Number(s.r);
  if (!Number.isInteger(r) || r < 1 || r > ceiling)
    return {
      error: `${where}: ${counts} must be a whole number from 1 to ${ceiling}`,
    };

  /*
   * Weight is required on a loaded lift and optional on a bodyweight one,
   * where blank means plain bodyweight and a number means what was hung on.
   * Reps with no weight on a bench press is a half-written set, not a set at
   * bodyweight, so it is refused rather than stored as zero.
   */
  if (!hasW) {
    if (lift.mode === "load") return { error: `${where} has ${counts} but no weight` };
    return { set: { w: 0, r } };
  }

  const w = Number(s.w);
  if (!Number.isFinite(w) || w < 0 || w > MAX_WEIGHT)
    return { error: `${where}: weight must be between 0 and ${MAX_WEIGHT} lb` };
  if (lift.mode === "load" && w <= 0)
    return { error: `${where}: weight must be more than 0` };

  // Half-pound microplates are real; anything finer is a typo.
  return { set: { w: Math.round(w * 2) / 2, r } };
}

export function parseLiftInput(
  body: unknown,
  today: string,
  menu: Menu,
): ParsedLiftDay {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  const date = String(b.date ?? "");
  if (!isCalendarDate(date))
    return { ok: false, error: "date must be a real day, as YYYY-MM-DD" };
  if (date > today) return { ok: false, error: "date can't be in the future" };

  if (b.lifts !== undefined && (typeof b.lifts !== "object" || b.lifts === null))
    return { ok: false, error: "lifts must be an object" };
  const raw = (b.lifts ?? {}) as Record<string, unknown>;

  /*
   * Only LIVE lifts can be written to. Retiring one closes its write path in
   * the same action that takes it off the form — otherwise a stale tab, or
   * anyone with the endpoint, could keep filing sets under a movement the
   * coach has removed from the program.
   */
  const allowed = new Map(menu.lifts.map((l) => [l.key, l]));
  const out: Lifts = {};

  for (const [key, value] of Object.entries(raw)) {
    const lift = allowed.get(key);
    if (!lift) return { ok: false, error: `unknown lift '${key}'` };
    if (value === null) continue; // cleared
    if (!Array.isArray(value))
      return { ok: false, error: `'${menu.name(key)}' must be a list of sets` };
    if (value.length > MAX_SETS)
      return {
        ok: false,
        error: `${lift.name}: ${value.length} sets is more than the ${MAX_SETS} we record`,
      };

    const sets: LiftSet[] = [];
    for (let i = 0; i < value.length; i++) {
      const parsed = parseSet(value[i], lift, i + 1);
      if ("error" in parsed) return { ok: false, error: parsed.error };
      if (parsed.set) sets.push(parsed.set);
    }
    // A lift whose rows were all left blank is simply not part of the day.
    if (sets.length) out[key] = sets;
  }

  const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : "";
  if (!Object.keys(out).length && !notes.trim())
    return { ok: false, error: "Record at least one set" };

  return { ok: true, value: { date, lifts: out, notes } };
}
