import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { targetFor } from "@/lib/relative";
import StrengthStandards from "./StrengthStandards";

/* ------------------------------------------------------------------ *
 * The standards calculator
 *
 * The version of the standards that needs nothing logged: height and weight
 * in, pounds out. It is reached from Resources, so anyone can open it — which
 * is exactly why the bodyweight half has to read as a scale rather than a
 * verdict on a teenager's body.
 * ------------------------------------------------------------------ */

const open = () => render(<StrengthStandards />);

const fill = (ft: string, inch: string, lb: string) => {
  fireEvent.change(screen.getByLabelText(/height, feet/i), { target: { value: ft } });
  fireEvent.change(screen.getByLabelText(/height, inches/i), { target: { value: inch } });
  fireEvent.change(screen.getByLabelText(/bodyweight in pounds/i), {
    target: { value: lb },
  });
};

beforeEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* nothing saved to clear */
  }
});

test("it opens empty and asks for the two numbers it needs", () => {
  open();
  assert.ok(screen.getByText(/fill both in/i));
  assert.equal(document.querySelector(".ss-targets"), null);
});

test("height and weight turn the ratios into pounds", () => {
  open();
  fill("6", "0", "180");
  const rows = [...document.querySelectorAll(".ss-targets li")].map((l) => l.textContent!);
  const dl = rows.find((r) => /deadlift/i.test(r))!;
  // 2.25 x 180 = 405, already a loadable number.
  assert.match(dl, new RegExp(`${targetFor("deadlift")! * 180} lb`));
  assert.match(dl, /2\.25× bodyweight/);
});

test("the targets move with the athlete, because that is what a ratio does", () => {
  open();
  fill("6", "0", "180");
  const at180 = document.querySelector(".ss-targets li")!.textContent!;
  fill("6", "0", "200");
  const at200 = document.querySelector(".ss-targets li")!.textContent!;
  assert.notEqual(at180, at200);
});

/*
 * The pull-up row has to name the PLATE, not the total. At 1.5x the athlete
 * is already carrying 1x of it himself; printing 270 lb would be telling a
 * 180 lb kid to hang half again his own bodyweight off a bar.
 */
test("the pull-up target is reps first, then the plate to hang on", () => {
  open();
  fill("6", "0", "180");
  const pu = [...document.querySelectorAll(".ss-targets li")]
    .map((l) => l.textContent!)
    .find((r) => /pull-up/i.test(r))!;
  assert.match(pu, /14 reps/);
  assert.match(pu, /\+70 lb/, "250 total, and he is 180 of it");
  assert.equal(/250 lb/.test(pu), false, "the plate, not the total");
});

/* ---------------- bodyweight, as a scale ---------------- */

test("bodyweight is shown as named anchors, not as a pass or fail", () => {
  open();
  fill("6", "0", "180");
  const body = document.querySelector(".ss-body")!.textContent!;
  // 72in x 2.5 / 2.7 / 2.8, each rounded up to the nearest 5.
  assert.match(body, /180 lb/);
  assert.match(body, /195 lb/);
  assert.match(body, /205 lb/);
  assert.match(body, /high-school draftee/i, "each anchor says what it is");
  assert.match(body, /average MLB player/i);
});

test("under a mark it says how far, in pounds, without a verdict", () => {
  open();
  fill("6", "0", "170");
  const v = document.querySelector(".ss-verdict")!.textContent!;
  assert.match(v, /10 lb from minimum/i);
  for (const word of ["underweight", "too light", "not enough", "should weigh"])
    assert.equal(v.toLowerCase().includes(word), false, `"${word}" is a verdict`);
});

test("at the top of the scale there is nothing left to chase", () => {
  open();
  fill("6", "0", "230");
  assert.match(document.querySelector(".ss-verdict")!.textContent!, /at or above every mark/i);
});

test("the anchor reached is marked, and only that one", () => {
  open();
  fill("6", "0", "196"); // past Minimum (180) and Target (194), under Pro (202)
  const at = document.querySelectorAll(".ss-anchor-at");
  assert.equal(at.length, 1);
  assert.match(at[0].textContent!, /Target/);
});

test("a half-filled form computes nothing rather than guessing", () => {
  open();
  fireEvent.change(screen.getByLabelText(/height, feet/i), { target: { value: "6" } });
  assert.ok(screen.getByText(/fill both in/i));
  assert.equal(document.querySelector(".ss-body"), null);
});

test("the boxes refuse anything that is not a number", () => {
  open();
  const lb = screen.getByLabelText(/bodyweight in pounds/i) as HTMLInputElement;
  fireEvent.change(lb, { target: { value: "18o lbs" } });
  assert.equal(lb.value, "18");
});

/* What gets typed is a measurement of a teenager's body; it stays local. */
test("what is typed is remembered in this browser and sent nowhere", () => {
  open();
  fill("6", "2", "195");
  cleanup();
  open();
  assert.equal(
    (screen.getByLabelText(/bodyweight in pounds/i) as HTMLInputElement).value,
    "195",
  );
  assert.match(screen.getByText(/nothing is saved anywhere but this browser/i).textContent!, /browser/);
});

/*
 * A bodyweight is a number the athlete typed, not a plate to load. Rounding
 * it to the nearest five made the page tell someone who entered 186 that his
 * targets were worked out "at 185 lb".
 */
test("the basis line repeats the weight as entered, not rounded to a plate", () => {
  open();
  fill("6", "1", "186");
  // Scoped: the anchor notes use .ss-basis too, and one of them is first.
  const basis = document.querySelector(".cz-note.ss-basis")!.textContent!;
  assert.match(basis, /At 186 lb/);
});

/*
 * The bar exists to show the difference between 2.5x and 2.7x. Running the
 * scale from zero pushed every anchor into its right-hand fifth, where that
 * difference is invisible.
 */
test("the anchors are spread across the scale, not bunched at one end", () => {
  open();
  fill("6", "0", "180");
  const ticks = [...document.querySelectorAll<HTMLElement>(".ss-tick")].map((t) =>
    parseFloat(t.style.left),
  );
  assert.equal(ticks.length, 3);
  assert.ok(ticks[0] > 10, `first anchor at ${ticks[0]}% — too close to the edge`);
  assert.ok(ticks[2] < 95, `last anchor at ${ticks[2]}% — pinned to the end`);
  assert.ok(
    ticks[2] - ticks[0] > 25,
    `the anchors span only ${(ticks[2] - ticks[0]).toFixed(0)}% of the bar`,
  );
});

test("the marker tracks the athlete along that scale", () => {
  open();
  fill("6", "0", "170");
  const light = parseFloat(document.querySelector<HTMLElement>(".ss-marker")!.style.left);
  fill("6", "0", "205");
  const heavy = parseFloat(document.querySelector<HTMLElement>(".ss-marker")!.style.left);
  assert.ok(heavy > light);
});

/*
 * One rounding rule across the page. The back squat's true 2x of 186 is 372;
 * showing 370 while the bodyweight marks rounded up was two rules disagreeing,
 * and the lower one handed back two pounds of Cole's standard.
 */
test("a lift target rounds up, the same way the bodyweight marks do", () => {
  open();
  fill("6", "1", "186");
  const bs = [...document.querySelectorAll(".ss-targets li")]
    .map((l) => l.textContent!)
    .find((r) => /back squat/i.test(r))!;
  assert.match(bs, /375 lb/);
  assert.equal(/370/.test(bs), false);
});
