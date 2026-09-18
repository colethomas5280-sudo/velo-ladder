import { FLAW_KEYS } from "./big12";
import { isCalendarDate } from "./velo";

/* ------------------------------------------------------------------ *
 * Validating a delivery assessment before it is stored
 *
 * All-or-nothing, like the screen write path: a request with one bad value is
 * refused with a message naming it rather than being partly applied.
 *
 * An EMPTY assessment is valid, which is the one real difference. The row is
 * the statement that the delivery was watched, so nothing ticked means
 * "I looked and found nothing" — a result, and the reason the shared row's
 * delivery_assessed column retires with this change.
 * ------------------------------------------------------------------ */

export interface DeliveryInput {
  date: string;
  flaws: Record<string, boolean>;
  notes: string;
}

export interface ParsedDelivery {
  ok: boolean;
  error?: string;
  value?: DeliveryInput;
}

export function parseDeliveryInput(body: unknown, today: string): ParsedDelivery {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  const date = String(b.date ?? "");
  if (!isCalendarDate(date))
    return { ok: false, error: "date must be a real day, as YYYY-MM-DD" };
  if (date > today) return { ok: false, error: "date can't be in the future" };

  if (
    b.flaws !== undefined &&
    (typeof b.flaws !== "object" || b.flaws === null || Array.isArray(b.flaws))
  )
    return { ok: false, error: "flaws must be an object" };

  const raw = (b.flaws ?? {}) as Record<string, unknown>;
  const flaws: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!FLAW_KEYS.has(key)) return { ok: false, error: `unknown flaw '${key}'` };
    // Unticked is an absence. Storing false would make "he does not have this"
    // and "nobody looked" two different-looking records meaning the same thing.
    if (value === true) flaws[key] = true;
  }

  const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : "";

  return { ok: true, value: { date, flaws, notes } };
}
