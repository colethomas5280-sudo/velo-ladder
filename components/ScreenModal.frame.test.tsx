import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { MovementScreen } from "@/lib/types";
import { withSwr } from "./testSwr";
import ScreenModal from "./ScreenModal";

/* ------------------------------------------------------------------ *
 * The frame around the movement screen form
 *
 * ScreenModal.test.tsx covers the form's behaviour. These pin what splitting
 * the form out of the modal could have broken: closing (Cancel, the x,
 * Escape, the backdrop), the scroll lock, the dialog's name, Delete, and the
 * messages Save reports.
 * ------------------------------------------------------------------ */

const ID = "a1";
const DATE = "2026-10-16";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  document.body.style.overflow = "";
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const saved = {
  id: "s1",
  athleteId: ID,
  date: DATE,
  results: { x: "normal" },
  notes: "kept",
} as unknown as MovementScreen;

function modal(
  opts: { initial?: MovementScreen | null; onClose?: () => void; onSaved?: (m: string) => void } = {},
) {
  return render(
    withSwr(
      { [`/api/athletes/${ID}/sessions`]: [] },
      <ScreenModal
        athleteId={ID}
        athleteName="Test Athlete"
        initial={opts.initial ?? null}
        takenDates={[]}
        isCoach
        onClose={opts.onClose ?? (() => {})}
        onSaved={opts.onSaved ?? (() => {})}
      />,
    ),
  );
}

/** Records every non-GET request as { method, url }. Restore in finally. */
function mockApi() {
  const calls: { method: string; url: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      calls.push({ method: init.method, url: String(input) });
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return real(input as string, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const counter = () => {
  let n = 0;
  return { fn: () => void (n += 1), count: () => n };
};

test("Cancel calls onClose", () => {
  const close = counter();
  modal({ onClose: close.fn });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(close.count(), 1);
});

test("the x button calls onClose", () => {
  const close = counter();
  modal({ onClose: close.fn });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  assert.equal(close.count(), 1);
});

test("Escape calls onClose", () => {
  const close = counter();
  modal({ onClose: close.fn });
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(close.count(), 1);
  fireEvent.keyDown(document, { key: "a" });
  assert.equal(close.count(), 1, "other keys do not close it");
});

test("clicking the backdrop closes, a click inside the panel does not", () => {
  const close = counter();
  modal({ onClose: close.fn });
  fireEvent.click(screen.getByRole("dialog"));
  assert.equal(close.count(), 0);
  fireEvent.click(document.querySelector(".modal-backdrop")!);
  assert.equal(close.count(), 1);
});

test("body scroll is locked while open and restored after unmount", () => {
  const r = modal();
  assert.equal(document.body.style.overflow, "hidden");
  r.unmount();
  assert.equal(document.body.style.overflow, "");
});

test("the dialog is named Movement screen and shows the athlete's name", () => {
  modal();
  assert.equal(screen.getByRole("dialog").getAttribute("aria-label"), "Movement screen");
  assert.ok(screen.queryByText("Test Athlete") !== null);
});

test("a saved screen offers Delete, which asks first and then deletes that date", async () => {
  const api = mockApi();
  try {
    const messages: string[] = [];
    modal({ initial: saved, onSaved: (m) => messages.push(m) });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    assert.equal(api.calls.length, 0, "the first click only asks");
    assert.ok(screen.queryByRole("button", { name: "Really delete?" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Really delete?" }));
    });
    await waitFor(() => assert.deepEqual(messages, ["Screen deleted"]));
    assert.deepEqual(api.calls, [
      { method: "DELETE", url: `/api/athletes/${ID}/screens?date=${DATE}` },
    ]);
  } finally {
    api.restore();
  }
});

test("a new screen has no Delete", () => {
  modal();
  assert.ok(screen.queryByRole("button", { name: "Delete" }) === null);
});

test("Save posts and reports Screen saved for a new screen", async () => {
  const api = mockApi();
  try {
    const messages: string[] = [];
    modal({ onSaved: (m) => messages.push(m) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save screen" }));
    });
    await waitFor(() => assert.deepEqual(messages, ["Screen saved"]));
    assert.deepEqual(api.calls, [{ method: "POST", url: `/api/athletes/${ID}/screens` }]);
  } finally {
    api.restore();
  }
});

test("Save reports Screen updated for a saved screen", async () => {
  const api = mockApi();
  try {
    const messages: string[] = [];
    modal({ initial: saved, onSaved: (m) => messages.push(m) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update screen" }));
    });
    await waitFor(() => assert.deepEqual(messages, ["Screen updated"]));
  } finally {
    api.restore();
  }
});
