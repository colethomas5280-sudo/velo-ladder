import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SessionModal from "./SessionModal";
import ConfirmDialog from "./ConfirmDialog";

beforeEach(() => cleanup());
afterEach(() => cleanup());

const PROMPT = "Leave this session?";
const prompt = () => screen.queryByRole("dialog", { name: PROMPT });

function open(step: "pick" | "entry", extra: { overlay?: React.ReactNode } = {}) {
  const calls = { close: 0, back: 0, pick: 0 };
  render(
    <SessionModal
      step={step}
      athleteName="Jake Bell"
      tracker="mound"
      onPick={() => calls.pick++}
      onBack={() => calls.back++}
      onClose={() => calls.close++}
      {...extra}
    >
      <p>the weight grid</p>
    </SessionModal>,
  );
  return calls;
}

const backdrop = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.confirm-backdrop)")!;
const x = () => screen.getByRole("button", { name: "Close" });
const escape = () => fireEvent.keyDown(document, { key: "Escape" });

/* ---- entry step: always asks ---- */

test("the X opens the prompt and does not close", () => {
  const calls = open("entry");
  assert.ok(prompt() === null);
  fireEvent.click(x());
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("a click on the dimmed area opens the prompt and does not close", () => {
  const calls = open("entry");
  fireEvent.click(backdrop());
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("Escape opens the prompt and does not close", () => {
  const calls = open("entry");
  escape();
  assert.ok(prompt() !== null);
  assert.equal(calls.close, 0);
});

test("the prompt says what it should", () => {
  open("entry");
  fireEvent.click(x());
  assert.ok(screen.queryByText("Your numbers are kept as a draft, so they'll be here when you come back.") !== null);
  assert.ok(screen.queryByRole("button", { name: "Keep editing" }) !== null);
  assert.ok(screen.queryByRole("button", { name: "Leave" }) !== null);
});

test("Keep editing is the focused default", () => {
  open("entry");
  fireEvent.click(x());
  assert.ok(document.activeElement === screen.getByRole("button", { name: "Keep editing" }));
});

test("Keep editing closes only the prompt", () => {
  const calls = open("entry");
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
  assert.ok(screen.queryByText("the weight grid") !== null, "the pop-up is still there");
});

test("Leave calls onClose exactly once", () => {
  const calls = open("entry");
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  assert.equal(calls.close, 1);
});

test("a click inside the panel never prompts", () => {
  const calls = open("entry");
  fireEvent.click(screen.getByText("the weight grid"));
  fireEvent.click(screen.getByRole("dialog", { name: "Track a new session for Jake Bell" }));
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
});

test("Escape with the prompt open dismisses only the prompt", () => {
  const calls = open("entry");
  fireEvent.click(x());
  escape();
  assert.ok(prompt() === null, "the prompt is gone");
  assert.ok(screen.queryByText("the weight grid") !== null, "the pop-up stays");
  assert.equal(calls.close, 0);
  escape();
  assert.ok(prompt() !== null, "a second Escape asks again");
  assert.equal(calls.close, 0);
});

test("a click on the prompt's own dimmed area dismisses only the prompt", () => {
  const calls = open("entry");
  fireEvent.click(x());
  fireEvent.click(document.querySelector<HTMLElement>(".confirm-backdrop")!);
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
  assert.ok(screen.queryByText("the weight grid") !== null);
});

test("clicking inside the prompt does not re-trigger it", () => {
  const calls = open("entry");
  fireEvent.click(x());
  fireEvent.click(screen.getByText("Your numbers are kept as a draft, so they'll be here when you come back."));
  assert.ok(prompt() !== null);
  assert.equal(document.querySelectorAll(".confirm-backdrop").length, 1);
  assert.equal(calls.close, 0);
});

test("pressing a prompt button never reaches the pop-up's own backdrop handler", () => {
  const calls = open("entry");
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.ok(prompt() === null, "Keep editing did not bounce back into a second prompt");
  fireEvent.click(x());
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  assert.equal(calls.close, 1, "and Leave called onClose once, not twice");
});

test("the prompt is a sibling of the pop-up's backdrop, not inside it", () => {
  open("entry");
  fireEvent.click(x());
  assert.ok(document.querySelector(".modal-backdrop .confirm-backdrop") === null);
  assert.ok(prompt()!.closest(".modal-backdrop:not(.confirm-backdrop)") === null);
});

/* ---- the back button ---- */

test("the back arrow never prompts", () => {
  const calls = open("entry");
  fireEvent.click(screen.getByRole("button", { name: "←" }));
  assert.equal(calls.back, 1);
  assert.ok(prompt() === null);
  assert.equal(calls.close, 0);
});

/* ---- pick step: nothing entered, so closing is instant ---- */

test("on the pick step the X closes at once, with no prompt", () => {
  const calls = open("pick");
  fireEvent.click(x());
  assert.equal(calls.close, 1);
  assert.ok(prompt() === null);
});

test("on the pick step a click on the dimmed area closes at once", () => {
  const calls = open("pick");
  fireEvent.click(backdrop());
  assert.equal(calls.close, 1);
  assert.ok(prompt() === null);
});

test("on the pick step Escape closes at once", () => {
  const calls = open("pick");
  escape();
  assert.equal(calls.close, 1);
  assert.ok(prompt() === null);
});

test("the pick step still picks a tracker", () => {
  const calls = open("pick");
  fireEvent.click(screen.getByRole("button", { name: /Mound/ }));
  assert.equal(calls.pick, 1);
});

/* ---- a second confirm (the save summary) handed in by the caller ---- */

test("Escape while the caller's confirm is up does not also open the leave prompt", () => {
  let cancelled = 0;
  open("entry", {
    overlay: (
      <ConfirmDialog title="Save Jake Bell's session?" confirmLabel="Save" onConfirm={() => {}} onCancel={() => cancelled++} />
    ),
  });
  escape();
  assert.equal(cancelled, 1, "the caller's confirm got the Escape");
  assert.ok(prompt() === null, "the leave prompt did not open on the same key press");
});

test("the caller's confirm renders after the pop-up's backdrop, as a sibling", () => {
  open("entry", {
    overlay: <ConfirmDialog title="Save?" confirmLabel="Save" onConfirm={() => {}} onCancel={() => {}} />,
  });
  const save = screen.getByRole("dialog", { name: "Save?" });
  assert.ok(save.closest(".modal-backdrop:not(.confirm-backdrop)") === null);
  const all = Array.from(document.querySelectorAll(".modal-backdrop"));
  assert.ok(all.indexOf(save.parentElement!) > all.indexOf(backdrop()), "later in the document, so it paints on top");
});

/* ---- housekeeping ---- */

test("the page does not scroll behind the pop-up, and scrolls again after", () => {
  const { unmount } = render(
    <SessionModal step="entry" athleteName="A" tracker="mound" onPick={() => {}} onBack={() => {}} onClose={() => {}}>
      x
    </SessionModal>,
  );
  assert.equal(document.body.style.overflow, "hidden");
  unmount();
  assert.equal(document.body.style.overflow, "");
});
