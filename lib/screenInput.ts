import { isCalendarDate } from "./velo";
import { FLAW_KEYS } from "./big12";
import {
  NOT_TESTED,
  SCREEN_TESTS,
  screenFields,
  subTestFindings,
  type Results,
  type ScreenTest,
} from "./screen";

/* ------------------------------------------------------------------ *
 * Validating a screen before it is stored
 *
 * All-or-nothing, like the profile write path: a request with one bad value
 * is refused with a message naming it, rather than being partly applied. A
 * screen half-saved is worse than one not saved — the coach has walked away
 * believing it was recorded.
 * ------------------------------------------------------------------ */

export interface ParsedScreen {
  ok: boolean;
  error?: string;
  value?: {
    date: string;
    results: Results;
    notes: string;
    flaws: Record<string, boolean>;
    deliveryAssessed: boolean;
  };
}

export function parseScreenInput(
  body: unknown,
  today: string,
  tests: ScreenTest[] = SCREEN_TESTS,
): ParsedScreen {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  const date = String(b.date ?? "");
  if (!isCalendarDate(date))
    return { ok: false, error: "date must be a real day, as YYYY-MM-DD" };
  if (date > today) return { ok: false, error: "date can't be in the future" };

  if (b.results !== undefined && (typeof b.results !== "object" || b.results === null))
    return { ok: false, error: "results must be an object" };
  const raw = (b.results ?? {}) as Record<string, unknown>;

  const allowed = new Map(screenFields(tests).map((f) => [f.key, f]));
  const results: Results = {};

  for (const [key, value] of Object.entries(raw)) {
    const field = allowed.get(key);
    if (!field) return { ok: false, error: `unknown field '${key}'` };
    if (value === null || value === "") continue; // cleared: leave it unrecorded
    if (typeof value !== "string")
      return { ok: false, error: `'${key}' must be a finding key` };
    if (value === NOT_TESTED) {
      results[key] = NOT_TESTED;
      continue;
    }
    if (!subTestFindings(field.subTest).some((f) => f.key === value))
      return { ok: false, error: `'${value}' is not a finding of '${key}'` };
    /*
     * An answer to a sub-test whose branch is currently closed is kept, not
     * stripped. A coach who picks a follow-up and then changes the answer
     * above it would otherwise lose the work if they changed it back, and the
     * read path already ignores answers on branches that never happened.
     */
    results[key] = value;
  }

  const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : "";

  if (b.flaws !== undefined && (typeof b.flaws !== "object" || b.flaws === null))
    return { ok: false, error: "flaws must be an object" };
  const rawFlaws = (b.flaws ?? {}) as Record<string, unknown>;
  const flaws: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawFlaws)) {
    if (!FLAW_KEYS.has(key)) return { ok: false, error: `unknown flaw '${key}'` };
    // Unticked is an absence. Storing false would make "he does not have
    // this" and "nobody looked" two different-looking records that mean the
    // same thing, which is exactly what deliveryAssessed is for instead.
    if (value === true) flaws[key] = true;
  }

  const deliveryAssessed = b.deliveryAssessed === true;
  if (!deliveryAssessed && Object.keys(flaws).length > 0)
    return {
      ok: false,
      error: "a screen with flaws marked must say the delivery was assessed",
    };

  // An assessed delivery is itself a recorded finding, even with nothing
  // marked on it — that is what distinguishes "clean" from "never looked".
  if (!Object.keys(results).length && !notes.trim() && !deliveryAssessed)
    return { ok: false, error: "Record at least one finding" };

  return { ok: true, value: { date, results, notes, flaws, deliveryAssessed } };
}
