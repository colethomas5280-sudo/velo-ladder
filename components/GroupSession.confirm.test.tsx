import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { loadDraft, saveDraft } from "@/lib/draft";
import { fmtDate } from "@/lib/velo";
import { withSwr } from "./testSwr";
import GroupSession from "./GroupSession";

/* ------------------------------------------------------------------ *
 * Nothing is saved until the summary says so
 *
 * Every Save button on the group velocity screen opens a confirm first. These
 * tests hold the line that matters: the confirm sends NOTHING, backing out of
 * it changes NOTHING, and only its own button performs the save.
 * ------------------------------------------------------------------ */

const TODAY = "2026-10-16";
const PEOPLE = [
  { id: "a", name: "Jake Bell" },
  { id: "b", name: "Cooper Hale" },
  { id: "c", name: "Dana Fox" },
];

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

/** Records every POST/PATCH. A URL containing `failFor` answers 500; a `gate` holds every write until it opens. */
function mockApi(opts: { failFor?: string; gate?: Promise<void> } = {}) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if ((init?.method === "POST" || init?.method === "PATCH") && typeof init.body === "string") {
      const url = String(input);
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      if (opts.gate) await opts.gate;
      const fail = !!opts.failFor && url.includes(opts.failFor);
      return new Response(JSON.stringify(fail ? { error: "nope" } : {}), {
        status: fail ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected request ${String(input)}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

type Slots = Record<string, string[]>;
/** Stores someone's draft the way typing does. */
function put(id: string, throws: Slots, extra: { date?: string; editingId?: string | null; tracker?: "mound" | "pulldown" } = {}) {
  saveDraft(id, extra.tracker ?? "mound", {
    date: extra.date ?? TODAY,
    notes: "",
    throws,
    editingId: extra.editingId ?? null,
  });
}
const HIT = (best: string, primer = "") => ({ m5: [primer, best, "", "", ""] });

function open(ids = ["a", "b", "c"], onClose = () => {}) {
  const fixtures: Record<string, unknown> = {};
  for (const p of PEOPLE) fixtures[`/api/athletes/${p.id}/sessions`] = [];
  return render(withSwr(fixtures, <GroupSession people={PEOPLE} ids={ids} onClose={onClose} />));
}

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const confirmBox = (title: string | RegExp) => screen.queryByRole("dialog", { name: title });
/** The confirm box, whatever it is called. The pop-up itself has no accessible name here. */
const anyConfirm = () => document.querySelector<HTMLElement>(".confirm-backdrop [role=dialog]");
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const cells = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[inputmode=decimal]"));
const pressInside = async (box: HTMLElement, name: string) => {
  await act(async () => {
    fireEvent.click(within(box).getByRole("button", { name }));
    await new Promise((r) => setTimeout(r, 20));
  });
};
const D = fmtDate(TODAY);

/* ---- Save all ---- */

test("Save all opens the summary and sends nothing", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"));
    open();
    press("Save all 3");
    assert.ok(confirmBox(/^Save .* sessions?\?$/) !== null, "the summary is open");
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

test("Save all lists exactly the athletes with a 100% throw, each with date and best", () => {
  put("a", HIT("91", "99"), { date: TODAY });
  put("b", { m5: ["95", "", "", "", ""] });
  put("c", { m6: ["", "", "", "93.46", "90"], m7: ["", "88", "", "", ""] }, { date: "2026-10-10" });
  open();
  press("Save all 3");
  const box = confirmBox("Save 2 sessions?")!;
  assert.ok(box !== null, "two athletes will be saved");
  const lines = Array.from(box.querySelectorAll("li")).map((li) => li.textContent);
  assert.deepEqual(lines, [`Jake Bell · ${D} · 91 mph`, `Dana Fox · ${fmtDate("2026-10-10")} · 93.5 mph`]);
  assert.ok(within(box).queryByText(/Cooper/) === null, "a primer alone is not a session");
});

test("with one athlete to save the title is singular", () => {
  put("b", HIT("88"));
  open();
  press("Save all 3");
  assert.ok(confirmBox("Save 1 session?") !== null);
});

test("an athlete saved with no date is shown, and posted, on today", async () => {
  const api = mockApi();
  try {
    put("a", HIT("90"));
    put("b", HIT("85"), { date: "" });
    open();
    press("Save all 3");
    const box = confirmBox("Save 2 sessions?")!;
    assert.ok(within(box).queryByText(`Cooper Hale · ${D} · 85 mph`) !== null);
    await pressInside(box, "Save all");
    const b = api.calls.find((c) => c.url.includes("/b/"))!;
    assert.equal(b.body.date, TODAY);
  } finally {
    api.restore();
  }
});

test("the date typed on the screen is the date shown and the date posted", async () => {
  const api = mockApi();
  try {
    put("a", HIT("90"));
    open();
    fireEvent.change(document.querySelector<HTMLInputElement>("input[type=date]")!, { target: { value: "2026-10-12" } });
    press("Save all 3");
    const box = confirmBox("Save 1 session?")!;
    assert.ok(within(box).queryByText(`Jake Bell · ${fmtDate("2026-10-12")} · 90 mph`) !== null);
    await pressInside(box, "Save all");
    assert.equal(api.calls[0].body.date, "2026-10-12");
  } finally {
    api.restore();
  }
});

test("Keep editing sends nothing and leaves every typed number where it was", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91", "80"));
    put("b", HIT("88"));
    open();
    const before = [loadDraft("a", "mound"), loadDraft("b", "mound")];
    press("Save all 3");
    press("Keep editing");
    await settle();
    assert.equal(api.calls.length, 0);
    assert.ok(anyConfirm() === null, "the confirm is gone");
    assert.deepEqual([loadDraft("a", "mound"), loadDraft("b", "mound")], before);
    assert.deepEqual(cells().slice(0, 2).map((i) => i.value), ["80", "91"]);
    assert.ok(screen.queryByRole("alert") === null, "no error appeared");
    assert.equal((screen.getByRole("button", { name: "Save all 3" }) as HTMLButtonElement).disabled, false);
  } finally {
    api.restore();
  }
});

test("Escape and a click outside also back out without sending anything", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"));
    const onClose = mock.fn();
    open(["a", "b", "c"], onClose);
    press("Save all 3");
    fireEvent.keyDown(document, { key: "Escape" });
    assert.ok(anyConfirm() === null, "Escape closed the confirm");
    assert.ok(confirmBox("Leave this session?") === null, "and did not open the leave prompt on the same press");
    press("Save all 3");
    fireEvent.click(document.querySelector<HTMLElement>(".confirm-backdrop")!);
    assert.ok(anyConfirm() === null, "a click outside closed it");
    assert.ok(confirmBox("Leave this session?") === null);
    await settle();
    assert.equal(api.calls.length, 0);
    assert.equal(onClose.mock.callCount(), 0);
    assert.deepEqual(cells()[1].value, "91");
  } finally {
    api.restore();
  }
});

