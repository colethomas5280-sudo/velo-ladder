import { PROFILE_FIELDS, editableKeys, type ProfileField } from "./profile";
import { isValidBirthDate } from "./leaderboard";

export type Parsed =
  | { ok: true; patch: Record<string, string | number | null> }
  | { ok: false; error: string };

/**
 * Required name fields that may never be blanked. Both are `required`, and
 * the schema's name backfill uses `first_name IS NULL` as its "never split
 * this athlete" marker — so a write that clears a first name lets the next
 * `/api/setup` re-split it out of `name` and undo a coach's correction.
 * An explicit null (or an emptied "") for these is a 400, not a clear.
 */
const NON_NULLABLE = new Set(["firstName", "lastName"]);

function parseOne(
  f: ProfileField,
  raw: unknown,
): { value: string | number | null } | { error: string } {
  if (raw === null) return { value: null }; // an explicit, deliberate clear

  if (f.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `${f.label} must be a number` };
    if (f.min != null && n < f.min) return { error: `${f.label} must be at least ${f.min}` };
    if (f.max != null && n > f.max) return { error: `${f.label} must be at most ${f.max}` };
    return { value: n };
  }

  if (f.kind === "date") {
    if (typeof raw !== "string" || !isValidBirthDate(raw))
      return { error: `${f.label} must be a real date, and not in the future` };
    return { value: raw };
  }

  if (typeof raw !== "string") return { error: `${f.label} must be text` };
  if (f.options && !f.options.includes(raw))
    return { error: `${f.label} must be one of: ${f.options.join(", ")}` };
  if (f.maxLength && raw.length > f.maxLength)
    return { error: `${f.label} must be ${f.maxLength} characters or fewer` };
  return { value: raw };
}

/**
 * Turn a request body into a patch, or refuse it.
 *
 * Three states per field, and an invalid value is none of them: absent
 * leaves the stored value alone, an explicit null clears it, a valid value
 * sets it. A malformed value is a 400 that writes NOTHING — the old
 * behaviour mapped a bad birth date to null and stored it, which quietly
 * dropped that athlete off his age board with nothing to announce it.
 *
 * An emptied form field arrives as "" and means "clear this": it is
 * normalised to null before it reaches the data layer, so it never lands
 * on a date or number column as an empty string Postgres can't parse.
 */
export function parseProfilePatch(
  body: Record<string, unknown>,
  isCoach: boolean,
): Parsed {
  const allowed = new Set(editableKeys(isCoach));
  const patch: Record<string, string | number | null> = {};

  for (const [key, raw] of Object.entries(body)) {
    const f = PROFILE_FIELDS.find((x) => x.key === key);
    if (!f) continue; // not a profile field — password/archived/cnsThresholdPct handled elsewhere
    if (raw === undefined) continue;
    if (!allowed.has(key))
      return { ok: false, error: `You can't change ${f.label.toLowerCase()} — ask your coach` };

    // An emptied form field ("") is a clear, not a value.
    const value = raw === "" ? null : raw;

    if (value === null && NON_NULLABLE.has(key))
      return { ok: false, error: `${f.label} can't be blank` };

    const r = parseOne(f, value);
    if ("error" in r) return { ok: false, error: r.error };
    patch[key] = r.value;
  }

  return { ok: true, patch };
}
