import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { SCREEN_TESTS, fillNormal } from "@/lib/screen";
import type { MovementScreen } from "@/lib/types";
import { loadTestDraft } from "@/lib/testDraft";
import { withSwr } from "./testSwr";
import ScreenForm from "./ScreenForm";

const ID = "a1";
const TODAY = "2026-10-16";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
});

type Props = Partial<React.ComponentProps<typeof ScreenForm>>;
const form = (props: Props = {}) =>
  render(
    withSwr(
      { [`/api/athletes/${ID}/sessions`]: [] },
      <ScreenForm
        athleteId={ID}
        initial={null}
        takenDates={[]}
        onSaved={() => {}}
        {...props}
      />,
    ),
  );

/** Stubs fetch for POSTs and records { url, body }. Restore in finally. */
function mockApi(status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST" && typeof init.body === "string") {
      calls.push({ url: String(input), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(status === 200 ? {} : { error: "nope" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return real(input as string, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const markRestNormal = () =>
  fireEvent.click(screen.getByRole("button", { name: /mark \d+ remaining tests? normal/i }));

test("the form has no modal chrome of its own", () => {
  form();
  assert.ok(screen.queryByRole("dialog") === null);
});

test("Cancel shows only when a parent gives it somewhere to go", () => {
  form();
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) === null);
  cleanup();
  form({ onCancel: () => {} });
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) !== null);
});

test("group mode hides Cancel and Delete even when editing a saved screen", () => {
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: { x: "normal" }, notes: "" } as unknown as MovementScreen;
  form({ initial: saved, onCancel: () => {}, group: true });
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) === null);
  assert.ok(screen.queryByRole("button", { name: "Delete" }) === null);
});

test("a draft pre-fills the answers, the notes and the date", () => {
  const first = SCREEN_TESTS[0];
  const results = fillNormal({}, [first]);
  form({ draft: { date: "2026-09-16", notes: "stiff left hip", data: results } });
  assert.equal((screen.getByLabelText("Date") as HTMLInputElement).value, "2026-09-16");
  assert.equal((screen.getByPlaceholderText(/guarding on the left/i) as HTMLTextAreaElement).value, "stiff left hip");
  assert.ok(screen.queryByText(/readings recorded/i) !== null);
});

test("onDirty is false until something is answered, then true", async () => {
  const seen: boolean[] = [];
  form({ onDirty: (d) => seen.push(d) });
  assert.equal(seen[seen.length - 1], false);
  markRestNormal();
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
});

test("a saved screen opened untouched is not dirty", () => {
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: { x: "normal" }, notes: "n" } as unknown as MovementScreen;
  const seen: boolean[] = [];
  form({ initial: saved, onDirty: (d) => seen.push(d) });
  assert.equal(seen[seen.length - 1], false);
});

test("with persist on, answering writes a draft", async () => {
  form({ persist: true });
  assert.equal(loadTestDraft("screen", ID), null);
  markRestNormal();
  await waitFor(() => assert.ok(loadTestDraft("screen", ID) !== null, "draft written"));
  assert.equal(loadTestDraft("screen", ID)!.date, TODAY);
});

test("without persist, nothing is written", async () => {
  form();
  markRestNormal();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(loadTestDraft("screen", ID), null);
});

test("register hands the parent a save that posts, resolves true and clears the draft", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ persist: true, group: true, register: (fn) => (save = fn) });
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    let ok = false;
    await act(async () => {
      ok = await save!();
    });
    assert.equal(ok, true);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url, `/api/athletes/${ID}/screens`);
    assert.equal(api.calls[0].body.date, TODAY);
    await waitFor(() => assert.equal(loadTestDraft("screen", ID), null));
  } finally {
    api.restore();
  }
});

test("a failed save resolves false, keeps the draft and shows the error", async () => {
  const api = mockApi(500);
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ persist: true, group: true, register: (fn) => (save = fn) });
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    let ok = false;
    await act(async () => {
      ok = await save!();
    });
    assert.equal(ok, false);
    await waitFor(() => assert.ok(screen.queryByRole("alert") !== null));
    assert.ok(loadTestDraft("screen", ID) !== null, "answers must survive a failed save");
  } finally {
    api.restore();
  }
});

test("after a group save the form reads as an update and the date is locked", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, register: (fn) => (save = fn) });
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    await act(async () => {
      await save!();
    });
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: "Update screen" }) !== null));
    assert.equal((screen.getByLabelText("Date") as HTMLInputElement).disabled, true);
  } finally {
    api.restore();
  }
});

test("onSaved is told what happened", async () => {
  const api = mockApi();
  try {
    const msgs: string[] = [];
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, onSaved: (m) => msgs.push(m), register: (fn) => (save = fn) });
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    await act(async () => {
      await save!();
    });
    assert.deepEqual(msgs, ["Screen saved"]);
  } finally {
    api.restore();
  }
});