test("confirming posts the same bodies the save always posted, and only for those with a throw", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91", "80"));
    put("b", { m5: ["95", "", "", "", ""] });
    put("c", { m6: ["", "", "", "93.5", "90"] }, { date: "2026-10-10" });
    open();
    press("Save all 3");
    await pressInside(confirmBox("Save 2 sessions?")!, "Save all");
    assert.deepEqual(api.calls, [
      {
        url: "/api/athletes/a/sessions",
        method: "POST",
        body: { type: "mound", date: TODAY, notes: "", throws: { m5: [80, 91, null, null, null] } },
      },
      {
        url: "/api/athletes/c/sessions",
        method: "POST",
        body: { type: "mound", date: "2026-10-10", notes: "", throws: { m6: [null, null, null, 93.5, 90] } },
      },
    ]);
    assert.ok(anyConfirm() === null, "the confirm closes when the save is done");
    assert.ok(screen.queryByText("Saved 2 sessions") !== null);
    assert.deepEqual(loadDraft("a", "mound").throws, {}, "a saved draft is cleared");
  } finally {
    api.restore();
  }
});

test("no 100% throw anywhere: the existing message, and no confirm", async () => {
  const api = mockApi();
  try {
    put("a", { m5: ["90", "", "", "", ""] });
    open();
    press("Save all 3");
    await settle();
    assert.equal(screen.getByRole("alert").textContent, "Nothing to save. Enter at least one 100% throw for someone first.");
    assert.ok(anyConfirm() === null);
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

/* ---- one athlete ---- */

test("Save <name> only: the title, the line and the buttons", () => {
  put("a", HIT("91.04", "99"));
  put("b", HIT("88"));
  open();
  press("Save Jake only");
  const box = confirmBox("Save Jake Bell's session?")!;
  assert.ok(box !== null);
  assert.ok(within(box).queryByText(`Mound · ${D} · best 100% throw 91 mph`) !== null);
  assert.ok(within(box).queryByRole("button", { name: "Save" }) !== null);
  assert.ok(within(box).queryByRole("button", { name: "Keep editing" }) !== null);
  assert.ok(document.activeElement === within(box).getByRole("button", { name: "Keep editing" }), "the safe button has focus");
});

test("Save <name> only sends nothing until confirmed, then posts one athlete", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"));
    put("b", HIT("88"));
    open();
    press("Save Jake only");
    await settle();
    assert.equal(api.calls.length, 0);
    await pressInside(confirmBox("Save Jake Bell's session?")!, "Save");
    assert.deepEqual(api.calls.map((c) => [c.method, c.url]), [["POST", "/api/athletes/a/sessions"]]);
    assert.ok(anyConfirm() === null);
    assert.deepEqual(loadDraft("b", "mound").throws, HIT("88"), "the other athlete's numbers are untouched");
  } finally {
    api.restore();
  }
});

test("Keep editing on a single save changes nothing", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"));
    open();
    press("Save Jake only");
    press("Keep editing");
    await settle();
    assert.equal(api.calls.length, 0);
    assert.equal(cells()[1].value, "91");
    assert.ok(screen.queryByRole("alert") === null);
  } finally {
    api.restore();
  }
});

