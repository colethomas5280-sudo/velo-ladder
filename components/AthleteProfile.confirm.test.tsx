import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import type { Athlete } from "@/lib/types";
import { loadDraft, saveDraft } from "@/lib/draft";
import { fmtDate } from "@/lib/velo";
import { withSwr } from "./testSwr";
import AthleteProfile from "./AthleteProfile";

/* ------------------------------------------------------------------ *
 * The single-athlete Save on the athlete's own page
 *
 * AthleteProfile has no other test; it reads a lot of keys, so every one of
 * them is handed over here. The point is narrow: Save opens a summary and
 * sends nothing, backing out changes nothing, and the confirm does the save.
 * ------------------------------------------------------------------ */

const TODAY = "2026-10-16";
const D = fmtDate(TODAY);

const ATHLETE = {
  id: "a1",
  name: "Jake Bell",
  hand: "R",
  inviteEmail: null,
  hasPassword: true,
  hasInvite: false,
  birthDate: null,
} as unknown as Athlete;

const FIXTURES: Record<string, unknown> = {
  "/api/me": { role: "coach", athleteId: null },
  "/api/athletes/a1": ATHLETE,
  "/api/athletes/a1/sessions": [],
  "/api/athletes/a1/recovery": [],
  "/api/athletes/a1/status": null,
};

/*
 * jsdom has no ResizeObserver or matchMedia, and the progress chart on this
 * page (not what is under test) measures itself with both. Inert stubs.
 */
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia ??= (() => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  cleanup();
  mock.restoreAll();
  mock.timers.reset();
});

