import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GroupEntryModal from "./GroupEntryModal";
import ConfirmDialog from "./ConfirmDialog";

beforeEach(() => cleanup());
afterEach(() => cleanup());

const PROMPT = "Leave this session?";
const prompt = () => screen.queryByRole("dialog", { name: PROMPT });

function open(extra: { overlay?: React.ReactNode } = {}) {
  const calls = { close: 0, pick: [] as string[], tracker: [] as string[] };
  render(
    <GroupEntryModal
      tabs={[
        { id: "a", name: "Jake", status: "empty" },
        { id: "b", name: "Cooper", status: "data" },
      ]}
      activeId="a"
      onPick={(id) => calls.pick.push(id)}
      onClose={() => calls.close++}
      tracker="mound"
      setTracker={(t) => calls.tracker.push(t)}
      {...extra}
    >
      <p>the weight grid</p>
    </GroupEntryModal>,
  );
  return calls;
}

const backdrop = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.confirm-backdrop)")!;
const x = () => screen.getByRole("button", { name: "Close" });
const escape = () => fireEvent.keyDown(document, { key: "Escape" });

test("the X opens the prompt and does not close, even with an empty form", () => {
  const calls = open();
  fireEvent.click(x());
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("a click on the dimmed area opens the prompt and does not close", () => {
  const calls = open();
  fireEvent.click(backdrop());
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("Escape opens the prompt and does not close", () => {
  const calls = open();
  escape();
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("the prompt says what it should", () => {
  open();
  escape();
  assert.ok(screen.queryByText("Your numbers are kept as a draft, so they'll be here when you come back.") !== null);
  assert.ok(screen.queryByRole("button", { name: "Keep editing" }) !== null);
  assert.ok(screen.queryByRole("button", { name: "Leave" }) !== null);
});

test("Keep editing is the focused default", () => {
  open();
  fireEvent.click(x());
  assert.ok(document.activeElement === screen.getByRole("button", { name: "Keep editing" }));
});

test("Keep editing closes only the prompt", () => {
  const calls = open();
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
  assert.ok(screen.queryByText("the weight grid") !== null);
});

test("Leave calls onClose exactly once", () => {
  const calls = open();
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  assert.equal(calls.close, 1);
});

test("a click inside the panel never prompts", () => {
  const calls = open();
  fireEvent.click(screen.getByText("the weight grid"));
  fireEvent.click(screen.getByRole("dialog"));
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
});

test("the tabs and the tracker switch never prompt", () => {
  const calls = open();
  fireEvent.click(screen.getByRole("button", { name: /Cooper/ }));
  fireEvent.click(screen.getByRole("button", { name: "Pull-Down" }));
  assert.deepEqual(calls.pick, ["b"]);
  assert.deepEqual(calls.tracker, ["pulldown"]);
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
});

test("Escape with the prompt open dismisses only the prompt", () => {
  const calls = open();
  fireEvent.click(x());
  escape();
  assert.ok(prompt() === null);
  assert.ok(screen.queryByText("the weight grid") !== null);
  assert.equal(calls.close, 0);
  escape();
  assert.ok(prompt() !== null, "a second Escape asks again");
  assert.equal(calls.close, 0);
});

test("a click on the prompt's own dimmed area dismisses only the prompt", () => {
  const calls = open();
  fireEvent.click(x());
  fireEvent.click(document.querySelector<HTMLElement>(".confirm-backdrop")!);
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
});

test("clicking inside the prompt does not re-trigger it", () => {
  const calls = open();
  fireEvent.click(x());
  fireEvent.click(screen.getByText("Your numbers are kept as a draft, so they'll be here when you come back."));
  assert.ok(prompt() !== null);
  assert.equal(document.querySelectorAll(".confirm-backdrop").length, 1);
  assert.equal(calls.close, 0);
});

test("pressing a prompt button never reaches the pop-up's own backdrop handler", () => {
  const calls = open();
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.ok(prompt() === null, "Keep editing did not bounce back into a second prompt");
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  assert.equal(calls.close, 1);
});

test("the prompt is a sibling of the pop-up's backdrop, not inside it", () => {
  open();
  fireEvent.click(x());
  assert.ok(prompt()!.closest(".modal-backdrop:not(.confirm-backdrop)") === null);
});

test("Escape while the caller's confirm is up does not also open the leave prompt", () => {
  let cancelled = 0;
  open({
    overlay: <ConfirmDialog title="Save 2 sessions?" confirmLabel="Save all" onConfirm={() => {}} onCancel={() => cancelled++} />,
  });
  escape();
  assert.equal(cancelled, 1);
  assert.ok(prompt() === null);
});

test("the caller's confirm renders after the pop-up's backdrop, as a sibling", () => {
  open({
    overlay: <ConfirmDialog title="Save?" confirmLabel="Save" onConfirm={() => {}} onCancel={() => {}} />,
  });
  const save = screen.getByRole("dialog", { name: "Save?" });
  assert.ok(save.closest(".modal-backdrop:not(.confirm-backdrop)") === null);
  const all = Array.from(document.querySelectorAll(".modal-backdrop"));
  assert.ok(all.indexOf(save.parentElement!) > all.indexOf(backdrop()));
});

test("the page does not scroll behind the pop-up, and scrolls again after", () => {
  const { unmount } = render(
    <GroupEntryModal tabs={[]} activeId={null} onPick={() => {}} onClose={() => {}} tracker="mound" setTracker={() => {}}>
      x
    </GroupEntryModal>,
  );
  assert.equal(document.body.style.overflow, "hidden");
  unmount();
  assert.equal(document.body.style.overflow, "");
});
