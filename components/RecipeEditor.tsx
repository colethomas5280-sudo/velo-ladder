"use client";

import { useEffect, useState } from "react";
import type { Recipe, RecipeKind } from "@/lib/types";
import { RECIPE_KINDS } from "@/lib/types";
import { MAX_INGREDIENTS, MAX_STEPS } from "@/lib/recipeInput";
import { api, ApiError } from "@/lib/fetcher";

/** Coach-only. Athletes read recipes; only Cole writes them. */

const digits = (s: string) => s.replace(/[^0-9]/g, "").slice(0, 5);

interface Draft {
  title: string;
  kind: RecipeKind;
  blurb: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  ingredients: string[];
  steps: string[];
  notes: string;
}

function draftFrom(r: Recipe | null): Draft {
  return {
    title: r?.title ?? "",
    kind: r?.kind ?? "smoothie",
    blurb: r?.blurb ?? "",
    calories: r?.calories != null ? String(r.calories) : "",
    proteinG: r?.proteinG != null ? String(r.proteinG) : "",
    carbsG: r?.carbsG != null ? String(r.carbsG) : "",
    fatG: r?.fatG != null ? String(r.fatG) : "",
    // One empty row to type into, so a new recipe is not a blank wall.
    ingredients: r?.ingredients.length ? [...r.ingredients] : [""],
    steps: r?.steps.length ? [...r.steps] : [""],
    notes: r?.notes ?? "",
  };
}

export default function RecipeEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: Recipe | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(existing));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    setBusy(true);
    setErr(null);
    const body = {
      title: d.title.trim(),
      kind: d.kind,
      blurb: d.blurb,
      calories: num(d.calories),
      proteinG: num(d.proteinG),
      carbsG: num(d.carbsG),
      fatG: num(d.fatG),
      ingredients: d.ingredients,
      steps: d.steps,
      notes: d.notes,
    };
    try {
      if (existing) await api(`/api/recipes/${existing.id}`, "PATCH", body);
      else await api("/api/recipes", "POST", body);
      onSaved(existing ? "Recipe updated" : "Recipe added");
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{existing ? "Edit recipe" : "New recipe"}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="lm">
          <label className="field">
            <span>Name</span>
            <input
              value={d.title}
              placeholder="Peanut butter gainer"
              onChange={(e) => setD((p) => ({ ...p, title: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>One-liner</span>
            <input
              value={d.blurb}
              placeholder="Tastes like a peanut butter cup milkshake."
              onChange={(e) => setD((p) => ({ ...p, blurb: e.target.value }))}
            />
          </label>

          <div className="nu-nums">
            <label className="field">
              <span>Kind</span>
              <select
                value={d.kind}
                onChange={(e) =>
                  setD((p) => ({ ...p, kind: e.target.value as RecipeKind }))
                }
              >
                {RECIPE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Calories</span>
              <input
                className="tin"
                inputMode="numeric"
                placeholder="1100"
                value={d.calories}
                onChange={(e) =>
                  setD((p) => ({ ...p, calories: digits(e.target.value) }))
                }
              />
            </label>
            <label className="field">
              <span>Protein (g)</span>
              <input
                className="tin"
                inputMode="numeric"
                placeholder="55"
                value={d.proteinG}
                onChange={(e) =>
                  setD((p) => ({ ...p, proteinG: digits(e.target.value) }))
                }
              />
            </label>
            <label className="field">
              <span>Carbs (g)</span>
              <input
                className="tin"
                inputMode="numeric"
                placeholder="115"
                value={d.carbsG}
                onChange={(e) => setD((p) => ({ ...p, carbsG: digits(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Fat (g)</span>
              <input
                className="tin"
                inputMode="numeric"
                placeholder="40"
                value={d.fatG}
                onChange={(e) => setD((p) => ({ ...p, fatG: digits(e.target.value) }))}
              />
            </label>
          </div>

          <div className="field">
            <span>Ingredients</span>
            <div className="nu-ing-edit">
              {d.ingredients.map((ing, i) => (
                <div className="nu-ing-row" key={i}>
                  <input
                    value={ing}
                    aria-label={`Ingredient ${i + 1}`}
                    placeholder="2 cups whole milk"
                    onChange={(e) =>
                      setD((p) => ({
                        ...p,
                        ingredients: p.ingredients.map((x, n) =>
                          n === i ? e.target.value : x,
                        ),
                      }))
                    }
                  />
                  <button
                    className="btn sm ghost"
                    aria-label={`Remove ingredient ${i + 1}`}
                    onClick={() =>
                      setD((p) => ({
                        ...p,
                        ingredients: p.ingredients.filter((_, n) => n !== i),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {d.ingredients.length < MAX_INGREDIENTS && (
              <button
                className="btn sm"
                onClick={() =>
                  setD((p) => ({ ...p, ingredients: [...p.ingredients, ""] }))
                }
              >
                + Ingredient
              </button>
            )}
          </div>

          <div className="field">
            <span>Steps</span>
            <div className="nu-ing-edit">
              {d.steps.map((step, i) => (
                <div className="nu-ing-row" key={i}>
                  <span className="lm-n">{i + 1}</span>
                  <input
                    value={step}
                    aria-label={`Step ${i + 1}`}
                    placeholder="Blend the liquids first, then the rest."
                    onChange={(e) =>
                      setD((p) => ({
                        ...p,
                        steps: p.steps.map((x, n) => (n === i ? e.target.value : x)),
                      }))
                    }
                  />
                  <button
                    className="btn sm ghost"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() =>
                      setD((p) => ({ ...p, steps: p.steps.filter((_, n) => n !== i) }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {d.steps.length < MAX_STEPS && (
              <button
                className="btn sm"
                onClick={() => setD((p) => ({ ...p, steps: [...p.steps, ""] }))}
              >
                + Step
              </button>
            )}
          </div>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              placeholder="Swap the milk for a lactose-free one if it sits heavy."
              value={d.notes}
              onChange={(e) => setD((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>

          {err != null && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}

          <div className="lm-actions">
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : existing ? "Update recipe" : "Add recipe"}
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
