import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MAX_SETS, e1rm, type DatedLifts } from "@/lib/strength";
import { daysAgo, LIFT_ROWS, MENU, TODAY } from "./testRender";
import LiftModal from "./LiftModal";

/* ------------------------------------------------------------------ *
 * Logging a lifting day
 *
 * The form's job between sets is to be fast and to show the number worth
 * beating. These tests hold it to both: it opens empty, a lift is one pick
 * away, and every lift carries what was hit last time — from the history,
 * with the day being edited left out of its own past.
 * ------------------------------------------------------------------ */

const noop = () => {};

function open(history: DatedLifts[] = [], existing: Parameters<typeof LiftModal>[0]["existing"] = null) {
  return render(
    <LiftModal
      athleteId="a1"
      existing={existing}
      date={TODAY}
      history={history}
      menu={MENU}
      onClose={noop}
      onSaved={noop}
    />,
  );
}

const addLift = (key: string) => {
  const select = screen.getByLabelText(/add a lift/i) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: key } });
};

const day = (date: string, lifts: DatedLifts["lifts"]): DatedLifts => ({ date, lifts });

beforeEach(cleanup);

test("the form opens empty rather than listing every lift on the menu", () => {
  open();
  assert.equal(document.querySelectorAll(".lm-lift").length, 0);
  assert.ok(screen.getByText(/pick a lift below/i));
  // But every lift is one pick away.
  const options = [...document.querySelectorAll(".lm-add option")].map((o) => o.textContent);
  for (const l of LIFT_ROWS) assert.ok(options.includes(l.name), l.name);
});

test("picking a lift opens it with one empty set", () => {
  open();
  addLift("back-squat");
  assert.ok(screen.getByText("Back squat"));
  assert.equal(document.querySelectorAll(".lm-set").length, 1);
});

test("a lift already in the day is not offered again", () => {
  open();
  addLift("back-squat");
  const options = [...document.querySelectorAll(".lm-add option")].map((o) => o.textContent);
  assert.equal(options.includes("Back squat"), false);
  assert.ok(options.includes("Bench press"));
});

/*
 * The number to beat is the whole reason to look at the form before typing.
 * Looking it up in the history first is a step nobody takes.
 */
