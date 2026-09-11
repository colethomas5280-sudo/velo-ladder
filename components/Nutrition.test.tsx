import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Recipe } from "@/lib/types";
import { withSwr } from "./testSwr";
import Nutrition from "./Nutrition";

/* ------------------------------------------------------------------ *
 * Eating to gain
 *
 * Built around the calorie count because that is the question an athlete
 * arrives with: he has just been told he is fourteen pounds light and wants
 * to know what gets him there.
 * ------------------------------------------------------------------ */

let n = 0;
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: `r${n++}`,
  title: "Gainer shake",
  kind: "smoothie",
  calories: 1100,
  proteinG: 55,
  ingredients: ["2 cups whole milk", "1 cup oats"],
  carbsG: null,
  fatG: null,
  blurb: "",
  servings: 1,
  meals: ["breakfast", "lunch"],
  steps: ["Blend the liquids first."],
  notes: "",
  position: 0,
  archived: false,
  ...over,
});

const page = (rows: Recipe[], role: "coach" | "athlete" = "athlete") =>
  render(
    withSwr({ "/api/me": { role }, "/api/recipes": rows }, <Nutrition />),
  );

beforeEach(cleanup);

test("the calorie count leads each row", () => {
  page([recipe({ title: "Peanut butter bomb", calories: 1250 })]);
  const head = document.querySelector(".nu-cal")!.textContent!;
  assert.match(head, /1250/);
  assert.match(head, /kcal/i);
});

test("a row summarises without being opened", () => {
  page([recipe()]);
  const meta = document.querySelector(".nu-meta")!.textContent!;
  // The meal times lead, since that is what an athlete is choosing between.
  assert.match(meta, /Breakfast \/ Lunch/);
  assert.match(meta, /55g protein/);
  assert.equal(document.querySelector(".nu-ing"), null, "closed until asked");
});

test("a batch says how many it makes; a single serving does not", () => {
  page([recipe({ servings: 10, title: "Batch" }), recipe({ servings: 1, title: "One" })]);
  const rows = [...document.querySelectorAll(".nu-meta")].map((n) => n.textContent!);
  assert.ok(rows.some((r) => /makes 10/.test(r)));
  assert.equal(rows.some((r) => /makes 1\b/.test(r)), false, "'makes 1' is noise");
});

test("opening one shows the ingredients and the method", () => {
  page([recipe()]);
  fireEvent.click(document.querySelector(".nu-head")!);
  assert.ok(screen.getByText("2 cups whole milk"));
  assert.ok(screen.getByText(/blend the liquids first/i));
});

/*
 * The filter is the point of the page: "what gets me 1000 calories". The
 * middle case is the one that matters — "1000+" has to include 1000, or the
 * label is lying about what it filters.
 */
test("filtering by size keeps only what clears it, boundary included", () => {
  page([
    recipe({ title: "Big", calories: 1200 }),
    recipe({ title: "Exactly", calories: 1000 }),
    recipe({ title: "Just under", calories: 999 }),
    recipe({ title: "Small", calories: 450 }),
  ]);
  fireEvent.click(screen.getByText("1000+ kcal"));
  assert.ok(screen.getByText("Big"));
  assert.ok(screen.getByText("Exactly"), "1000+ means 1000 or more");
  assert.equal(screen.queryByText("Just under"), null);
  assert.equal(screen.queryByText("Small"), null);
});

/*
 * A recipe nobody has counted is not a 1000 calorie recipe. Showing it under
 * that filter would answer a different question from the one asked.
 */
test("an uncounted recipe is not offered as an answer to a calorie question", () => {
  page([recipe({ title: "Uncounted", calories: null })]);
  assert.ok(screen.getByText("Uncounted"), "visible at any size");
  fireEvent.click(screen.getByText("1000+ kcal"));
  assert.equal(screen.queryByText("Uncounted"), null);
});

test("filtering by kind works alongside size", () => {
  page([
    recipe({ title: "Shake", kind: "smoothie", calories: 1100 }),
    recipe({ title: "Plate", kind: "meal", calories: 1100 }),
  ]);
  fireEvent.click(screen.getByText("Meal"));
  assert.ok(screen.getByText("Plate"));
  assert.equal(screen.queryByText("Shake"), null);
});

test("a filter that matches nothing says so rather than showing a blank", () => {
  page([recipe({ calories: 400 })]);
  fireEvent.click(screen.getByText("1000+ kcal"));
  assert.ok(screen.getByText(/nothing that big yet/i));
});

/* ---------------- who can write ---------------- */

test("an athlete is offered no way to change a recipe", () => {
  page([recipe()]);
  fireEvent.click(document.querySelector(".nu-head")!);
  assert.equal(screen.queryByText(/\+ Add recipe/i), null);
  assert.equal(screen.queryByText(/^Edit$/), null);
  assert.equal(screen.queryByText(/^Remove$/), null);
});

test("a coach can add and edit", () => {
  page([recipe()], "coach");
  assert.ok(screen.getByText(/\+ Add recipe/i));
  fireEvent.click(document.querySelector(".nu-head")!);
  assert.ok(screen.getByText(/^Edit$/));
});

test("an empty library tells each role something different", () => {
  page([], "coach");
  assert.ok(screen.getByText(/add the smoothies you already give athletes/i));
  cleanup();
  page([], "athlete");
  assert.ok(screen.getByText(/hasn't put any recipes up yet/i));
});


/* ---------------- meal times ---------------- */

/*
 * A recipe belongs to every meal it fits, so filtering is membership rather
 * than equality. Cole's cookbook groups its mains as "Lunch Dinner Meals"
 * because a slow cooker chili is both.
 */
test("filtering by meal keeps everything that fits it", () => {
  page([
    recipe({ title: "Shake", meals: ["breakfast", "lunch"] }),
    recipe({ title: "Chili", meals: ["lunch", "dinner"] }),
    recipe({ title: "Casserole", meals: ["breakfast"] }),
  ]);
  fireEvent.click(screen.getByText("Lunch"));
  assert.ok(screen.getByText("Shake"));
  assert.ok(screen.getByText("Chili"));
  assert.equal(screen.queryByText("Casserole"), null);
});

test("dinner is narrower than lunch, because the shakes are not dinner", () => {
  page([
    recipe({ title: "Shake", meals: ["breakfast", "lunch"] }),
    recipe({ title: "Chili", meals: ["lunch", "dinner"] }),
  ]);
  fireEvent.click(screen.getByText("Dinner"));
  assert.ok(screen.getByText("Chili"));
  assert.equal(screen.queryByText("Shake"), null);
});

test("an unsorted recipe is not an answer to a meal question", () => {
  page([recipe({ title: "Unsorted", meals: [] })]);
  assert.ok(screen.getByText("Unsorted"), "visible under any meal");
  fireEvent.click(screen.getByText("Breakfast"));
  assert.equal(screen.queryByText("Unsorted"), null);
});

test("meal and calorie filters narrow together", () => {
  page([
    recipe({ title: "Big breakfast", meals: ["breakfast"], calories: 1100 }),
    recipe({ title: "Small breakfast", meals: ["breakfast"], calories: 400 }),
  ]);
  fireEvent.click(screen.getByText("Breakfast"));
  fireEvent.click(screen.getByText("1000+ kcal"));
  assert.ok(screen.getByText("Big breakfast"));
  assert.equal(screen.queryByText("Small breakfast"), null);
});
