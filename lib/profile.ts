import { LEVELS, ageOn } from "./leaderboard";

/* ------------------------------------------------------------------ *
 * The athlete profile, as data.
 *
 * One array drives the form, the API's write-allowlist and validation,
 * the role filter, and the roster's completeness count. They cannot
 * disagree about which fields exist or who may see them, because there
 * is only one list to disagree with.
 * ------------------------------------------------------------------ */

export type FieldKind = "text" | "number" | "date" | "select" | "textarea";

export interface ProfileField {
  key: string;
  label: string;
  kind: FieldKind;
  section: "identity" | "physical" | "school" | "contact" | "health";
  /** false = coach only, for reading as well as writing */
  athleteCanSee: boolean;
  athleteCanEdit: boolean;
  /** counts toward the roster's "N missing" marker */
  required?: boolean;
  /** counts only when the athlete is under 18 */
  requiredIfMinor?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  unit?: string;
  help?: string;
}

export const PROFILE_SECTIONS: { id: ProfileField["section"]; title: string }[] = [
  { id: "identity", title: "Who you are" },
  { id: "physical", title: "Physical" },
  { id: "school", title: "School" },
  { id: "contact", title: "Contact" },
  { id: "health", title: "Health" },
];

export const STATUSES = ["On-Site", "Remote"] as const;
export const BATS = ["R", "L", "S"] as const;

export const PROFILE_FIELDS: ProfileField[] = [
  // identity
  { key: "firstName", label: "First name", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 80 },
  { key: "lastName", label: "Last name", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 80 },
  { key: "birthDate", label: "Date of birth", kind: "date", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true },
  // His login. Editable by the coach only: a typo here locks him out.
  { key: "inviteEmail", label: "Login email", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, maxLength: 200 },
  // Stamps his records, so it is a program decision rather than a preference.
  { key: "level", label: "Level", kind: "select", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, required: true, options: LEVELS },
  { key: "status", label: "Training", kind: "select", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, options: STATUSES },

  // physical
  { key: "heightIn", label: "Height", kind: "number", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, required: true,
    min: 30, max: 90, unit: "in", help: "Inches — 6'0\" is 72" },
  { key: "weightLb", label: "Weight", kind: "number", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, required: true,
    min: 50, max: 500, unit: "lb" },
  { key: "hand", label: "Throws", kind: "select", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, options: ["R", "L"] },
  { key: "bats", label: "Bats", kind: "select", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, options: BATS },
  { key: "positions", label: "Positions", kind: "text", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 60 },

  // school
  { key: "school", label: "School", kind: "text", section: "school",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 120 },
  { key: "hsGradYear", label: "HS grad year", kind: "number", section: "school",
    athleteCanSee: true, athleteCanEdit: true, min: 1900, max: 2100 },
  { key: "collegeGradYear", label: "College grad year", kind: "number", section: "school",
    athleteCanSee: true, athleteCanEdit: true, min: 1900, max: 2100 },

  // contact
  { key: "phone", label: "Phone", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 40 },
  { key: "guardianName", label: "Parent / guardian", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, requiredIfMinor: true, maxLength: 120 },
  { key: "guardianPhone", label: "Parent / guardian phone", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, requiredIfMinor: true, maxLength: 40 },
  { key: "emergencyContact", label: "Emergency contact", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 200 },

  // health
  { key: "injuryNotes", label: "Injury history", kind: "textarea", section: "health",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 2000,
    help: "Anything that has kept you off the mound, and anything limiting you now" },
  // The coach's own notes. Never leaves the server for an athlete.
  { key: "coachNotes", label: "Coach notes", kind: "textarea", section: "health",
    athleteCanSee: false, athleteCanEdit: false, maxLength: 2000,
    help: "Only you can see this" },
];

/**
 * Split on the LAST space. "Mary Jo Smith" is far more likely to be
 * Mary Jo / Smith than Mary / Jo Smith; a compound surname like
 * "Juan de la Cruz" comes out wrong and gets fixed on the roster.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** The ONLY way `name` is ever built. */
export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

/**
 * Drop fields this viewer may not see. Deletes the key rather than
 * blanking it — a null `coachNotes` in a payload still tells an athlete
 * the field exists.
 */
export function visibleProfile<T extends Record<string, unknown>>(
  athlete: T,
  isCoach: boolean,
): Partial<T> {
  if (isCoach) return { ...athlete };
  const hidden = new Set(
    PROFILE_FIELDS.filter((f) => !f.athleteCanSee).map((f) => f.key),
  );
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(athlete))
    if (!hidden.has(k)) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Keys this role may write. The API's allowlist, not a UI hint. */
export function editableKeys(isCoach: boolean): string[] {
  return PROFILE_FIELDS.filter((f) => isCoach || f.athleteCanEdit).map((f) => f.key);
}

const isBlank = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "");

/**
 * Which required fields are still blank. Only the ones a coach actually
 * chases count — marking every row for a missing "positions" would be
 * the same as marking none of them.
 */
export function missingProfileFields(a: {
  [k: string]: unknown;
  birthDate?: string | null;
}): string[] {
  const birthDate = a.birthDate as string | null | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const age = birthDate ? ageOn(birthDate, today) : null;
  const isMinor = age != null && age >= 0 && age < 18;
  return PROFILE_FIELDS.filter(
    (f) => (f.required || (f.requiredIfMinor && isMinor)) && isBlank(a[f.key]),
  ).map((f) => f.key);
}
