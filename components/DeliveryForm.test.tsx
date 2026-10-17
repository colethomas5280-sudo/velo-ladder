import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { BIG_12 } from "@/lib/big12";
import type { DeliveryScreen } from "@/lib/types";
import { loadTestDraft } from "@/lib/testDraft";
import DeliveryForm from "./DeliveryForm";

const ID = "a1";
const TODAY = "2026-10-16";
const FLAW = BIG_12[0].key;
const OTHER = BIG_12[1].key;

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
});

type Props = Partial<React.ComponentProps<typeof DeliveryForm>>;
const form = (props: Props = {}) =>
  render(
    <DeliveryForm
      athleteId={ID}
      date={TODAY}
      initial={null}
      takenDates={[]}
      onSaved={() => {}}
      {...props}
    />,
  );
const tick = (key = FLAW) =>
  fireEvent.click(document.querySelector(`input[name="flaw:${key}"]`)!);
const box = (key = FLAW) =>
  document.querySelector<HTMLInputElement>(`input[name="flaw:${key}"]`)!;

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

const saved = (over: Partial<DeliveryScreen> = {}): DeliveryScreen => ({
  id: "d1",
  athleteId: ID,
  date: TODAY,
  flaws: { [FLAW]: true },
  notes: "",
  ...over,
});

test("the form has no modal chrome of its own", () => {
  form();
  assert.ok(screen.queryByRole("dialog") === null);
});

test("Cancel shows only when a parent gives it somewhere to go, and never in group mode", () => {
  form();
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) === null);
  cleanup();
  form({ onCancel: () => {} });
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) !== null);
  cleanup();
  form({ onCancel: () => {}, group: true });
  assert.ok(screen.queryByRole("button", { name: "Cancel" }) === null);
});

test("a draft pre-ticks its flaws and fills the notes and the date", () => {
  form({ draft: { date: "2026-09-16", notes: "steep arm path", data: { [FLAW]: true } } });
  assert.equal(box().checked, true);
  assert.equal(box(OTHER).checked, false);
  assert.equal((screen.getByLabelText("Date") as HTMLInputElement).value, "2026-09-16");
  assert.equal(
    (screen.getByPlaceholderText(/filmed from the side/i) as HTMLTextAreaElement).value,
    "steep arm path",
  );
});

test("onDirty is false until something is ticked, then true", async () => {
  const seen: boolean[] = [];
  form({ onDirty: (d) => seen.push(d) });
  assert.equal(seen[seen.length - 1], false);
  tick();
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
});

test("a saved assessment opened untouched is not dirty, and unticking back to it is not dirty", async () => {
  const seen: boolean[] = [];
  form({ initial: saved({ flaws: { [FLAW]: true, [OTHER]: true } }), onDirty: (d) => seen.push(d) });
  assert.equal(seen[seen.length - 1], false);
  tick(); // unticks one of two saved flaws
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
  tick(); // ticks it again
  await waitFor(() => assert.equal(seen[seen.length - 1], false));
});

test("ticking then unticking a flaw is not dirty and leaves no draft behind", async () => {
  const seen: boolean[] = [];
  form({ persist: true, onDirty: (d) => seen.push(d) });
  tick();
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
  await waitFor(() => assert.ok(loadTestDraft("delivery", ID) !== null, "draft while ticked"));
  tick();
  await waitFor(() => assert.equal(seen[seen.length - 1], false));
  await waitFor(() => assert.equal(loadTestDraft("delivery", ID), null));
});

test("key order does not matter: re-ticking a saved flaw in a different order is clean", async () => {
  const seen: boolean[] = [];
  form({
    initial: saved({ flaws: { [FLAW]: true, [OTHER]: true } }),
    onDirty: (d) => seen.push(d),
  });
  tick(FLAW);
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
  tick(FLAW); // FLAW now sits after OTHER in the object
  await waitFor(() => assert.equal(seen[seen.length - 1], false));
});

test("with persist on, ticking writes a draft and unticking removes it", async () => {
  form({ persist: true });
  assert.equal(loadTestDraft("delivery", ID), null);
  tick();
  await waitFor(() => assert.ok(loadTestDraft("delivery", ID) !== null, "draft written"));
  const d = loadTestDraft("delivery", ID)!;
  assert.deepEqual(d.data, { [FLAW]: true });
  assert.equal(d.date, TODAY);
  tick();
  await waitFor(() => assert.equal(loadTestDraft("delivery", ID), null));
});

