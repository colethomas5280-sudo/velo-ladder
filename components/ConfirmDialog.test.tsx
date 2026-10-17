import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

beforeEach(() => cleanup());
afterEach(() => cleanup());

function open(over: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const calls = { confirm: 0, cancel: 0 };
  render(
    <ConfirmDialog
      title="Leave this session?"
      confirmLabel="Leave"
      cancelLabel="Keep editing"
      onConfirm={() => calls.confirm++}
      onCancel={() => calls.cancel++}
      {...over}
    >
      <p>Your numbers are kept.</p>
    </ConfirmDialog>,
  );
  return calls;
}

test("renders a labelled dialog with its body and both buttons", () => {
  open();
  const d = screen.getByRole("dialog", { name: "Leave this session?" });
  assert.equal(d.getAttribute("aria-modal"), "true");
  assert.ok(screen.queryByText("Your numbers are kept.") !== null);
  assert.ok(screen.queryByRole("button", { name: "Leave" }) !== null);
  assert.ok(screen.queryByRole("button", { name: "Keep editing" }) !== null);
});

test("the cancel button has focus when it opens, so Enter cannot confirm", () => {
  open();
  assert.ok(document.activeElement === screen.getByRole("button", { name: "Keep editing" }));
});

test("the confirm button calls onConfirm, the cancel button calls onCancel", () => {
  const calls = open();
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  assert.deepEqual(calls, { confirm: 1, cancel: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.deepEqual(calls, { confirm: 1, cancel: 1 });
});

test("Escape cancels and does not confirm", () => {
  const calls = open();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(calls, { confirm: 0, cancel: 1 });
});

test("other keys do nothing", () => {
  const calls = open();
  fireEvent.keyDown(document, { key: "a" });
  assert.deepEqual(calls, { confirm: 0, cancel: 0 });
});

test("a click on the dimmed area cancels", () => {
  const calls = open();
  const backdrop = screen.getByRole("dialog").parentElement!;
  assert.ok(backdrop.classList.contains("modal-backdrop"));
  fireEvent.click(backdrop);
  assert.deepEqual(calls, { confirm: 0, cancel: 1 });
});

test("a click inside the box does not cancel", () => {
  const calls = open();
  fireEvent.click(screen.getByText("Your numbers are kept."));
  fireEvent.click(screen.getByRole("dialog"));
  assert.deepEqual(calls, { confirm: 0, cancel: 0 });
});

test("while busy both buttons are disabled and nothing can cancel", () => {
  const calls = open({ busy: true });
  assert.equal((screen.getByRole("button", { name: "Leave" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Keep editing" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  assert.deepEqual(calls, { confirm: 0, cancel: 0 });
});

test("the Escape listener is removed when the dialog goes away", () => {
  const calls = { cancel: 0 };
  const { unmount } = render(
    <ConfirmDialog title="t" confirmLabel="Ok" cancelLabel="No" onConfirm={() => {}} onCancel={() => calls.cancel++}>
      body
    </ConfirmDialog>,
  );
  unmount();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(calls.cancel, 0);
});

test("a destructive confirm is styled as a danger button", () => {
  open({ destructive: true });
  assert.ok(screen.getByRole("button", { name: "Leave" }).classList.contains("danger"));
});

test("focus goes back to where it was when the dialog closes", () => {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  const { unmount } = render(
    <ConfirmDialog title="t" confirmLabel="Ok" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}}>
      body
    </ConfirmDialog>,
  );
  assert.ok(document.activeElement !== opener);
  unmount();
  assert.ok(document.activeElement === opener);
  opener.remove();
});