test("a lift shows what was hit last time and the best ever", () => {
  open([
    day(daysAgo(30), { "back-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(7), { "back-squat": [{ w: 245, r: 3 }] }),
  ]);
  addLift("back-squat");
  const target = document.querySelector(".lm-target")!.textContent!;
  assert.match(target, /Last 245 × 3/, "the most recent session, not the best one");
  assert.match(target, new RegExp(`Best ${Math.round(e1rm(245, 3)!)} lb`));
});

test("a lift never done before says so instead of showing a blank target", () => {
  open([day(daysAgo(7), { "bench-press": [{ w: 185, r: 5 }] })]);
  addLift("back-squat");
  assert.match(document.querySelector(".lm-target")!.textContent!, /first time/i);
});

/*
 * Editing today must not read today as history. Otherwise the first set typed
 * becomes "last time" and the athlete is chasing a number from this session.
 */
test("the day being edited is left out of its own past", () => {
  open(
    [
      day(daysAgo(7), { "back-squat": [{ w: 225, r: 5 }] }),
      day(TODAY, { "back-squat": [{ w: 315, r: 1 }] }),
    ],
    {
      id: "d1",
      athleteId: "a1",
      date: TODAY,
      lifts: { "back-squat": [{ w: 315, r: 1 }] },
      notes: "",
      level: null,
    },
  );
  const target = document.querySelector(".lm-target")!.textContent!;
  assert.match(target, /Last 225 × 5/, "today is not its own last time");
  assert.equal(/315/.test(target), false);
});

test("an existing day opens with its sets filled in", () => {
  open([], {
    id: "d1",
    athleteId: "a1",
    date: TODAY,
    lifts: { "back-squat": [{ w: 225, r: 5 }, { w: 245, r: 3 }] },
    notes: "felt good",
    level: null,
  });
  const inputs = [...document.querySelectorAll<HTMLInputElement>(".lm-set .tin")].map(
    (i) => i.value,
  );
  assert.deepEqual(inputs, ["225", "5", "245", "3"]);
  assert.equal((screen.getByPlaceholderText(/felt heavy/i) as HTMLTextAreaElement).value, "felt good");
});

/* A bodyweight set is stored as zero and must come back as an empty box, or
 * the athlete reads "0" as the weight on the bar. */
test("a bodyweight set opens with an empty weight, not a zero", () => {
  open([], {
    id: "d1",
    athleteId: "a1",
    date: TODAY,
    lifts: { "chin-up": [{ w: 0, r: 8 }] },
    notes: "",
    level: null,
  });
  const [w, r] = [...document.querySelectorAll<HTMLInputElement>(".lm-set .tin")];
  assert.equal(w.value, "");
  assert.equal(w.placeholder, "BW");
  assert.equal(r.value, "8");
});

test("adding a set carries the weight down, because that is what a lifter does", () => {
  open();
  addLift("back-squat");
  const [w, r] = [...document.querySelectorAll<HTMLInputElement>(".lm-set .tin")];
  fireEvent.change(w, { target: { value: "225" } });
  fireEvent.change(r, { target: { value: "5" } });
  fireEvent.click(screen.getByText("+ Set"));

  const values = [...document.querySelectorAll<HTMLInputElement>(".lm-set .tin")].map(
    (i) => i.value,
  );
  assert.deepEqual(values, ["225", "5", "225", ""], "same bar, reps still to come");
});

test("the set button stops at the cap the route enforces", () => {
  open();
  addLift("back-squat");
  for (let i = 1; i < MAX_SETS; i++) fireEvent.click(screen.getByText("+ Set"));
  assert.equal(document.querySelectorAll(".lm-set").length, MAX_SETS);
  assert.equal(screen.queryByText("+ Set"), null, "no button to exceed it with");
});

test("a lift can be taken back out of the day", () => {
  open();
  addLift("back-squat");
  fireEvent.click(screen.getByLabelText(/remove back squat/i));
  assert.equal(document.querySelectorAll(".lm-lift").length, 0);
});

test("the weight box refuses letters and a second decimal point", () => {
  open();
  addLift("back-squat");
  const w = document.querySelector<HTMLInputElement>(".lm-set .tin")!;
  fireEvent.change(w, { target: { value: "2a2.5.7" } });
  assert.equal(w.value, "22.57");
});

/*
 * The form read "Best 310 lb (275 × 3)" on real data. Both halves were true
 * of the day and they contradict each other: the 310 came off the back-off
 * set. An athlete who checks the arithmetic finds the app wrong.
 */
test("the best names the set its number came from, not the heaviest of the day", () => {
  open([day(daysAgo(1), { "back-squat": [{ w: 275, r: 3 }, { w: 245, r: 8 }] })]);
  addLift("back-squat");
  const target = document.querySelector(".lm-target")!.textContent!;
  assert.match(target, /Best 310 lb \(245 × 8\)/);
  assert.match(target, /Last 275 × 3/, "the top set is still what he last hit");
});

test("a set can be dropped, but not the last one — that is what Remove is for", () => {
  open();
  addLift("back-squat");
  assert.equal(screen.queryByLabelText(/remove set 1/i), null, "nothing to drop to");

  fireEvent.click(screen.getByText("+ Set"));
  const [w] = [...document.querySelectorAll<HTMLInputElement>(".lm-set .tin")];
  fireEvent.change(w, { target: { value: "225" } });
  fireEvent.click(screen.getByLabelText(/remove set 1/i));

  assert.equal(document.querySelectorAll(".lm-set").length, 1);
  assert.equal(
    document.querySelector<HTMLInputElement>(".lm-set .tin")!.value,
    "",
    "the one that went is the one that was asked for",
  );
});