test("with persist on, a form that is back to its saved state removes a leftover draft", async () => {
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: { x: "normal" }, notes: "" } as unknown as MovementScreen;
  window.localStorage.setItem(
    `veloladder:testdraft:screen:${ID}`,
    JSON.stringify({ date: TODAY, notes: "", data: { x: "normal" } }),
  );
  assert.ok(loadTestDraft("screen", ID) !== null, "setup: a draft is waiting");
  form({ initial: saved, persist: true });
  await waitFor(() => assert.equal(loadTestDraft("screen", ID), null));
});

test("after a save the form stops warning that the date already holds a screen", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, takenDates: [TODAY], register: (fn) => (save = fn) });
    assert.ok(screen.queryByText(/already exists for/i) !== null, "warns before the save");
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    await act(async () => {
      await save!();
    });
    await waitFor(() => assert.ok(screen.queryByText(/already exists for/i) === null));
  } finally {
    api.restore();
  }
});

test("group mode keeps the editing note but offers no way to leave the record or delete it", () => {
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: { x: "normal" }, notes: "" } as unknown as MovementScreen;
  form({ initial: saved, group: true });
  assert.ok(screen.queryByText(/editing the screen from/i) !== null, "the note still shows");
  assert.ok(screen.queryByRole("button", { name: /record a different date/i }) === null);
  const note = document.querySelector(".ms-note")!.textContent ?? "";
  assert.ok(!/delete/i.test(note), `the note must not point at a Delete that is hidden: ${note}`);
});

test("outside group mode the note still offers the different date and mentions delete", () => {
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: { x: "normal" }, notes: "" } as unknown as MovementScreen;
  form({ initial: saved });
  assert.ok(screen.queryByRole("button", { name: /record a different date/i }) !== null);
  assert.ok(/delete/i.test(document.querySelector(".ms-note")!.textContent ?? ""));
});

test("a draft dated differently from the saved screen is a new screen, not an edit", () => {
  const results = fillNormal({}, [SCREEN_TESTS[0]]);
  // Same readings and notes as the draft, so only a wrong baseline could make it read clean.
  const saved = { id: "s1", athleteId: ID, date: TODAY, results, notes: "" } as unknown as MovementScreen;
  const seen: boolean[] = [];
  form({ initial: saved, draft: { date: "2026-09-16", notes: "", data: results }, onDirty: (d) => seen.push(d) });
  assert.ok(screen.queryByRole("button", { name: "Save screen" }) !== null);
  assert.ok(screen.queryByRole("button", { name: "Update screen" }) === null);
  const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
  assert.equal(dateInput.value, "2026-09-16");
  assert.equal(dateInput.disabled, false);
  assert.ok(screen.queryByText(/editing the screen from/i) === null);
  assert.equal((screen.getByPlaceholderText(/guarding on the left/i) as HTMLTextAreaElement).value, "");
  assert.equal(seen[seen.length - 1], true);
});

test("a draft on the saved screen's own date is an edit that starts dirty", () => {
  const first = SCREEN_TESTS[0];
  const saved = { id: "s1", athleteId: ID, date: TODAY, results: fillNormal({}, [first]), notes: "" } as unknown as MovementScreen;
  const seen: boolean[] = [];
  form({ initial: saved, draft: { date: TODAY, notes: "more", data: saved.results }, onDirty: (d) => seen.push(d) });
  assert.ok(screen.queryByRole("button", { name: "Update screen" }) !== null);
  assert.equal(seen[seen.length - 1], true, "the draft differs from the saved notes");
});

test("clearing a reading and re-answering it the same leaves the form clean, whatever the key order", async () => {
  const results = fillNormal({}, [SCREEN_TESTS[0]]);
  const keys = Object.keys(results);
  assert.ok(keys.length >= 2, "setup: needs two readings so order can differ");
  const saved = { id: "s1", athleteId: ID, date: TODAY, results, notes: "" } as unknown as MovementScreen;
  const seen: boolean[] = [];
  form({ initial: saved, persist: true, onDirty: (d) => seen.push(d) });
  fireEvent.click(document.querySelector(".ms-test-toggle")!);
  const first = () => document.querySelector<HTMLSelectElement>(".ms-select")!;
  const original = first().value;
  assert.ok(original !== "", "setup: the first select holds a reading");
  fireEvent.change(first(), { target: { value: "" } });
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
  await waitFor(() => assert.ok(loadTestDraft("screen", ID) !== null, "draft while changed"));
  fireEvent.change(first(), { target: { value: original } });
  await waitFor(() => assert.equal(seen[seen.length - 1], false));
  await waitFor(() => assert.equal(loadTestDraft("screen", ID), null));
});