test("without persist, nothing is written", async () => {
  form();
  tick();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(loadTestDraft("delivery", ID), null);
});

test("register hands the parent a save that posts, resolves true and clears the draft", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ persist: true, group: true, register: (fn) => (save = fn) });
    tick();
    await waitFor(() => assert.ok(save !== null));
    await waitFor(() => assert.ok(loadTestDraft("delivery", ID) !== null));
    fireEvent.change(screen.getByPlaceholderText(/filmed from the side/i), {
      target: { value: "  note  " },
    });
    let ok = false;
    await act(async () => {
      ok = await save!();
    });
    assert.equal(ok, true);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url, `/api/athletes/${ID}/delivery`);
    assert.deepEqual(api.calls[0].body, { date: TODAY, flaws: { [FLAW]: true }, notes: "note" });
    await waitFor(() => assert.equal(loadTestDraft("delivery", ID), null));
  } finally {
    api.restore();
  }
});

test("a failed save resolves false, keeps the draft and shows the error", async () => {
  const api = mockApi(500);
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ persist: true, group: true, register: (fn) => (save = fn) });
    tick();
    await waitFor(() => assert.ok(save !== null));
    await waitFor(() => assert.ok(loadTestDraft("delivery", ID) !== null));
    let ok = true;
    await act(async () => {
      ok = await save!();
    });
    assert.equal(ok, false);
    await waitFor(() => assert.ok(screen.queryByRole("alert") !== null));
    assert.ok(loadTestDraft("delivery", ID) !== null, "marks must survive a failed save");
  } finally {
    api.restore();
  }
});

test("a clean assessment can be saved: nothing ticked posts flaws {} and resolves true", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, register: (fn) => (save = fn) });
    await waitFor(() => assert.ok(save !== null));
    let ok = false;
    await act(async () => {
      ok = await save!();
    });
    assert.equal(ok, true);
    assert.equal(api.calls.length, 1);
    assert.deepEqual(api.calls[0].body, { date: TODAY, flaws: {}, notes: "" });
  } finally {
    api.restore();
  }
});

test("the form's own Save button also records a clean assessment", async () => {
  const api = mockApi();
  try {
    form();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    });
    await waitFor(() => assert.equal(api.calls.length, 1));
    assert.deepEqual(api.calls[0].body.flaws, {});
  } finally {
    api.restore();
  }
});

test("after a group save the button reads Update, the date is locked and onSaved is told", async () => {
  const api = mockApi();
  try {
    const msgs: string[] = [];
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, onSaved: (m) => msgs.push(m), register: (fn) => (save = fn) });
    tick();
    await waitFor(() => assert.ok(save !== null));
    assert.ok(screen.queryByRole("button", { name: "Save assessment" }) !== null);
    await act(async () => {
      await save!();
    });
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: "Update assessment" }) !== null));
    assert.equal((screen.getByLabelText("Date") as HTMLInputElement).disabled, true);
    assert.deepEqual(msgs, ["Assessment saved"]);
  } finally {
    api.restore();
  }
});

test("a second save says updated", async () => {
  const api = mockApi();
  try {
    const msgs: string[] = [];
    let save: (() => Promise<boolean>) | null = null;
    form({ group: true, onSaved: (m) => msgs.push(m), register: (fn) => (save = fn) });
    await waitFor(() => assert.ok(save !== null));
    await act(async () => {
      await save!();
    });
    await act(async () => {
      await save!();
    });
    assert.deepEqual(msgs, ["Assessment saved", "Assessment updated"]);
  } finally {
    api.restore();
  }
});

test("after a save the form is clean again and stops warning about the date", async () => {
  const api = mockApi();
  try {
    const seen: boolean[] = [];
    let save: (() => Promise<boolean>) | null = null;
    form({
      group: true,
      takenDates: [TODAY],
      onDirty: (d) => seen.push(d),
      register: (fn) => (save = fn),
    });
    assert.ok(screen.queryByText(/already exists for/i) !== null, "warns before the save");
    tick();
    await waitFor(() => assert.equal(seen[seen.length - 1], true));
    await act(async () => {
      await save!();
    });
    await waitFor(() => assert.equal(seen[seen.length - 1], false));
    await waitFor(() => assert.ok(screen.queryByText(/already exists for/i) === null));
  } finally {
    api.restore();
  }
});

