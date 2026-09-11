"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { MealTime, Recipe, RecipeKind } from "@/lib/types";
import { MEAL_TIMES, RECIPE_KINDS } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import useSWR from "swr";
import RecipeEditor from "./RecipeEditor";
import { BODY_KEY, readBody, writeBody } from "./bodyStore";
import {
  CALORIES_PER_LB,
  PROTEIN_G_PER_LB,
  fmtShare,
  intakeFor,
  shareOfDay,
  type DailyIntake,
} from "@/lib/nutrition";
import { readLocal, subscribeLocal } from "@/lib/localStore";

/* ------------------------------------------------------------------ *
 * Eating to gain
 *
 * Cole: "the vast majority of my athletes are underweight and need as much
 * access to recipes to help gain weight."
 *
 * So the page is built around the number, not the cooking. An athlete arrives
 * from the standards page knowing he is fourteen pounds light, and the
 * question he has is "what gets me there" — which makes calories the thing to
 * sort and filter by, and the reason these are not just resource entries.
 * ------------------------------------------------------------------ */

type Me = { role: "coach" | "athlete" | "none" };

/** The rungs an athlete actually asks in. */
const FLOORS = [0, 600, 800, 1000] as const;

const KIND_LABEL: Record<RecipeKind, string> = {
  smoothie: "Smoothie",
  meal: "Meal",
  snack: "Snack",
};