test("a pull-down session says so", () => {
  window.localStorage.setItem("veloladder:tracker", "pulldown");
  put("a", { p1: ["", "97", "", "", ""] }, { tracker: "pulldown" });
  open();
  press("Save Jake only");
  assert.ok(within(confirmBox("Save Jake Bell's session?")!).queryByText(`Pull-Down · ${D} · best 100% throw 97 mph`) !== null);
});

test("editing an existing session says Update, and confirming sends a PATCH", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"), { editingId: "s9" });
    open();
    press("Update this one");
    const box = confirmBox("Update Jake Bell's session?")!;
    assert.ok(box !== null);
    assert.ok(within(box).queryByRole("button", { name: "Save" }) === null);
    await settle();
    assert.equal(api.calls.length, 0);
    await pressInside(box, "Update");
    assert.deepEqual(api.calls.map((c) => [c.method, c.url]), [["PATCH", "/api/sessions/s9"]]);
  } finally {
    api.restore();
  }
});

test("a single save with no 100% throw shows the existing message and no confirm", async () => {
  const api = mockApi();
  try {
    put("a", { m5: ["90", "", "", "", ""] });
    open();
    press("Save Jake only");
    await settle();
    assert.equal(screen.getByRole("alert").textContent, "Enter at least one 100% throw (boxes 1-4) before saving.");
    assert.ok(anyConfirm() === null);
    await settle();
    assert.equal(api.calls.length, 0);
  } finally {
    api.restore();
  }
});

/* ---- in flight, and failure ---- */

