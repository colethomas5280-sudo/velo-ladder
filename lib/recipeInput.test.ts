import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CALORIES,
  MAX_INGREDIENTS,
  MAX_PROTEIN_G,
  parseNewRecipe,
  parseRecipePatch,
} from "@/lib/recipeInput";
import { ALL_SEED_RECIPES, SEED_RECIPES, missingSeedRecipes } from "@/lib/recipes";
import { COOKBOOK } from "@/lib/cookbook";

/* ------------------------------------------------------------------ *
 * Validating a recipe
 *
 * Deliberately looser than the lift validator. A lift's numbers are measured
 * against a standard; a recipe's are read by someone deciding what to make.
 * ------------------------------------------------------------------ */

test("a new recipe needs a name and nothing else", () => {
  const r = parseNewRecipe({ title: "  Gainer shake  " });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.value!.title, "Gainer shake", "trimmed");
  assert.equal(r.value!.kind, "smoothie");
  assert.equal(r.value!.calories, null, "unknown, not zero");
  assert.deepEqual(r.value!.ingredients, []);
});

test("a nameless recipe is refused", () => {
  for (const body of [{}, { title: "" }, { title: "   " }, { title: 7 }])
    assert.equal(parseNewRecipe(body).ok, false, JSON.stringify(body));
});

test("calories and protein are whole numbers inside a sane range", () => {
  for (const c of [0, -1, 1.5, MAX_CALORIES + 1, "lots"])
    assert.equal(parseNewRecipe({ title: "x", calories: c }).ok, false, String(c));
  assert.equal(parseNewRecipe({ title: "x", calories: MAX_CALORIES }).ok, true);
  assert.equal(parseNewRecipe({ title: "x", proteinG: MAX_PROTEIN_G + 1 }).ok, false);
});

/* "Nobody worked it out" and "zero calories" are different facts, and an
 * athlete sorting by calories needs them apart. */
test("calories left blank are null, never zero", () => {
  for (const c of [undefined, null, ""]) {
    const r = parseNewRecipe({ title: "x", calories: c });
    assert.equal(r.ok, true, String(c));
    assert.equal(r.value!.calories, null);
  }
});

