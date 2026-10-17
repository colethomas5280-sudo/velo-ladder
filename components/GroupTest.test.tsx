import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { SCREEN_TESTS, fillNormal } from "@/lib/screen";
import { BIG_12 } from "@/lib/big12";
import type { DeliveryScreen, MovementScreen } from "@/lib/types";
import { loadTestDraft, saveTestDraft } from "@/lib/testDraft";
import { withSwr } from "./testSwr";
import GroupTest from "./GroupTest";

const TODAY = "2026-10-16";
const PEOPLE = [
  { id: "a", name: "Alex Adams" },
  { id: "b", name: "Blake Brown" },
  { id: "c", name: "Casey Cole" },
];
const FLAW = BIG_12[0].key;

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
});

type Opts = {
  type?: "screen" | "delivery";
  ids?: string[];
  screens?: Record<string, MovementScreen[]>;
  delivery?: Record<string, DeliveryScreen[]>;
  onClose?: () => void;
  onSaved?: () => void;
};

/** Every athlete gets all three keys, so a missing fixture is never the reason a test fails. */
function group({
  type = "screen",
  ids = ["a", "b"],
  screens = {},
  delivery = {},
  onClose = () => {},
  onSaved,
}: Opts = {}) {
  const fixtures: Record<string, unknown> = {};
  for (const p of PEOPLE) {
    fixtures[`/api/athletes/${p.id}/screens`] = screens[p.id] ?? [];
    fixtures[`/api/athletes/${p.id}/delivery`] = delivery[p.id] ?? [];
    fixtures[`/api/athletes/${p.id}/sessions`] = [];
  }
  return render(
    withSwr(
      fixtures,
      <GroupTest type={type} people={PEOPLE} ids={ids} onClose={onClose} onSaved={onSaved} />,
    ),
  );
}

/**
 * Stubs fetch for POSTs and records { url, body }. A POST whose URL contains
 * `failFor` answers 500. With a `gate`, every POST waits for it. Restore in finally.
 */
function mockApi(failFor?: string, gate?: Promise<void>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const gets: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST" && typeof init.body === "string") {
      const url = String(input);
      calls.push({ url, body: JSON.parse(init.body) });
      if (gate) await gate;
      const fail = !!failFor && url.includes(failFor);
      return new Response(JSON.stringify(fail ? { error: "nope" } : {}), {
        status: fail ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    gets.push(String(input));
    return real(input as string, init);
  }) as typeof fetch;
  return { calls, gets, restore: () => (globalThis.fetch = real) };
}

/** One athlete's wrapper. It carries `hidden` while inactive, so queries inside need { hidden: true }. */
const panel = (id: string) => document.querySelector<HTMLElement>(`[data-athlete="${id}"]`)!;
const inPanel = (id: string) => within(panel(id));
const tabs = () => Array.from(document.querySelectorAll<HTMLElement>(".atab"));
const tab = (first: string) => tabs().find((t) => t.textContent!.startsWith(first))!;
const tabText = (first: string) => tab(first).textContent!;
const progress = (id: string) => panel(id).querySelector(".ms-progress b")!.textContent!;
const saveAllButton = () => document.querySelector<HTMLButtonElement>(".group-test-foot button")!;

