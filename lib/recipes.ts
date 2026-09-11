import type { Recipe } from "./types";
import { COOKBOOK } from "./cookbook";

/* ------------------------------------------------------------------ *
 * The recipes a fresh database starts with
 *
 * Cole's six, as he wrote them. Seeded rather than typed into the form for
 * the same reason the lift menu is: a recipe is roughly a dozen fields and
 * ten ingredients, and asking him to retype all six into a browser when the
 * text already exists is work the machine should do.
 *
 * Every insert is ON CONFLICT (id) DO NOTHING, so once a recipe is on his
 * database it is HIS. Editing one here changes nothing for him, and removing
 * one does not un-remove his copy. Same contract as the lift menu, and the
 * same reason: a deploy must never overwrite what a coach has changed.
 *
 * Ids are stable and readable rather than random, because that is the only
 * thing making the conflict clause work across deploys.
 * ------------------------------------------------------------------ */

export type SeedRecipe = Omit<Recipe, "position" | "archived">;

/** Cole's six shakes, typed in from the message he sent. */

export const SEED_RECIPES: SeedRecipe[] = [
  {
    id: "seed-choc-mousse",
    title: "Chocolate Mousse Bulking Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    blurb: "Thick and mousse-like. Eat it with a spoon, or thin it out to drink.",
    calories: 1070,
    proteinG: 73,
    carbsG: null,
    fatG: null,
    ingredients: [
      "80 g rolled oats",
      "300 g Fairlife chocolate milk",
      "2 scoops chocolate protein powder",
      "32 g almond butter",
      "50 g pitted dates, chopped",
      "1 handful of ice",
      "2 tbsp water, to thin (optional)",
    ],
    steps: [
      "Add the oats, chocolate milk, protein powder, almond butter and dates to a blender.",
      "Blend about 1 minute, until it is thick like a chocolate mousse.",
      "To drink it rather than spoon it, add the ice and the water.",
      "Blend about 1 minute more, until smooth.",
    ],
    notes: "",
  },
  {
    id: "seed-rice-krispie",
    title: "Rice Krispie Treat Bulking Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    blurb: "Tastes like a Rice Krispie treat in shake form.",
    calories: 1068,
    proteinG: 77,
    carbsG: null,
    fatG: null,
    ingredients: [
      "80 g rolled oats",
      "300 g fat-free Fairlife milk",
      "2 scoops vanilla protein powder",
      "32 g peanut butter",
      "150 g banana",
      "20 g honey",
      "15 g Rice Krispies, for the top",
    ],
    steps: [
      "Add everything except the Rice Krispies to a blender.",
      "Blend about 1 minute, until smooth.",
      "Pour into a glass and scatter the Rice Krispies on top for the crunch.",
    ],
    notes: "",
  },
  {
    id: "seed-berry-fresh",
    title: "Berry Fresh Special Bulking Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    /* Cole wrote "the highest-protein of the three" when there were three of
     * them. There are six, and in a filtered list "the three" names nothing. */
    blurb: "The highest-protein of all of these.",
    calories: 1032,
    proteinG: 87,
    carbsG: null,
    fatG: null,
    ingredients: [
      "80 g rolled oats",
      "300 g fat-free Fairlife milk",
      "2 scoops strawberry protein powder",
      "150 g Greek yogurt",
      "32 g peanut butter",
      "150 g frozen mixed berries",
      "20 g honey",
    ],
    steps: [
      "Add everything to a blender.",
      "Blend about 1 minute, to a smoothie texture, and drink.",
    ],
    notes: "",
  },
  {
    id: "seed-choc-pb",
    title: "Chocolate Peanut Butter Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    blurb: "Tastes like a peanut butter cup milkshake.",
    calories: 1110,
    proteinG: 73,
    carbsG: 115,
    fatG: 40,
    ingredients: [
      "2 cups whole milk",
      "1.5 scoops chocolate protein powder",
      "1 large banana (frozen works well)",
      "1/2 cup oats",
      "3 tbsp natural peanut butter",
      "2 tbsp cocoa powder",
      "1 tbsp honey",
      "1/3 tsp vanilla extract",
      "1 handful of ice",
    ],
    steps: [
      "Add the milk, protein powder, banana and oats to the blender.",
      "Add the peanut butter, cocoa powder, honey and vanilla.",
      "Add the ice and blend until smooth.",
    ],
    notes: "",
  },
  {
    id: "seed-green-machine",
    title: "Green Machine Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    blurb: "The spinach disappears completely under the mango and banana.",
    calories: 1080,
    proteinG: 65,
    carbsG: 120,
    fatG: 35,
    ingredients: [
      "2 cups whole milk",
      "2 cups packed baby spinach",
      "1 scoop vanilla protein powder",
      "1/2 cup Greek yogurt",
      "1 large banana",
      "1 cup frozen mango",
      "1/2 cup oats",
      "1/4 avocado",
      "2 tbsp ground flaxseed",
      "1 tbsp honey",
    ],
    steps: [
      "Blend the milk and spinach on their own for about 20 seconds, until no green flecks are left.",
      "Add the protein powder, yogurt, banana, mango, oats, avocado, flaxseed and honey.",
      "Blend until smooth.",
    ],
    notes: "",
  },
  {
    id: "seed-tropical-gainer",
    title: "Tropical Gainer Shake",
    kind: "smoothie",
    servings: 1,
    meals: ["breakfast", "lunch"],
    blurb: "The lightest and lowest-fat of these. Good straight after training.",
    calories: 680,
    proteinG: 46,
    carbsG: 95,
    fatG: 15,
    ingredients: [
      "1.5 cups coconut milk (from a carton)",
      "1 scoop vanilla protein powder",
      "1/2 cup Greek yogurt",
      "1 cup frozen mango",
      "1 cup frozen pineapple",
      "1/2 cup oats",
      "2 tbsp unsweetened shredded coconut",
      "1 tbsp ground flaxseed",
      "1 handful of ice",
    ],
    steps: [
      "Add the coconut milk, protein powder and Greek yogurt to the blender.",
      "Add the mango, pineapple, oats, shredded coconut and flaxseed.",
      "Add the ice and blend until smooth.",
    ],
    notes: "",
  },
];

/**
 * Everything a fresh database starts with: the six shakes above, then the
 * slow cooker cookbook extracted from Cole's PDF.
 *
 * Shakes first, because that is the order they were written and position is
 * only a tiebreak — the library sorts on calories, so the 1,100 kcal shakes
 * lead the 600 kcal meals on their own merits.
 */
export const ALL_SEED_RECIPES: SeedRecipe[] = [...SEED_RECIPES, ...COOKBOOK];

/** Seeded ids absent from a live library: a recipe that failed to insert. */
export function missingSeedRecipes(present: readonly string[]): string[] {
  const have = new Set(present);
  return ALL_SEED_RECIPES.filter((r) => !have.has(r.id)).map((r) => r.id);
}