test("an unknown kind is refused by name", () => {
  const r = parseNewRecipe({ title: "x", kind: "dessert" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /dessert/);
});

test("blank ingredient rows are the form's, so they are dropped not refused", () => {
  const r = parseNewRecipe({
    title: "x",
    ingredients: ["2 cups whole milk", "", "  ", "1 cup oats"],
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value!.ingredients, ["2 cups whole milk", "1 cup oats"]);
});

test("more ingredients than we store is refused rather than truncated", () => {
  const many = Array.from({ length: MAX_INGREDIENTS + 1 }, (_, i) => `item ${i}`);
  assert.equal(parseNewRecipe({ title: "x", ingredients: many }).ok, false);
  assert.equal(parseNewRecipe({ title: "x", ingredients: many.slice(1) }).ok, true);
  assert.equal(parseNewRecipe({ title: "x", ingredients: "milk" }).ok, false);
});

/* ---------------- editing ---------------- */

/*
 * The reason create and patch are separate functions rather than one with a
 * flag. A patch that filled in defaults would wipe a recipe's ingredients
 * when a coach fixed a typo in its title.
 */
test("an edit touches only what it names", () => {
  const r = parseRecipePatch({ title: "Renamed" });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(Object.keys(r.value!), ["title"]);
  assert.equal("ingredients" in r.value!, false, "absent means leave it alone");
  assert.equal("calories" in r.value!, false);
});

/* Absent and null are both absences, and only one of them means "clear it". */
test("clearing a field is possible, and different from not mentioning it", () => {
  assert.equal(parseRecipePatch({ calories: null }).value!.calories, null);
  assert.equal("calories" in parseRecipePatch({ title: "x" }).value!, false);
});

test("an edit can still be refused for a bad value", () => {
  assert.equal(parseRecipePatch({ calories: 99999 }).ok, false);
  assert.equal(parseRecipePatch({ title: "" }).ok, false);
  assert.equal(parseRecipePatch({ kind: "pudding" }).ok, false);
});

test("an empty edit is allowed and changes nothing", () => {
  const r = parseRecipePatch({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {});
});

test("a body that isn't an object is refused by either path", () => {
  for (const body of [null, "hello", 7]) {
    assert.equal(parseNewRecipe(body).ok, false);
    assert.equal(parseRecipePatch(body).ok, false);
  }
});

/* ---------------- the seeded six ---------------- */

test("every seeded recipe would pass the validator it bypasses", () => {
  for (const r of ALL_SEED_RECIPES) {
    const parsed = parseNewRecipe({ ...r });
    assert.equal(parsed.ok, true, `${r.title}: ${parsed.error}`);
  }
});

/*
 * Two prefixes on purpose: `seed-` are the shakes Cole typed into a message,
 * `cook-` are extracted from his PDF. The provenance differs and so does what
 * a correction means, so the id says which is which.
 */
test("seed ids are stable and readable, because the conflict clause needs them", () => {
  const ids = ALL_SEED_RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "a duplicate id silently drops a recipe");
  for (const id of ids) assert.match(id, /^(seed|cook)-[a-z0-9-]+$/, id);
  assert.ok(ids.some((i) => i.startsWith("seed-")) && ids.some((i) => i.startsWith("cook-")));
});

/* Cole's own rule, and these are the copy an athlete reads. */
test("no seeded recipe is written in em dashes", () => {
  for (const r of ALL_SEED_RECIPES)
    for (const text of [r.title, r.blurb, ...r.ingredients, ...r.steps, r.notes])
      assert.equal(text.includes("—"), false, `${r.title}: ${text}`);
});

test("a missing seed recipe is named", () => {
  const short = ALL_SEED_RECIPES.map((r) => r.id).filter((id) => id !== "seed-choc-pb");
  assert.deepEqual(missingSeedRecipes(short), ["seed-choc-pb"]);
  assert.deepEqual(missingSeedRecipes(ALL_SEED_RECIPES.map((r) => r.id)), []);
});

/* ---------------- the extracted cookbook ---------------- */

/*
 * 45 recipes lifted out of a PDF, so the tests here are about extraction
 * damage rather than about validation: a recipe with no steps, or a title
 * that is really the tail of an ingredient list, is the failure mode.
 */
test("every cookbook recipe has a title, steps and ingredients", () => {
  for (const r of COOKBOOK) {
    assert.ok(r.title.length > 4 && r.title.split(" ").length <= 9, r.title);
    assert.ok(r.ingredients.length >= 4, `${r.title}: ${r.ingredients.length} ingredients`);
    assert.ok(r.steps.length >= 2, `${r.title}: ${r.steps.length} steps`);
  }
});

test("no title is a fragment of the ingredient list above it", () => {
  for (const r of COOKBOOK) {
    assert.equal(/\d/.test(r.title), false, `${r.title} carries a quantity`);
    assert.equal(/:/.test(r.title), false, `${r.title} carries a heading colon`);
    assert.match(r.title, /^[A-Z]/, r.title);
  }
});

/* The numbers all survived the PDF. If one did not, it would read as zero. */
test("every cookbook recipe carries its full macros and a serving count", () => {
  for (const r of COOKBOOK) {
    for (const [k, v] of Object.entries({
      calories: r.calories, protein: r.proteinG, carbs: r.carbsG,
      fat: r.fatG, servings: r.servings,
    }))
      assert.ok(v != null && v > 0, `${r.title}: ${k} is ${v}`);
    assert.ok(r.calories! >= 300 && r.calories! <= 1200, `${r.title}: ${r.calories} cal`);
  }
});

/* Macros should roughly reconstruct the stated calories. A recipe where they
 * do not is one where a digit was misread. */
test("the macros add up to something near the stated calories", () => {
  for (const r of COOKBOOK) {
    const fromMacros = r.proteinG! * 4 + r.carbsG! * 4 + r.fatG! * 9;
    const drift = Math.abs(fromMacros - r.calories!) / r.calories!;
    assert.ok(drift < 0.25, `${r.title}: ${r.calories} stated vs ${fromMacros} from macros`);
  }
});

/*
 * What the PDF lost is MARKED, never guessed. An invented quarter-teaspoon is
 * indistinguishable from a real one once it is in the database.
 */
/*
 * Cole asked for the "(amount unclear in the source)" notes to go, and most
 * of them stopped being needed rather than being hidden: a broken conversion
 * beside a gram weight is redundant, and one beside an ounce measure means
 * the ounces were the answer all along.
 */
test("no ingredient carries an annotation", () => {
  for (const r of COOKBOOK)
    for (const i of r.ingredients)
      assert.equal(i.includes("unclear"), false, `${r.title}: ${i}`);
});

/*
 * What is left reads as a bare unit — "tsp cayenne" — which is visibly
 * incomplete rather than plausibly wrong. The bound is the point: if a change
 * to the extractor starts dropping amounts wholesale, this is what says so.
 */
test("only a handful of ingredients are left without an amount", () => {
  const bare = COOKBOOK.flatMap((r) => r.ingredients).filter(
    (i) => /^(tsp|Tbsp|cups?)\s/.test(i) || /(?<!\d)\b1 (cups|Tbsps|tsps)\b/.test(i),
  );
  assert.ok(bare.length < 30, `${bare.length} ingredients have no amount`);
  assert.equal(new Set(bare).size <= 12, true, `${new Set(bare).size} distinct`);
});

/*
 * The rule that must not over-reach. "2 cups (8oz)" is a perfectly good
 * measure and an earlier pass of mine rewrote it to "8oz", throwing away the
 * cup measure a cook would actually use.
 */
test("a good measure is never rewritten into its conversion", () => {
  const all = COOKBOOK.flatMap((r) => r.ingredients);
  assert.ok(
    all.some((i) => /^\d+ cups? \(\d+\s?oz\)/.test(i)),
    "every count-plus-conversion was flattened",
  );
});

test("the cookbook is meals, and the shakes are still smoothies", () => {
  for (const r of COOKBOOK) assert.equal(r.kind, "meal", r.title);
  assert.equal(SEED_RECIPES.every((r) => r.kind === "smoothie"), true);
});

test("no recipe is in the seed twice", () => {
  const titles = ALL_SEED_RECIPES.map((r) => r.title);
  assert.equal(new Set(titles).size, titles.length, "the PDF had one duplicate page");
});

/* ---------------- meal times ---------------- */

test("a meal time has to be one we know", () => {
  assert.equal(parseNewRecipe({ title: "x", meals: ["brunch"] }).ok, false);
  assert.match(parseNewRecipe({ title: "x", meals: ["brunch"] }).error!, /brunch/);
  assert.equal(parseNewRecipe({ title: "x", meals: "lunch" }).ok, false, "a list, not a word");
  assert.equal(parseNewRecipe({ title: "x", meals: ["lunch", "dinner"] }).ok, true);
});

/* Order and repeats belong to the form, not the record: a recipe ticked
 * dinner-then-lunch is the same recipe as one ticked lunch-then-dinner. */
test("meals come back in a settled order, without repeats", () => {
  const r = parseNewRecipe({ title: "x", meals: ["dinner", "lunch", "dinner"] });
  assert.deepEqual(r.value!.meals, ["lunch", "dinner"]);
});

test("no meals at all is allowed, and means unsorted", () => {
  assert.deepEqual(parseNewRecipe({ title: "x" }).value!.meals, []);
  assert.deepEqual(parseNewRecipe({ title: "x", meals: [] }).value!.meals, []);
});

/*
 * The PDF's own two headings decide this: 43 mains under "Lunch Dinner Meals"
 * and two under "Breakfast". Nothing here was assigned by taste.
 */
test("every seeded recipe is sorted into at least one meal", () => {
  for (const r of ALL_SEED_RECIPES)
    assert.ok(r.meals.length > 0, `${r.title} belongs to no meal`);
});

test("the shakes are breakfast or lunch, and the cookbook mains are not breakfast", () => {
  for (const r of SEED_RECIPES)
    assert.deepEqual(r.meals, ["breakfast", "lunch"], r.title);
  const mains = COOKBOOK.filter((r) => !r.title.toLowerCase().includes("breakfast"));
  for (const r of mains)
    assert.deepEqual(r.meals, ["lunch", "dinner"], r.title);
});

/*
 * Amounts Cole supplied for quantities the PDF lost. Asserted here because
 * the extractor keys them on the text that survived, so an entry silently
 * stops applying the moment the extraction changes — a correction that
 * matches nothing is worse than no correction, because it looks done.
 */
test("the amounts Cole gave are in the recipes", () => {
  /*
   * Exact strings, not a substring search. Looking for "garlic powder"
   * matched "Salt, garlic powder, and pepper, to taste" first and reported a
   * failure that was entirely the test's own.
   */
  const has = (title: string, exact: string) => {
    const r = COOKBOOK.find((x) => x.title.includes(title));
    assert.ok(r, `no recipe titled like ${title}`);
    assert.ok(r!.ingredients.includes(exact), `${r!.title} is missing "${exact}"`);
  };
  has("Breakfast Hash", "1/2 tsp crushed red pepper flakes");
  has("Bolognese", "1/4 tsp nutmeg");
  has("Jalapeño Popper", "3/4 tsp onion powder");
  has("Jalapeño Popper", "3/4 tsp garlic powder");
});

test("every rice bowl got the same broth measure", () => {
  const broths = COOKBOOK.flatMap((r) => r.ingredients).filter((i) =>
    i.includes("chicken bone broth"),
  );
  assert.ok(broths.length >= 8, `${broths.length} broth lines`);
  for (const b of broths)
    assert.equal(/(?<!\d)\b1 cups\b/.test(b), false, `${b} still lost its fraction`);
});