type Call = { url: string; method: string; body: Record<string, unknown> };
function mockApi(opts: { failFor?: string; gate?: Promise<void>; status?: number } = {}) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if ((init?.method === "POST" || init?.method === "PATCH") && typeof init.body === "string") {
      const url = String(input);
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      if (opts.gate) await opts.gate;
      const status = opts.status ?? 200;
      return new Response(JSON.stringify(status === 200 ? {} : { error: "nope" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected request ${String(input)}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const HIT = (best: string, primer = "") => ({ m5: [primer, best, "", "", ""] });
function put(throws: Record<string, string[]>, extra: { date?: string; editingId?: string | null } = {}) {
  saveDraft("a1", "mound", {
    date: extra.date ?? TODAY,
    notes: "",
    throws,
    editingId: extra.editingId ?? null,
  });
}

/** Opens the entry step on Mound, the way a coach gets there. */
function openEntry() {
  render(withSwr(FIXTURES, <AthleteProfile athleteId="a1" />));
  fireEvent.click(screen.getByRole("button", { name: /Track a new session/ }));
  const pick = screen.getByRole("dialog", { name: "Track a new session for Jake Bell" });
  fireEvent.click(within(pick).getByRole("button", { name: /Mound/ }));
}

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const anyConfirm = () => document.querySelector<HTMLElement>(".confirm-backdrop [role=dialog]");
const confirmBox = (title: string) => screen.queryByRole("dialog", { name: title });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const cells = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[inputmode=decimal]"));
const pressInside = async (box: HTMLElement, name: string) => {
  await act(async () => {
    fireEvent.click(within(box).getByRole("button", { name }));
    await new Promise((r) => setTimeout(r, 30));
  });
};

test("Save session opens the summary, names the athlete, and sends nothing", async () => {
  const api = mockApi();
  try {
    put(HIT("91.04", "99"));
    openEntry();
    press("Save session");
    const box = confirmBox("Save Jake Bell's session?")!;
    assert.ok(box !== null);
    assert.ok(within(box).queryByText(`Mound · ${D} · best 100% throw 91 mph`) !== null);
    assert.ok(document.activeElement === within(box).getByRole("button", { name: "Keep editing" }));
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

test("Keep editing sends nothing and leaves the numbers, the draft and the pop-up as they were", async () => {
  const api = mockApi();
  try {
    put(HIT("91", "80"));
    openEntry();
    const before = loadDraft("a1", "mound");
    press("Save session");
    press("Keep editing");
    await settle();
    assert.equal(api.calls.length, 0);
    assert.ok(anyConfirm() === null);
    assert.deepEqual(loadDraft("a1", "mound"), before);
    assert.deepEqual(cells().slice(0, 2).map((i) => i.value), ["80", "91"]);
    assert.ok(screen.queryByRole("alert") === null);
    assert.ok(screen.queryByRole("dialog", { name: "Track a new session for Jake Bell" }) !== null, "the pop-up is still open");
    assert.equal((screen.getByRole("button", { name: "Save session" }) as HTMLButtonElement).disabled, false);
  } finally {
    api.restore();
  }
});

test("Escape on the summary dismisses only the summary", async () => {
  const api = mockApi();
  try {
    put(HIT("91"));
    openEntry();
    press("Save session");
    fireEvent.keyDown(document, { key: "Escape" });
    assert.ok(anyConfirm() === null);
    assert.ok(confirmBox("Leave this session?") === null);
    assert.ok(screen.queryByRole("dialog", { name: "Track a new session for Jake Bell" }) !== null);
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

test("confirming posts the session, as before", async () => {
  const api = mockApi();
  try {
    put(HIT("91", "80"));
    openEntry();
    press("Save session");
    await pressInside(confirmBox("Save Jake Bell's session?")!, "Save");
    assert.deepEqual(api.calls, [
      {
        url: "/api/athletes/a1/sessions",
        method: "POST",
        body: { type: "mound", date: TODAY, notes: "", throws: { m5: [80, 91, null, null, null] } },
      },
    ]);
    assert.ok(anyConfirm() === null);
    assert.ok(screen.queryByRole("dialog", { name: "Track a new session for Jake Bell" }) === null, "a good save closes the pop-up");
    assert.ok(screen.queryByText("Session saved") !== null);
    assert.deepEqual(loadDraft("a1", "mound").throws, {});
  } finally {
    api.restore();
  }
});

test("editing an existing session says Update, and confirming sends a PATCH", async () => {
  const api = mockApi();
  try {
    put(HIT("91"), { editingId: "s9", date: "2026-10-01" });
    openEntry();
    press("Update session");
    const box = confirmBox("Update Jake Bell's session?")!;
    assert.ok(box !== null);
    assert.ok(within(box).queryByText(`Mound · ${fmtDate("2026-10-01")} · best 100% throw 91 mph`) !== null);
    await settle();
    assert.equal(api.calls.length, 0);
    await pressInside(box, "Update");
    assert.deepEqual(api.calls.map((c) => [c.method, c.url]), [["PATCH", "/api/sessions/s9"]]);
    assert.ok(screen.queryByText("Session updated") !== null);
  } finally {
    api.restore();
  }
});

test("no 100% throw: the existing message, and no summary", async () => {
  const api = mockApi();
  try {
    put({ m5: ["90", "", "", "", ""] });
    openEntry();
    press("Save session");
    assert.equal(
      screen.getByRole("alert").textContent,
      "Enter at least one 100% throw (boxes 1-4) before saving. The 80% primer isn't scored.",
    );
    assert.ok(anyConfirm() === null);
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

test("while the save is in flight the summary's buttons are disabled and a double click posts once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const api = mockApi({ gate });
  try {
    put(HIT("91"));
    openEntry();
    press("Save session");
    const box = confirmBox("Save Jake Bell's session?")!;
    const save = within(box).getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.equal(api.calls.length, 1);
    assert.equal((within(box).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled, true);
    assert.equal((within(box).getByRole("button", { name: "Keep editing" }) as HTMLButtonElement).disabled, true);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.equal(api.calls.length, 1);
  } finally {
    api.restore();
  }
});

test("a failed save closes the summary, shows the error in the pop-up and keeps the numbers", async () => {
  const api = mockApi({ status: 500 });
  mock.method(console, "error", () => {});
  try {
    put(HIT("91", "80"));
    openEntry();
    press("Save session");
    await pressInside(confirmBox("Save Jake Bell's session?")!, "Save");
    assert.ok(anyConfirm() === null);
    assert.equal(screen.getByRole("alert").textContent, "Couldn't save (500): nope");
    assert.deepEqual(cells().slice(0, 2).map((i) => i.value), ["80", "91"]);
    assert.deepEqual(loadDraft("a1", "mound").throws, { m5: ["80", "91", "", "", ""] });
    assert.ok(screen.queryByRole("dialog", { name: "Track a new session for Jake Bell" }) !== null);
  } finally {
    api.restore();
  }
});

test("the X still asks before leaving, through the real page", () => {
  put(HIT("91"));
  openEntry();
  press("Close");
  assert.ok(confirmBox("Leave this session?") !== null);
  press("Leave");
  assert.ok(screen.queryByRole("dialog", { name: "Track a new session for Jake Bell" }) === null);
});

test("the summary reads the draft on screen, not whatever storage holds", () => {
  put(HIT("91"), { date: "2026-10-12" });
  openEntry();
  put(HIT("50"), { date: "2026-09-01" });
  press("Save session");
  assert.ok(
    within(confirmBox("Save Jake Bell's session?")!).queryByText(`Mound · ${fmtDate("2026-10-12")} · best 100% throw 91 mph`) !== null,
  );
});