const MEAL_LABEL: Record<MealTime, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export default function Nutrition() {
  const { data: me } = useSWR<Me>("/api/me", fetcher);
  const { data, mutate, isLoading } = useSWR<Recipe[]>("/api/recipes", fetcher);
  const isCoach = me?.role === "coach";
  const rows = useMemo(() => data ?? [], [data]);

  /*
   * The weight the standards calculator already asked for. Reading it here
   * rather than asking again is the difference between two pages and one
   * flow: an athlete arrives from "14 lb from target" and the answer is
   * already in his own terms.
   */
  const saved = useSyncExternalStore(
    subscribeLocal,
    () => readLocal(BODY_KEY) ?? "",
    () => "",
  );
  const weightLb = useMemo(() => Number(saved ? readBody().lb : "") || 0, [saved]);
  const intake = useMemo(() => intakeFor(weightLb), [weightLb]);

  const [floor, setFloor] = useState<number>(0);
  const [kind, setKind] = useState<RecipeKind | "all">("all");
  const [meal, setMeal] = useState<MealTime | "all">("all");
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  /* Nothing sorted means the meal filter can only ever find nothing. */
  const sorted = rows.some((r) => r.meals.length > 0);

  const shown = rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      /*
       * A recipe sits in every meal it fits, so this is membership rather than
       * equality. One that has not been sorted yet stays out of a meal filter
       * for the same reason an uncounted recipe stays out of a calorie one:
       * it is not an answer to the question that was asked.
       */
      (meal === "all" || r.meals.includes(meal)) &&
      /*
       * A recipe with no calories on it is shown at every floor except when
       * one is asked for. Filtering to "1000+" and being handed something
       * nobody has counted would be the page answering a different question.
       */
      (floor === 0 || (r.calories != null && r.calories >= floor)),
  );

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function remove(r: Recipe) {
    if (!confirm(`Remove "${r.title}" from the recipes?`)) return;
    try {
      await api(`/api/recipes/${r.id}`, "DELETE");
      await mutate();
      show("Removed");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Couldn't remove that");
    }
  }

  return (
    <div className="sr-page">
      <div className="tests-head">
        <Link href="/resources" className="back-link">
          ← Resources
        </Link>
        <div className="eyebrow">Reference</div>
        <h2>Eating to gain</h2>
        <p className="sr-lede">
          Most of the work of putting weight on happens in the kitchen, not the
          weight room. These are built to be easy to get down when you are not
          hungry, which is the actual problem most of the time.
        </p>
      </div>

      <section className="card pad">
        <div className="eyebrow">What a day looks like</div>
        {intake ? (
          <DailyTarget intake={intake} onClear={() => writeBody({ lb: "" })} />
        ) : (
          <div className="nu-ask">
            <label className="field">
              <span>Your bodyweight</span>
              <span className="ss-height">
                <input
                  className="tin"
                  inputMode="numeric"
                  aria-label="Your bodyweight in pounds"
                  placeholder="180"
                  onChange={(e) =>
                    writeBody({ lb: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })
                  }
                />
                <em>lb</em>
              </span>
            </label>
            <p className="cz-note">
              Put it in and every recipe below says what it is worth against
              your day. Nothing is saved anywhere but this browser.
            </p>
          </div>
        )}
      </section>

      <section className="card pad">
        <div className="nu-filters">
          <div className="chips" role="group" aria-label="Minimum calories">
            {FLOORS.map((f) => (
              <button
                key={f}
                className="chip"
                aria-pressed={f === floor}
                onClick={() => setFloor(f)}
              >
                {f === 0 ? "Any size" : `${f}+ kcal`}
              </button>
            ))}
          </div>
          {/*
            * Only when something is actually sorted. Cole hit exactly this:
            * a deployment without the meals column left every recipe
            * unsorted, and three buttons sat there returning nothing with no
            * way to tell a filter that found nothing from one that is broken.
            */}
          {sorted && (
          <div className="chips" role="group" aria-label="Meal">
            <button
              className="chip"
              aria-pressed={meal === "all"}
              onClick={() => setMeal("all")}
            >
              Any meal
            </button>
            {MEAL_TIMES.map((m) => (
              <button
                key={m}
                className="chip"
                aria-pressed={m === meal}
                onClick={() => setMeal(m)}
              >
                {MEAL_LABEL[m]}
              </button>
            ))}
          </div>
          )}
          <div className="chips" role="group" aria-label="Kind of recipe">
            <button
              className="chip"
              aria-pressed={kind === "all"}
              onClick={() => setKind("all")}
            >
              All
            </button>
            {RECIPE_KINDS.map((k) => (
              <button
                key={k}
                className="chip"
                aria-pressed={k === kind}
                onClick={() => setKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {isCoach && (
            <button className="btn primary" onClick={() => setEditing("new")}>
              + Add recipe
            </button>
          )}
        </div>

        {isLoading && <p className="widget-empty">Loading…</p>}

        {!isLoading && rows.length === 0 && (
          <p className="widget-empty">
            {isCoach
              ? "Nothing here yet. Add the smoothies you already give athletes and they can stop asking you for them one at a time."
              : "Your coach hasn't put any recipes up yet."}
          </p>
        )}

        {!isLoading && rows.length > 0 && shown.length === 0 && (
          <p className="widget-empty">
            Nothing that big yet. Try a smaller size.
          </p>
        )}

        <ul className="nu-list">
          {shown.map((r) => (
            <li key={r.id} className={open.has(r.id) ? "nu open" : "nu"}>
              <button className="nu-head" onClick={() => toggle(r.id)}>
                <span className="nu-cal">
                  {r.calories != null ? r.calories : "?"}
                  <em>kcal</em>
                </span>
                <span className="nu-title">
                  {r.title}
                  <span className="nu-meta">
                    {r.meals.length ? r.meals.map((m) => MEAL_LABEL[m]).join(" / ") : KIND_LABEL[r.kind]}
                    {r.servings != null && r.servings > 1 && ` · makes ${r.servings}`}
                    {r.proteinG != null && ` · ${r.proteinG}g protein`}
                    {r.carbsG != null && ` · ${r.carbsG}g carbs`}
                    {r.fatG != null && ` · ${r.fatG}g fat`}
                  </span>
                  {/*
                    * The blurb is the reason to pick one over another, so it
                    * sits on the row. Making an athlete open five to find the
                    * light one after training is the page wasting his time.
                    */}
                  {r.blurb && <span className="nu-blurb">{r.blurb}</span>}
                  {/*
                    * "1,070 calories" means little on its own. "About a third
                    * of your day" is the sentence that gets it drunk.
                    */}
                  {intake && r.calories != null && (
                    <span className="nu-share">
                      {fmtShare(shareOfDay(r.calories, intake))}
                    </span>
                  )}
                </span>
                <span className="nu-toggle" aria-hidden="true">{open.has(r.id) ? "−" : "+"}</span>
              </button>

              {open.has(r.id) && (
                <div className="nu-body">
                  {r.ingredients.length > 0 && (
                    <ul className="nu-ing">
                      {r.ingredients.map((ing, i) => (
                        <li key={i}>{ing}</li>
                      ))}
                    </ul>
                  )}
                  {r.steps.length > 0 && (
                    <ol className="nu-steps">
                      {r.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  )}
                  {r.notes && <p className="cz-note">{r.notes}</p>}
                  {isCoach && (
                    <div className="rec-actions">
                      <button className="btn sm ghost" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button className="btn sm danger" onClick={() => remove(r)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <RecipeEditor
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            await mutate();
            setEditing(null);
            show(msg);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * The day an athlete is aiming at, in Cole's numbers: 20 calories a pound and
 * a gram of protein a pound.
 *
 * Both rules are shown, not just their answers. An athlete who knows the rule
 * can work out his own target when he has gained ten pounds, which is the
 * whole point of it being a rule rather than a figure someone handed him.
 */
function DailyTarget({
  intake,
  onClear,
}: {
  intake: DailyIntake;
  onClear: () => void;
}) {
  return (
    <div className="nu-target">
      <div className="nu-figure">
        <span className="n">{intake.calories.toLocaleString("en-US")}</span>
        <span className="l">kcal a day</span>
      </div>
      <div className="nu-figure">
        <span className="n">{intake.proteinG}</span>
        <span className="l">g protein</span>
      </div>
      <div className="nu-target-why">
        <span className="cz-note">
          At {intake.weightLb} lb: {CALORIES_PER_LB} calories a pound, and{" "}
          {PROTEIN_G_PER_LB}g of protein a pound. The protein number is just
          your bodyweight, which is the easy part to remember.
        </span>
        <button className="btn sm ghost" onClick={onClear}>
          Not my weight
        </button>
      </div>
    </div>
  );
}
