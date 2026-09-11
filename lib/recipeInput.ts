import { MEAL_TIMES, RECIPE_KINDS, type MealTime, type RecipeKind } from "./types";

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
export const MAX_SERVINGS = 40;
export const MAX_CARBS_G = 600;
export const MAX_FAT_G = 300;
export const MAX_INGREDIENTS = 40;
export const MAX_STEPS = 20;

/** Every field a coach can set. */
export interface RecipeFields {
  title: string;
  kind: RecipeKind;
  blurb: string;
  meals: MealTime[];
  servings: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  ingredients: string[];
  steps: string[];
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
  for (const [key, max, label] of [
    ["servings", MAX_SERVINGS, "Servings"],
    ["proteinG", MAX_PROTEIN_G, "Protein"],
    ["carbsG", MAX_CARBS_G, "Carbs"],
    ["fatG", MAX_FAT_G, "Fat"],
  ] as const) {
    if (b[key] === undefined) continue;
    const n = whole(b[key], max, label);
    if (typeof n === "string") return { ok: false, error: n };
    out[key] = n ?? null;
  }

  for (const [key, max] of [
    ["ingredients", MAX_INGREDIENTS],
    ["steps", MAX_STEPS],
  ] as const) {
    if (b[key] === undefined) continue;
    if (!Array.isArray(b[key]))
      return { ok: false, error: `${key} must be a list` };
    const list = b[key] as unknown[];
    if (list.length > max)
      return {
        ok: false,
        error: `${list.length} ${key} is more than the ${max} we store`,
      };
    // Blank rows belong to the form, not the coach: dropped, never an error.
    out[key] = list
      .map((i) => (typeof i === "string" ? i.trim() : ""))
      .filter(Boolean);
  }

  if (b.meals !== undefined) {
    if (!Array.isArray(b.meals)) return { ok: false, error: "meals must be a list" };
    const bad = b.meals.find((m) => !MEAL_TIMES.includes(m as MealTime));
    if (bad !== undefined)
      return { ok: false, error: `'${String(bad)}' is not a meal time` };
    // Order and repeats belong to the form, not the record.
    out.meals = MEAL_TIMES.filter((m) => (b.meals as MealTime[]).includes(m));
  }

  if (b.blurb !== undefined)
    out.blurb = typeof b.blurb === "string" ? b.blurb.trim().slice(0, 300) : "";
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
      blurb: v.blurb ?? "",
      meals: v.meals ?? [],
      servings: v.servings ?? null,
      calories: v.calories ?? null,
      proteinG: v.proteinG ?? null,
      carbsG: v.carbsG ?? null,
      fatG: v.fatG ?? null,
      ingredients: v.ingredients ?? [],
      steps: v.steps ?? [],
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