test("with persist on, a form that is back to its saved state removes a leftover draft", async () => {
  window.localStorage.setItem(
    `veloladder:testdraft:delivery:${ID}`,
    JSON.stringify({ date: TODAY, notes: "", data: { [FLAW]: true } }),
  );
  assert.ok(loadTestDraft("delivery", ID) !== null, "setup: a draft is waiting");
  form({ initial: saved(), persist: true });
  await waitFor(() => assert.equal(loadTestDraft("delivery", ID), null));
});

test("a draft dated differently from the saved assessment is a new one, not an edit", () => {
  const seen: boolean[] = [];
  // Same flaws as the draft, so only a wrong baseline could make it read clean.
  form({
    initial: saved({ date: TODAY }),
    draft: { date: "2026-09-16", notes: "", data: { [FLAW]: true } },
    onDirty: (d) => seen.push(d),
  });
  assert.ok(screen.queryByRole("button", { name: "Save assessment" }) !== null);
  assert.ok(screen.queryByRole("button", { name: "Update assessment" }) === null);
  const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
  assert.equal(dateInput.value, "2026-09-16");
  assert.equal(dateInput.disabled, false);
  assert.equal(seen[seen.length - 1], true);
});

test("a draft on the saved assessment's own date is an edit that starts dirty", () => {
  const seen: boolean[] = [];
  form({
    initial: saved(),
    draft: { date: TODAY, notes: "more", data: { [FLAW]: true } },
    onDirty: (d) => seen.push(d),
  });
  assert.ok(screen.queryByRole("button", { name: "Update assessment" }) !== null);
  assert.equal((screen.getByLabelText("Date") as HTMLInputElement).disabled, true);
  assert.equal(seen[seen.length - 1], true, "the draft differs from the saved notes");
});

test("clearing every mark of a saved assessment reports no unsaved answers and leaves no draft", async () => {
  const seen: boolean[] = [];
  form({ initial: saved(), persist: true, onDirty: (d) => seen.push(d) });
  tick(); // unticks the only saved flaw, so nothing is marked although the form differs from the record
  assert.equal(box().checked, false);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(seen[seen.length - 1], false, "no marks means no unsaved answers");
  assert.ok(seen.every((d) => d === false), "never reported true");
  assert.equal(loadTestDraft("delivery", ID), null, "an empty mark set is never kept as a draft");
});

test("typing only in the notes of a clean assessment does not report unsaved answers", async () => {
  const seen: boolean[] = [];
  form({ persist: true, onDirty: (d) => seen.push(d) });
  fireEvent.change(screen.getByPlaceholderText(/filmed from the side/i), { target: { value: "just a note" } });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.ok(seen.every((d) => d === false), "never reported true");
  assert.equal(loadTestDraft("delivery", ID), null);
});

test("marking one more flaw on a saved assessment reports unsaved answers", async () => {
  const seen: boolean[] = [];
  form({ initial: saved(), onDirty: (d) => seen.push(d) });
  assert.equal(seen[seen.length - 1], false);
  tick(OTHER);
  await waitFor(() => assert.equal(seen[seen.length - 1], true));
});

/* ---- persist off: a save on the athlete's own page clears a leftover group draft ---- */

const stored = (date: string) => {
  window.localStorage.setItem(
    `veloladder:testdraft:delivery:${ID}`,
    JSON.stringify({ date, notes: "", data: { [FLAW]: true } }),
  );
};

async function saveFromOwnPage(opts: { status?: number } = {}) {
  const api = mockApi(opts.status ?? 200);
  try {
    form();
    tick(OTHER);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    });
    return api.calls.length;
  } finally {
    api.restore();
  }
}

test("persist off: a successful save clears a stored draft for the same date", async () => {
  stored(TODAY);
  assert.equal(await saveFromOwnPage(), 1);
  assert.equal(loadTestDraft("delivery", ID), null);
});

test("persist off: a stored draft for a different date survives a save", async () => {
  stored("2026-09-16");
  assert.equal(await saveFromOwnPage(), 1);
  assert.equal(loadTestDraft("delivery", ID)!.date, "2026-09-16");
});

test("persist off: a failed save leaves the stored draft alone", async () => {
  stored(TODAY);
  assert.equal(await saveFromOwnPage({ status: 500 }), 1);
  assert.ok(loadTestDraft("delivery", ID) !== null);
});
