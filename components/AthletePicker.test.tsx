import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AthletePicker from "./AthletePicker";

const PEOPLE = [
  { id: "a1", name: "Jake Bell" },
  { id: "a2", name: "Cooper Hale" },
  { id: "a3", name: "Jordan Hale" },
];

beforeEach(cleanup);

function open(over: Partial<React.ComponentProps<typeof AthletePicker>> = {}) {
  const started: string[][] = [];
  render(
    <AthletePicker
      title="Who is in this session?"
      startLabel={(n) => `Start with ${n}`}
      people={PEOPLE}
      onStart={(ids) => started.push(ids)}
      onClose={() => {}}
      {...over}
    />,
  );
  return started;
}
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const start = () => screen.getByRole("button", { name: /^start/i }) as HTMLButtonElement;

test("lists every athlete unchecked, with Start disabled", () => {
  open();
  for (const p of PEOPLE) assert.equal(box(p.name).checked, false);
  assert.equal(start().disabled, true);
});

test("ticking updates the count and enables Start", () => {
  open();
  fireEvent.click(box("Jake Bell"));
  assert.ok(screen.queryByText("1 selected") !== null);
  assert.equal(start().disabled, false);
  assert.equal(start().textContent, "Start with 1");
});

test("Start hands back the picked ids in roster order, not click order", () => {
  const started = open();
  fireEvent.click(box("Jordan Hale"));
  fireEvent.click(box("Jake Bell"));
  fireEvent.click(start());
  assert.deepEqual(started, [["a1", "a3"]]);
});

test("search narrows the list, case-insensitively", () => {
  open();
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "HALE" } });
  assert.ok(screen.queryByRole("checkbox", { name: "Jake Bell" }) === null);
  assert.ok(screen.queryByRole("checkbox", { name: "Cooper Hale" }) !== null);
  assert.ok(screen.queryByRole("checkbox", { name: "Jordan Hale" }) !== null);
});

test("a pick survives being filtered out of view", () => {
  const started = open();
  fireEvent.click(box("Jake Bell"));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "hale" } });
  fireEvent.click(screen.getByRole("button", { name: /^start/i }));
  assert.deepEqual(started, [["a1"]], "Jake stays picked though hidden by the search");
});

test("select all picks what is showing, and clear empties everything", () => {
  open();
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "hale" } });
  fireEvent.click(screen.getByRole("button", { name: /select all/i }));
  assert.ok(screen.queryByText("2 selected") !== null);
  fireEvent.click(screen.getByRole("button", { name: /^clear/i }));
  assert.ok(screen.queryByText(/selected/) === null || screen.queryByText("0 selected") !== null);
  assert.equal(start().disabled, true);
});

test("an empty roster says so and cannot start", () => {
  open({ people: [] });
  assert.ok(screen.queryByText(/no athletes/i) !== null);
  assert.equal(start().disabled, true);
});

test("no athlete matches the search: says so", () => {
  open();
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "zzz" } });
  assert.ok(screen.queryByText(/no one matches/i) !== null);
});

test("Escape closes it", () => {
  let closed = 0;
  open({ onClose: () => (closed += 1) });
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closed, 1);
});
