import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CALORIES,
  MAX_INGREDIENTS,
  MAX_PROTEIN_G,
  parseNewRecipe,
  parseRecipePatch,
} from "@/lib/recipeInput";

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
