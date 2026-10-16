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
  assert.ok(screen.queryByText("0 selected") !== null);
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

const search = () => screen.getByPlaceholderText(/search/i);

test("Clear empties every pick, including ones hidden by the search", () => {
  const started = open();
  fireEvent.click(box("Jake Bell"));
  fireEvent.change(search(), { target: { value: "hale" } });
  fireEvent.click(screen.getByRole("button", { name: /select all/i }));
  assert.ok(screen.queryByText("3 selected") !== null);
  fireEvent.click(screen.getByRole("button", { name: /^clear/i }));
  assert.ok(screen.queryByText("0 selected") !== null);
  fireEvent.change(search(), { target: { value: "" } });
  assert.equal(box("Jake Bell").checked, false, "Jake was hidden but must be cleared too");
  assert.equal(start().disabled, true);
  assert.deepEqual(started, []);
});

test("a roster that shrinks under a pick drops that pick from count, label and Start", () => {
  const started: string[][] = [];
  const props = {
    title: "Who is in this session?",
    startLabel: (n: number) => `Start with ${n}`,
    onStart: (ids: string[]) => started.push(ids),
    onClose: () => {},
  };
  const { rerender } = render(<AthletePicker {...props} people={PEOPLE} />);
  fireEvent.click(box("Jake Bell"));
  assert.ok(screen.queryByText("1 selected") !== null);
  rerender(<AthletePicker {...props} people={PEOPLE.slice(1)} />);
  assert.ok(screen.queryByText("0 selected") !== null);
  assert.equal(start().textContent, "Start with 0");
  assert.equal(start().disabled, true);
  assert.deepEqual(started, []);
});

test("two athletes with the same name are picked independently by id", () => {
  const started = open({
    people: [
      { id: "a1", name: "Sam Lee" },
      { id: "a2", name: "Sam Lee" },
    ],
  });
  const boxes = screen.getAllByRole("checkbox", { name: "Sam Lee" }) as HTMLInputElement[];
  assert.equal(boxes.length, 2);
  fireEvent.click(boxes[1]);
  assert.equal(boxes[0].checked, false);
  assert.equal(boxes[1].checked, true);
  fireEvent.click(start());
  assert.deepEqual(started, [["a2"]]);
});

test("Enter in the search box neither starts nor closes", () => {
  let closed = 0;
  const started = open({ onClose: () => (closed += 1) });
  fireEvent.click(box("Jake Bell"));
  fireEvent.keyDown(search(), { key: "Enter" });
  assert.deepEqual(started, []);
  assert.equal(closed, 0);
});

test("the picker's buttons are type=button, safe inside a form", () => {
  open();
  for (const name of [/select all/i, /^clear/i, /^start/i, /^close/i]) {
    assert.equal(screen.getByRole("button", { name }).getAttribute("type"), "button");
  }
});

test("Select all keeps picks already held out of view", () => {
  const started = open();
  fireEvent.click(box("Jake Bell"));
  fireEvent.change(search(), { target: { value: "hale" } });
  fireEvent.click(screen.getByRole("button", { name: /select all/i }));
  assert.ok(screen.queryByText("3 selected") !== null);
  fireEvent.click(start());
  assert.deepEqual(started, [["a1", "a2", "a3"]]);
});

test("the x button closes", () => {
  let closed = 0;
  open({ onClose: () => (closed += 1) });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  assert.equal(closed, 1);
});

test("clicking the backdrop closes, clicking inside the panel does not", () => {
  let closed = 0;
  open({ onClose: () => (closed += 1) });
  fireEvent.click(screen.getByRole("dialog"));
  fireEvent.click(box("Jake Bell"));
  assert.equal(closed, 0);
  fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
  assert.equal(closed, 1);
});

test("the page does not scroll behind it, and scrolling comes back on unmount", () => {
  document.body.style.overflow = "";
  const { unmount } = render(
    <AthletePicker
      title="t"
      startLabel={(n) => `Start ${n}`}
      people={PEOPLE}
      onStart={() => {}}
      onClose={() => {}}
    />,
  );
  assert.equal(document.body.style.overflow, "hidden");
  unmount();
  assert.equal(document.body.style.overflow, "");
});
