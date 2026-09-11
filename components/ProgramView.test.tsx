import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { INTERMEDIATE_CYCLE_1, daysOf, rxFor, rxVolume } from "@/lib/program";
import { withSwr } from "./testSwr";
import { LIFT_ROWS } from "./testRender";
import ProgramView from "./ProgramView";

/* ------------------------------------------------------------------ *
 * The program, as written
 *
 * This page exists to be checked against the spreadsheet, so the tests are
 * about it showing the prescription faithfully — and about it admitting,
 * loudly, that nobody has checked it yet.
 * ------------------------------------------------------------------ */

const view = () =>
  render(withSwr({ "/api/lifts": LIFT_ROWS }, <ProgramView />));

beforeEach(cleanup);

test("an unchecked program says so before anyone trains off it", () => {
  view();
  assert.equal(INTERMEDIATE_CYCLE_1.checked, false, "still unchecked — update this when it is");
  assert.ok(screen.getByText(/not checked yet/i));
  assert.ok(screen.getByText(/transcribed from the spreadsheet/i));
});

test("every day and tier in the cycle is on the page", () => {
  view();
  const days = daysOf(INTERMEDIATE_CYCLE_1, "lift");
  assert.equal(days.length, 3, "three lifting days");
  for (const d of days) assert.ok(screen.getByText(`Day ${d.day}`));
  assert.equal(document.querySelectorAll(".pg-tier").length,
    days.reduce((n, d) => n + d.tiers.length, 0));
});

test("the deload week is marked as one", () => {
  view();
  assert.ok(screen.getAllByText(/deload/i).length > 0);
  assert.equal(INTERMEDIATE_CYCLE_1.deloadWeek, 4);
});

test("a tier with two exercises says they are a superset", () => {
  view();
  assert.ok(screen.getAllByText(/superset/i).length > 0);
});

test("the main movement of a tier is marked apart from its accessory", () => {
  view();
  const mains = [...document.querySelectorAll(".pg-main th")].map((n) => n.textContent);
  assert.ok(mains.includes("Front squat"));
  assert.ok(mains.includes("Bench"));
  assert.ok(mains.includes("Deadlift"));
  assert.equal(mains.includes("Prone 1-arm trap raise"), false, "that is the accessory");
});

/*
 * The numbers are the whole point. Front squat is the row most likely to be
 * read first against the sheet, so it is the row asserted here.
 */
test("the front squat's four weeks read as the sheet does", () => {
  view();
  const row = [...document.querySelectorAll(".pg-main")].find((r) =>
    r.textContent?.startsWith("Front squat"),
  )!;
  const cells = [...row.querySelectorAll("td")].map((c) => c.textContent);
  assert.deepEqual(cells, ["3 × 6", "3 × 8", "4 × 10", "3 × 6"]);
});

test("per-side and timed work are not written as plain reps", () => {
  view();
  const text = document.querySelector(".pg")!.textContent!;
  assert.match(text, /3 × 8\/side/, "the trap raise is per side");
  assert.match(text, /2 × 45s/, "and the high plank is a hold");
});

test("a prescribed load is shown where the program gives one", () => {
  view();
  const text = document.querySelector(".pg")!.textContent!;
  assert.match(text, /2\.5 lb/, "trap raise");
  assert.match(text, /5 lb/, "cable external rotation");
});

/* ---------------- reading the cycle ---------------- */

test("per-side work counts double when the volume is totalled", () => {
  const slot = INTERMEDIATE_CYCLE_1.slots.find(
    (s) => s.liftKey === "prone-1-arm-trap-raise",
  )!;
  const p = rxFor(slot, 1)!;
  assert.equal(p.perSide, true);
  assert.equal(rxVolume(p), 48, "3 × 8 a side is 48 reps, not 24");
});

test("a week nobody wrote a prescription for comes back null, not empty", () => {
  const slot = INTERMEDIATE_CYCLE_1.slots[0];
  assert.ok(rxFor(slot, 1));
  assert.equal(rxFor(slot, 9), null);
});

test("tiers come back in order, and exercises in order within them", () => {
  const [day1] = daysOf(INTERMEDIATE_CYCLE_1, "lift");
  assert.deepEqual(day1.tiers.map((t) => t.tier), [1, 2, 3]);
  for (const t of day1.tiers)
    assert.deepEqual(
      t.slots.map((s) => s.position),
      t.slots.map((_, i) => i),
      `tier ${t.tier} is out of order`,
    );
});

test("every slot names a lift the menu actually has", () => {
  const keys = new Set(LIFT_ROWS.map((l) => l.key));
  const orphans = INTERMEDIATE_CYCLE_1.slots
    .map((s) => s.liftKey)
    .filter((k) => !keys.has(k));
  assert.deepEqual([...new Set(orphans)], []);
});

test("every slot has a prescription for every week of the cycle", () => {
  const missing: string[] = [];
  for (const s of INTERMEDIATE_CYCLE_1.slots)
    for (let w = 1; w <= INTERMEDIATE_CYCLE_1.weeks; w++)
      if (!rxFor(s, w)) missing.push(`${s.liftKey} week ${w}`);
  assert.deepEqual(missing, []);
});