/** Lets pending promises and effects land, inside act so React stays quiet. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

const markRestNormal = (id: string) =>
  fireEvent.click(
    inPanel(id).getByRole("button", { name: /mark \d+ remaining tests? normal/i, hidden: true }),
  );
const ownSave = (id: string, label = "Save screen") =>
  inPanel(id).getByRole("button", { name: label, hidden: true });
const tick = (id: string, key = FLAW) =>
  fireEvent.click(panel(id).querySelector(`input[name="flaw:${key}"]`)!);

test("tabs show the picked athletes' first names in the order given, and only the active form is visible", async () => {
  group();
  assert.deepEqual(tabs().map((t) => t.textContent), ["Alex", "Blake"]);
  assert.ok(tab("Alex").classList.contains("on"));
  assert.ok(tab("Blake").classList.contains("on") === false);
  assert.equal(panel("a").hidden, false);
  assert.ok(panel("b") === null, "an unvisited athlete without a draft is not mounted");

  await click(tab("Blake"));
  assert.ok(tab("Blake").classList.contains("on"));
  assert.equal(panel("a").hidden, true);
  assert.equal(panel("b").hidden, false);
  assert.ok(panel("a") !== null, "A stays mounted while hidden");
});

test("tabs follow the order of ids and leave out people who were not picked", () => {
  group({ ids: ["b", "a"] });
  assert.deepEqual(tabs().map((t) => t.textContent), ["Blake", "Alex"]);
  assert.ok(tab("Blake").classList.contains("on"), "the first picked athlete is active");
  assert.ok(tabs().every((t) => !t.textContent!.startsWith("Casey")));
});

test("flipping between athletes keeps each one's answers", async () => {
  group();
  markRestNormal("a");
  const before = progress("a");
  assert.ok(!before.startsWith("0 of "), `setup: A has answers (${before})`);

  await click(tab("Blake"));
  assert.ok(progress("b").startsWith("0 of "), "B starts blank, A's answers did not leak");
  markRestNormal("b");
  assert.ok(!progress("b").startsWith("0 of "));

  await click(tab("Alex"));
  assert.equal(progress("a"), before, "A's answers survived the trip to B");
  assert.equal(panel("a").hidden, false);
  assert.equal(panel("b").hidden, true);
  assert.ok(!progress("b").startsWith("0 of "), "B kept its own answers too");
});

test("a dot appears once answers exist and is replaced by a tick after that athlete's own Save", async () => {
  const api = mockApi();
  try {
    group();
    assert.equal(tabText("Alex"), "Alex");
    markRestNormal("a");
    await waitFor(() => assert.equal(tabText("Alex"), "Alex ●"));
    assert.equal(tabText("Blake"), "Blake");

    await click(ownSave("a"));
    await waitFor(() => assert.equal(tabText("Alex"), "Alex ✓"));
    assert.ok(!tabText("Alex").includes("●"));
  } finally {
    api.restore();
  }
});

test("a saved athlete who answers again goes back to a dot", async () => {
  const api = mockApi();
  try {
    group();
    markRestNormal("a");
    await click(ownSave("a"));
    await waitFor(() => assert.equal(tabText("Alex"), "Alex ✓"));
    fireEvent.change(panel("a").querySelector<HTMLTextAreaElement>("textarea")!, {
      target: { value: "stiff again" },
    });
    await waitFor(() => assert.equal(tabText("Alex"), "Alex ●"));
  } finally {
    api.restore();
  }
});

test("an athlete's own Save posts only their body to their own screens route", async () => {
  const api = mockApi();
  try {
    group();
    markRestNormal("a");
    await click(tab("Blake"));
    markRestNormal("b");
    await click(tab("Alex"));
    await click(ownSave("a"));
    await settle();
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url, "/api/athletes/a/screens");
    assert.equal(api.calls[0].body.date, TODAY);
    assert.deepEqual(api.calls[0].body.results, fillNormal({}));
    assert.ok(api.calls.every((c) => !c.url.includes("/b/")), "B was not posted");
  } finally {
    api.restore();
  }
});

test("Save all posts for each athlete with answers, none for one without, and counts them", async () => {
  const api = mockApi();
  try {
    group({ ids: ["a", "b", "c"] });
    assert.equal(saveAllButton().textContent, "Save all (0)");
    assert.equal(saveAllButton().disabled, true);

    markRestNormal("a");
    await click(tab("Blake"));
    markRestNormal("b");
    await click(tab("Casey")); // visited, never answered
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (2)"));
    assert.equal(saveAllButton().disabled, false);

    await click(saveAllButton());
    await waitFor(() => assert.equal(api.calls.length, 2));
    await settle();
    assert.deepEqual(api.calls.map((c) => c.url).sort(), [
      "/api/athletes/a/screens",
      "/api/athletes/b/screens",
    ]);
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (0)"));
    assert.equal(saveAllButton().disabled, true);
    assert.ok(screen.queryByText("Saved 2 screens") !== null, "summary toast");
    assert.equal(tabText("Alex"), "Alex ✓");
    assert.equal(tabText("Blake"), "Blake ✓");
    assert.equal(tabText("Casey"), "Casey");
  } finally {
    api.restore();
  }
});

test("Save all is disabled and reads Saving while it runs, so it cannot be pressed twice", async () => {
  let release!: () => void;
  const api = mockApi(undefined, new Promise<void>((r) => (release = r)));
  try {
    group();
    markRestNormal("a");
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (1)"));
    await click(saveAllButton());
    await waitFor(() => assert.equal(saveAllButton().textContent, "Saving…"));
    assert.equal(saveAllButton().disabled, true);
    await click(saveAllButton());
    assert.equal(api.calls.length, 1, "a second press did not post again");

    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (0)"));
    assert.equal(api.calls.length, 1);
  } finally {
    api.restore();
  }
});

test("a failing save does not stop Save all: the other saves, the failing athlete keeps its dot, alert and draft", async () => {
  const api = mockApi("/athletes/a/");
  try {
    group();
    markRestNormal("a");
    await click(tab("Blake"));
    markRestNormal("b");
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (2)"));

    await click(saveAllButton());
    await waitFor(() => assert.equal(api.calls.length, 2), { timeout: 2000 });
    await settle();
    assert.deepEqual(api.calls.map((c) => c.url), [
      "/api/athletes/a/screens",
      "/api/athletes/b/screens",
    ]);
    assert.equal(tabText("Alex"), "Alex ●");
    assert.equal(tabText("Blake"), "Blake ✓");
    assert.ok(inPanel("a").queryByRole("alert", { hidden: true }) !== null, "A shows its error");
    assert.ok(inPanel("b").queryByRole("alert", { hidden: true }) === null);
    assert.ok(loadTestDraft("screen", "a") !== null, "A's answers survive");
    assert.ok(loadTestDraft("screen", "b") === null);
    assert.ok(screen.queryByText("Saved 1, 1 failed") !== null, "summary toast");
    assert.equal(saveAllButton().textContent, "Save all (1)");
  } finally {
    api.restore();
  }
});

test("a draft saved before a reload shows its dot at once, restores the answers and counts in Save all", async () => {
  const results = fillNormal({}, [SCREEN_TESTS[0]]);
  saveTestDraft("screen", "b", { date: TODAY, notes: "stiff left hip", data: results });
  group();
  // Never visited: only A is on screen.
  assert.ok(tab("Blake").classList.contains("on") === false);
  await waitFor(() => assert.equal(tabText("Blake"), "Blake ●"));
  assert.equal(tabText("Alex"), "Alex");
  await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (1)"));
  assert.equal(panel("b").hidden, true);

  await click(tab("Blake"));
  assert.ok(progress("b").startsWith(`${Object.keys(results).length} of `), progress("b"));
  assert.equal(panel("b").querySelector<HTMLTextAreaElement>("textarea")!.value, "stiff left hip");
  assert.ok(loadTestDraft("screen", "b") !== null, "mounting did not clobber the draft");
});

test("Save all reaches an athlete restored from a draft who was never visited", async () => {
  const api = mockApi();
  try {
    saveTestDraft("screen", "b", {
      date: TODAY,
      notes: "",
      data: fillNormal({}, [SCREEN_TESTS[0]]),
    });
    group();
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (1)"));
    await click(saveAllButton());
    await waitFor(() => assert.equal(api.calls.length, 1));
    assert.equal(api.calls[0].url, "/api/athletes/b/screens");
  } finally {
    api.restore();
  }
});

test("a draft dated on another day opens a new entry on that day", async () => {
  saveTestDraft("screen", "b", {
    date: "2026-09-16",
    notes: "",
    data: fillNormal({}, [SCREEN_TESTS[0]]),
  });
  group();
  await click(tab("Blake"));
  const date = panel("b").querySelector<HTMLInputElement>('input[type="date"]')!;
  assert.equal(date.value, "2026-09-16");
  assert.equal(date.disabled, false);
  assert.ok(inPanel("b").queryByRole("button", { name: "Save screen" }) !== null);
});

test("a draft dated on a day that already holds a record edits that record", async () => {
  const results = fillNormal({}, [SCREEN_TESTS[0]]);
  const old = { id: "s1", athleteId: "b", date: "2026-09-16", results, notes: "" } as unknown as MovementScreen;
  saveTestDraft("screen", "b", {
    date: "2026-09-16",
    notes: "added a note",
    data: results,
  });
  group({ screens: { b: [old] } });
  await click(tab("Blake"));
  const date = panel("b").querySelector<HTMLInputElement>('input[type="date"]')!;
  assert.equal(date.value, "2026-09-16");
  assert.equal(date.disabled, true, "the date identifies the record being edited");
  assert.ok(inPanel("b").queryByRole("button", { name: "Update screen" }) !== null);
  assert.equal(tabText("Blake"), "Blake ●", "the added note is unsaved");
});

test("a draft is removed once its athlete saves", async () => {
  const api = mockApi();
  try {
    group();
    markRestNormal("a");
    await waitFor(() => assert.ok(loadTestDraft("screen", "a") !== null, "draft written"));
    await click(ownSave("a"));
    await waitFor(() => assert.equal(loadTestDraft("screen", "a"), null));
  } finally {
    api.restore();
  }
});

test("an athlete with a record from today opens on it, clean", async () => {
  const results = fillNormal({}, [SCREEN_TESTS[0]]);
  const rec = { id: "s1", athleteId: "a", date: TODAY, results, notes: "kept" } as unknown as MovementScreen;
  group({ screens: { a: [rec] } });
  assert.ok(progress("a").startsWith(`${Object.keys(results).length} of `), progress("a"));
  assert.ok(inPanel("a").queryByRole("button", { name: "Update screen" }) !== null);
  assert.equal(panel("a").querySelector<HTMLTextAreaElement>("textarea")!.value, "kept");
  await settle();
  assert.equal(tabText("Alex"), "Alex");
  assert.equal(saveAllButton().textContent, "Save all (0)");
  assert.equal(saveAllButton().disabled, true);
});

test("Pitching Inhibitors: Save all takes ticked athletes only, a clean assessment is saved by its own button", async () => {
  const api = mockApi();
  try {
    group({ type: "delivery" });
    assert.ok(screen.queryByText("Pitching Inhibitors") !== null);
    tick("a");
    await click(tab("Blake")); // B stays clean
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (1)"));
    await click(saveAllButton());
    await waitFor(() => assert.equal(api.calls.length, 1));
    await settle();
    assert.equal(api.calls[0].url, "/api/athletes/a/delivery");
    assert.deepEqual(api.calls[0].body.flaws, { [FLAW]: true });
    assert.ok(screen.queryByText("Saved 1 assessment") !== null, "summary toast names assessments");

    await click(ownSave("b", "Save assessment"));
    await waitFor(() => assert.equal(api.calls.length, 2));
    assert.equal(api.calls[1].url, "/api/athletes/b/delivery");
    assert.deepEqual(api.calls[1].body.flaws, {});
  } finally {
    api.restore();
  }
});

test("onSaved fires once per successful save and not for a failed one", async () => {
  const api = mockApi("/athletes/a/");
  try {
    let saved = 0;
    group({ onSaved: () => (saved += 1) });
    markRestNormal("a");
    await click(tab("Blake"));
    markRestNormal("b");
    await waitFor(() => assert.equal(saveAllButton().textContent, "Save all (2)"));
    await click(saveAllButton());
    await waitFor(() => assert.equal(api.calls.length, 2), { timeout: 2000 });
    await settle();
    await waitFor(() => assert.equal(saved, 1));
    await settle();
    assert.equal(saved, 1, "A failed, B succeeded");
  } finally {
    api.restore();
  }
});

test("a successful save refreshes that athlete's own records and no one else's", async () => {
  const api = mockApi();
  try {
    group();
    markRestNormal("a");
    await click(ownSave("a"));
    await waitFor(() => assert.ok(api.gets.includes("/api/athletes/a/screens"), `gets: ${api.gets}`));
    assert.ok(!api.gets.includes("/api/athletes/b/screens"));
  } finally {
    api.restore();
  }
});

test("a refresh that fails does not undo a save that worked", async () => {
  const api = mockApi();
  try {
    let saved = 0;
    group({ onSaved: () => (saved += 1) });
    markRestNormal("a");
    await click(ownSave("a"));
    // The refresh GET goes to the real fetch, which rejects on a relative URL.
    await waitFor(() => assert.equal(saved, 1));
    assert.equal(tabText("Alex"), "Alex ✓");
  } finally {
    api.restore();
  }
});

test("Escape, the close button and the backdrop call onClose, and none of them deletes a draft", async () => {
  let closed = 0;
  group({ onClose: () => (closed += 1) });
  markRestNormal("a");
  await waitFor(() => assert.ok(loadTestDraft("screen", "a") !== null));

  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closed, 1);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  assert.equal(closed, 2);
  fireEvent.click(document.querySelector(".modal-backdrop")!);
  assert.equal(closed, 3);
  fireEvent.click(screen.getByRole("dialog"));
  assert.equal(closed, 3, "a click inside the panel does not close it");
  assert.ok(loadTestDraft("screen", "a") !== null, "closing keeps the draft");
});