test("while a save is in flight the confirm's buttons are disabled and a double click posts once", async () => {
  let open_!: () => void;
  const gate = new Promise<void>((r) => (open_ = r));
  const api = mockApi({ gate });
  try {
    put("a", HIT("91"));
    open();
    press("Save all 3");
    const box = confirmBox("Save 1 session?")!;
    const save = within(box).getByRole("button", { name: "Save all" });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(api.calls.length, 1, "one request, however many clicks");
    assert.equal((within(box).getByRole("button", { name: "Save all" }) as HTMLButtonElement).disabled, true);
    assert.equal((within(box).getByRole("button", { name: "Keep editing" }) as HTMLButtonElement).disabled, true);
    fireEvent.keyDown(document, { key: "Escape" });
    assert.ok(anyConfirm() !== null, "Escape cannot dismiss a save in flight");
    await act(async () => {
      open_();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(api.calls.length, 1);
    assert.ok(anyConfirm() === null, "and it closes once the save is done");
  } finally {
    api.restore();
  }
});

test("a failed save closes the confirm, shows the error in the pop-up and keeps the numbers", async () => {
  const api = mockApi({ failFor: "/a/" });
  mock.method(console, "error", () => {});
  try {
    put("a", HIT("91", "80"));
    open();
    press("Save Jake only");
    await pressInside(confirmBox("Save Jake Bell's session?")!, "Save");
    assert.ok(anyConfirm() === null);
    assert.equal(screen.getByRole("alert").textContent, "Couldn't save (500): nope");
    assert.deepEqual(cells().slice(0, 2).map((i) => i.value), ["80", "91"]);
    assert.deepEqual(loadDraft("a", "mound").throws, { m5: ["80", "91", "", "", ""] });
    assert.equal((screen.getByRole("button", { name: "Save all 3" }) as HTMLButtonElement).disabled, false);
  } finally {
    api.restore();
  }
});

test("a failed Save all behaves the same", async () => {
  const api = mockApi({ failFor: "/a/" });
  mock.method(console, "error", () => {});
  try {
    put("a", HIT("91"));
    open();
    press("Save all 3");
    await pressInside(confirmBox("Save 1 session?")!, "Save all");
    assert.ok(anyConfirm() === null);
    assert.equal(screen.getByRole("alert").textContent, "Couldn't save (500): nope");
    assert.equal(cells()[1].value, "91");
  } finally {
    api.restore();
  }
});

/* ---- the leave prompt, through the real wiring ---- */

test("the X asks first, and Leave reaches the caller's onClose", () => {
  const onClose = mock.fn();
  open(["a", "b", "c"], onClose);
  press("Close");
  assert.equal(onClose.mock.callCount(), 0);
  press("Leave");
  assert.equal(onClose.mock.callCount(), 1);
});

test("for the athlete on screen the summary reads the draft on screen, which is also what gets posted", async () => {
  const api = mockApi();
  try {
    put("a", HIT("91"), { date: "2026-10-12" });
    open();
    // Storage drifts behind the screen's back. Save writes the on-screen draft over it before posting.
    put("a", HIT("50"), { date: "2026-09-01" });
    press("Save all 3");
    const box = confirmBox("Save 1 session?")!;
    assert.ok(within(box).queryByText(`Jake Bell · ${fmtDate("2026-10-12")} · 91 mph`) !== null);
    await pressInside(box, "Save all");
    assert.equal(api.calls[0].body.date, "2026-10-12");
    assert.deepEqual(api.calls[0].body.throws, { m5: [null, 91, null, null, null] });
  } finally {
    api.restore();
  }
});

test("a single save also reads the draft on screen, not whatever storage holds", () => {
  put("a", HIT("91"), { date: "2026-10-12" });
  open();
  put("a", HIT("50"), { date: "2026-09-01" });
  press("Save Jake only");
  assert.ok(
    within(confirmBox("Save Jake Bell's session?")!).queryByText(`Mound · ${fmtDate("2026-10-12")} · best 100% throw 91 mph`) !== null,
  );
});
