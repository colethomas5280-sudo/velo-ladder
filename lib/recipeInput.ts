import { RECIPE_KINDS, type RecipeKind } from "./types";

/* ------------------------------------------------------------------ *
 * Validating a recipe before it is stored
 *
 * Looser than the lift validator on purpose. A lift's numbers are measured
 * against a standard, so a slipped keypad sets a PR nobody can beat; a
 * recipe's calories are read by a person deciding what to make. The job here
 * is to keep nonsense out of a sort, not to police a coach's typing.
 * ------------------------------------------------------------------ */

/** Enough headroom for a real gainer shake, low enough to catch a stray zero. */
export const MAX_CALORIES = 5000;
export const MAX_PROTEIN_G = 400;
export const MAX_INGREDIENTS = 40;

/** Every field a coach can set. */
export interface RecipeFields {
  title: string;
  kind: RecipeKind;
  calories: number | null;
  proteinG: number | null;
  ingredients: string[];
  method: string;
  notes: string;
}

/**
 * An edit touches only what it names.
 *
 * This distinction is the whole reason the two are separate functions rather
 * than one with a flag. A PATCH that filled in defaults for everything absent
 * would wipe a recipe's ingredients when a coach fixed a typo in its title,
 * and the shapes would not have told anyone: `calories: null` and "calories
 * not mentioned" are both absences, and only one of them means "clear it".
 */
export type RecipePatch = Partial<RecipeFields>;

export interface Parsed<T> {
  ok: boolean;
  error?: string;
  value?: T;
}

const blank = (v: unknown) => v === null || v === undefined || v === "";

function whole(v: unknown, max: number, what: string): number | null | string {
  if (blank(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > max)
    return `${what} must be a whole number from 1 to ${max}`;
  return n;
}

/** Reads whatever the body mentions. Nothing absent is invented. */
function read(b: Record<string, unknown>): Parsed<RecipePatch> {
  const out: RecipePatch = {};

  if (b.title !== undefined) {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return { ok: false, error: "Give it a name" };
    out.title = title;
  }

  if (b.kind !== undefined) {
    if (!RECIPE_KINDS.includes(b.kind as RecipeKind))
      return { ok: false, error: `'${String(b.kind)}' is not a kind of recipe` };
    out.kind = b.kind as RecipeKind;
  }

  if (b.calories !== undefined) {
    const n = whole(b.calories, MAX_CALORIES, "Calories");
    if (typeof n === "string") return { ok: false, error: n };
    out.calories = n;
  }
  if (b.proteinG !== undefined) {
    const n = whole(b.proteinG, MAX_PROTEIN_G, "Protein");
    if (typeof n === "string") return { ok: false, error: n };
    out.proteinG = n;
  }

  if (b.ingredients !== undefined) {
    if (!Array.isArray(b.ingredients))
      return { ok: false, error: "ingredients must be a list" };
    if (b.ingredients.length > MAX_INGREDIENTS)
      return {
        ok: false,
        error: `${b.ingredients.length} ingredients is more than the ${MAX_INGREDIENTS} we store`,
      };
    // Blank rows belong to the form, not the coach: dropped, never an error.
    out.ingredients = b.ingredients
      .map((i) => (typeof i === "string" ? i.trim() : ""))
      .filter(Boolean);
  }

  if (b.method !== undefined)
    out.method = typeof b.method === "string" ? b.method.slice(0, 4000) : "";
  if (b.notes !== undefined)
    out.notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : "";

  return { ok: true, value: out };
}

/** A new recipe. Needs a name; everything else takes a sensible default. */
export function parseNewRecipe(body: unknown): Parsed<RecipeFields> {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  const parsed = read(body as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const v = parsed.value!;
  if (!v.title) return { ok: false, error: "Give it a name" };

  return {
    ok: true,
    value: {
      title: v.title,
      kind: v.kind ?? "smoothie",
      calories: v.calories ?? null,
      proteinG: v.proteinG ?? null,
      ingredients: v.ingredients ?? [],
      method: v.method ?? "",
      notes: v.notes ?? "",
    },
  };
}

/** An edit. Absent means "leave it", which is not the same as "clear it". */
export function parseRecipePatch(body: unknown): Parsed<RecipePatch> {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Body must be an object" };
  return read(body as Record<string, unknown>);
}
