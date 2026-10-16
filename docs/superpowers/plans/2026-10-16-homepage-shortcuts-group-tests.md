# Homepage shortcuts and group tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put "Track a new session" and "Track a new test" on the coach's homepage, and let a coach record the same movement screen or Pitching Inhibitors assessment for several athletes at once, with unsaved answers surviving a reload.

**Architecture:** Each single-athlete test modal is split into a reusable form plus a thin modal frame (athlete pages unchanged). A new `GroupTest` shell mounts one form per picked athlete under tabs and keeps visited forms mounted so nothing is lost when switching. A small `lib/testDraft.ts` persists unsaved answers per athlete and test type. A shared `AthletePicker` feeds both the existing velocity `GroupSession` and the new `GroupTest`. No API or schema change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SWR, React Testing Library with jsdom, Node's test runner via tsx.

**Spec:** `docs/superpowers/specs/2026-10-16-homepage-shortcuts-group-tests-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing any Next.js code** (`AGENTS.md`). This plan is client components and one existing server page; no new routes.
- **`npm run verify` is the gate** (lint, `tsc --noEmit`, `next build`, tests, in that order). Before it, `rm -rf .next/static .next/server`. Chain with `&&`, never `;`.
- **Mutation-test every new assertion.** Back the file up with `cp`, break it, confirm the NAMED test fails, restore with `cp`. NEVER restore with `git checkout <file>` on a file with uncommitted work.
- **The single-athlete flows must not change behaviour.** `components/ScreenModal.test.tsx` (9 tests) and `components/DeliveryModal.test.tsx` (10 tests) must pass WITHOUT edits after the refactor. Public props of `ScreenModal` and `DeliveryModal` stay exactly as they are today.
- **No API, route or schema change.** Saves use the existing `POST /api/athletes/[id]/screens` and `POST /api/athletes/[id]/delivery`. Coach-only routes stay coach-only.
- **Do not touch `lib/scope.ts` `canSeeAthlete` or `lib/auth.ts`.**
- **Unsaved answers rule (Cole's decision, same as velocity drafts):** an entry with no answers starts on today; one with answers keeps the date it was started under. A draft exists only while it has answers (notes alone never create one).
- **"Has answers":** a movement screen with any reading in `results`; a Pitching Inhibitors assessment with any flaw marked. Save all covers exactly those athletes. A clean assessment (nothing marked) is saved with that athlete's own Save button, never by Save all.
- **No em dashes or en dashes in any user-facing copy.**
- **Test traps already hit in this repo:** (1) a failing `assert.equal(domElement, null)` diffs all of jsdom and takes ~27 seconds, so assert booleans (`queryBy...() === null`); (2) `waitFor` only retries when its callback THROWS, so put an `assert` inside it; (3) component tests get data through `withSwr(fixtures, element)` from `components/testSwr.tsx` (a key with no fixture throws loudly), and stub `fetch` for POSTs; (4) PGlite is irrelevant here: these are client component tests, never open `./.pglite-data`; (5) zsh: quote globs and paths with brackets, do not `echo =====`; (6) pin the clock with `mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") })` when a test depends on "today", and `mock.timers.reset()` in `afterEach`.
- **Commits end with:** `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `lib/testDraft.ts` (create) | Per-athlete, per-test-type unsaved answers in localStorage. |
| `components/ScreenForm.tsx` (create, by moving `ScreenModal.tsx`) | The movement screen form with group-mode props. |
| `components/ScreenModal.tsx` (rewrite) | Thin modal frame around `ScreenForm`; same public props as today. |
| `components/DeliveryForm.tsx` (create, by moving `DeliveryModal.tsx`) | The Pitching Inhibitors form with group-mode props. |
| `components/DeliveryModal.tsx` (rewrite) | Thin modal frame around `DeliveryForm`; same public props as today. |
| `components/AthletePicker.tsx` (create) | Modal list of athletes: search, checkboxes, select all, clear, count, Start. |
| `components/GroupTest.tsx` (create) | The group test screen: tabs, per-athlete panels, Save all. |
| `components/QuickStart.tsx` (create) | The two homepage buttons and the flows behind them. |
| `components/RecordChooser.tsx` (modify) | Optional `title` prop so it can be reused. |
| `components/Dashboard.tsx` (modify) | Renders `QuickStart` at the top. |
| `app/globals.css` (modify) | Styles for the quick-start buttons and the picker list. |
| `HANDOFF.md` (modify) | Document the feature. |

---

### Task 1: Test drafts

**Files:**
- Create: `lib/testDraft.ts`
- Test: `lib/testDraft.test.ts`

**Interfaces:**
- Consumes: `todayISO()` from `@/lib/velo`.
- Produces:
  - `type TestType = "screen" | "delivery"`
  - `interface TestDraft { date: string; notes: string; data: Record<string, string | boolean> }` (`data` is `results` for a screen, `flaws` for a delivery)
  - `loadTestDraft(type: TestType, athleteId: string): TestDraft | null`
  - `saveTestDraft(type: TestType, athleteId: string, draft: TestDraft): void`
  - `clearTestDraft(type: TestType, athleteId: string): void`
  - `hasTestDraft(type: TestType, athleteId: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `lib/testDraft.test.ts`:

```ts
import "../components/testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  loadTestDraft,
  saveTestDraft,
  clearTestDraft,
  hasTestDraft,
  type TestDraft,
} from "@/lib/testDraft";

/* ------------------------------------------------------------------ *
 * Unsaved test answers, kept in the browser per athlete and test type so a
 * reload or a locked phone mid-test loses nothing. A draft exists only while
 * it has answers, so there is never an "empty leftover" to date a later test
 * wrongly (the velocity drafts had exactly that bug). The clock is pinned so
 * "today" is a known day.
 * ------------------------------------------------------------------ */

const TODAY = "2026-10-16";
const OLD = "2026-09-16";

beforeEach(() => {
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
});

const draft = (over: Partial<TestDraft> = {}): TestDraft => ({
  date: OLD,
  notes: "left side guarded",
  data: { "hip:L": "greater" },
  ...over,
});

test("a draft with answers round-trips, date and notes included", () => {
  saveTestDraft("screen", "a1", draft());
  assert.deepEqual(loadTestDraft("screen", "a1"), draft());
  assert.equal(hasTestDraft("screen", "a1"), true);
});

test("nothing saved means no draft", () => {
  assert.equal(loadTestDraft("screen", "a1"), null);
  assert.equal(hasTestDraft("screen", "a1"), false);
});

test("a draft with no answers is no draft, whatever else it holds", () => {
  saveTestDraft("screen", "a1", draft({ data: {} }));
  assert.equal(loadTestDraft("screen", "a1"), null, "notes alone never create a draft");
  assert.equal(hasTestDraft("screen", "a1"), false);
});

test("a draft with answers keeps the date it was started under", () => {
  saveTestDraft("screen", "a1", draft({ date: OLD }));
  assert.equal(loadTestDraft("screen", "a1")!.date, OLD);
});

test("a stored draft missing its date falls back to today", () => {
  window.localStorage.setItem(
    "veloladder:testdraft:screen:a1",
    JSON.stringify({ notes: "", data: { x: "normal" } }),
  );
  assert.equal(loadTestDraft("screen", "a1")!.date, TODAY);
});

test("a corrupt stored draft is no draft", () => {
  window.localStorage.setItem("veloladder:testdraft:screen:a1", "{not json");
  assert.equal(loadTestDraft("screen", "a1"), null);
  window.localStorage.setItem("veloladder:testdraft:screen:a1", "null");
  assert.equal(loadTestDraft("screen", "a1"), null);
});

test("each athlete and each test type has its own draft", () => {
  saveTestDraft("screen", "a1", draft({ data: { one: "normal" } }));
  saveTestDraft("screen", "a2", draft({ data: { two: "normal" } }));
  saveTestDraft("delivery", "a1", draft({ data: { sway: true } }));
  assert.deepEqual(loadTestDraft("screen", "a1")!.data, { one: "normal" });
  assert.deepEqual(loadTestDraft("screen", "a2")!.data, { two: "normal" });
  assert.deepEqual(loadTestDraft("delivery", "a1")!.data, { sway: true });
});

test("clearing removes only that athlete's draft for that test type", () => {
  saveTestDraft("screen", "a1", draft());
  saveTestDraft("delivery", "a1", draft({ data: { sway: true } }));
  clearTestDraft("screen", "a1");
  assert.equal(hasTestDraft("screen", "a1"), false);
  assert.equal(hasTestDraft("delivery", "a1"), true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks lib/testDraft.test.ts 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find"`
Expected: FAIL, `Cannot find module '@/lib/testDraft'`.

- [ ] **Step 3: Implement**

Create `lib/testDraft.ts`:

```ts
import { todayISO } from "@/lib/velo";

/*
 * Unsaved test answers, per athlete and per test type, mirrored to
 * localStorage so a reload or a locked phone mid-test loses nothing.
 *
 * A draft exists ONLY while it has answers. That is deliberate: lib/draft.ts
 * (velocity) kept empty drafts around, and an empty leftover dated every later
 * session wrongly. Here an empty entry is simply not stored, so a test with no
 * answers always opens on today. One WITH answers keeps the date it was
 * started under, so nothing is saved under the wrong day by accident.
 *
 * `data` is the screen's `results` or the delivery's `flaws`.
 */

export type TestType = "screen" | "delivery";

export interface TestDraft {
  date: string;
  notes: string;
  data: Record<string, string | boolean>;
}

const key = (type: TestType, athleteId: string) =>
  `veloladder:testdraft:${type}:${athleteId}`;

function hasAnswers(data: unknown): data is Record<string, string | boolean> {
  return !!data && typeof data === "object" && Object.keys(data as object).length > 0;
}

export function loadTestDraft(type: TestType, athleteId: string): TestDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(type, athleteId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TestDraft> | null;
    if (!d || !hasAnswers(d.data)) return null;
    return {
      date: typeof d.date === "string" && d.date ? d.date : todayISO(),
      notes: typeof d.notes === "string" ? d.notes : "",
      data: d.data,
    };
  } catch {
    return null;
  }
}

export function saveTestDraft(type: TestType, athleteId: string, draft: TestDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(type, athleteId), JSON.stringify(draft));
  } catch {
    /* storage full or blocked: the form still works, it just cannot be restored */
  }
}

export function clearTestDraft(type: TestType, athleteId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(type, athleteId));
  } catch {
    /* ignore */
  }
}

export function hasTestDraft(type: TestType, athleteId: string): boolean {
  return loadTestDraft(type, athleteId) !== null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run the same command. Expected: `fail 0`.

- [ ] **Step 5: Mutation check**

Backup `lib/testDraft.ts`. (a) Change `Object.keys(data as object).length > 0` to `>= 0`: "a draft with no answers is no draft" must fail. (b) Delete `: todayISO()` fallback (use `d.date as string`): "missing its date" must fail. (c) Make the key ignore `type`: "each athlete and each test type" must fail. (d) Make `clearTestDraft` remove nothing: "clearing removes only..." must fail. Restore after each with `cp`.

- [ ] **Step 6: Commit**

```bash
git add lib/testDraft.ts lib/testDraft.test.ts
git commit -m "Unsaved test answers kept per athlete and test type

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ScreenForm and a thin ScreenModal

**Files:**
- Create (by moving): `components/ScreenForm.tsx`
- Rewrite: `components/ScreenModal.tsx`
- Test: `components/ScreenForm.test.tsx` (create); `components/ScreenModal.test.tsx` must pass UNEDITED.

**Interfaces:**
- Consumes: `TestDraft`, `saveTestDraft`, `clearTestDraft` from `@/lib/testDraft` (Task 1); everything `ScreenModal` already imports.
- Produces: default export `ScreenForm` with props:
  ```ts
  {
    athleteId: string;
    initial: MovementScreen | null;          // the record this opens on, if any
    takenDates: string[];
    onSaved: (msg: string) => void;          // called after a successful save
    onCancel?: () => void;                   // renders Cancel when given
    group?: boolean;                         // hides Cancel and Delete, shows no modal chrome assumptions
    draft?: TestDraft | null;                // answers to start from (group mode)
    persist?: boolean;                       // write/clear the draft as answers change (group mode)
    onDirty?: (dirty: boolean) => void;      // unsaved changes exist
    register?: (save: () => Promise<boolean>) => void; // lets a parent trigger Save
  }
  ```
  and `ScreenModal` keeps today's exact props: `{ athleteId, athleteName, initial, takenDates, isCoach, onClose, onSaved }`.

- [ ] **Step 1: Write the failing tests for the new form behaviour**

First read `components/ScreenModal.test.tsx` for the helpers (`withSwr`, `mockApi`) and for how a test answers a reading or presses "Mark N remaining tests normal". Create `components/ScreenForm.test.tsx` with these tests, reusing the same fixture style (`withSwr({ [`/api/athletes/${ID}/sessions`]: [] }, <ScreenForm .../>)`) and the same `mockApi` stub (copy it; it must also record the URL, so record `{ url, body }`):

```tsx
import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SCREEN_TESTS, fillNormal } from "@/lib/screen";
import type { MovementScreen } from "@/lib/types";
import { saveTestDraft, loadTestDraft } from "@/lib/testDraft";
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

test("with persist on, answering writes a draft and returning to blank removes it", async () => {
  form({ persist: true });
  assert.equal(loadTestDraft("screen", ID), null);
  markRestNormal();
  await waitFor(() => assert.ok(loadTestDraft("screen", ID) !== null, "draft written"));
  assert.equal(loadTestDraft("screen", ID)!.date, TODAY);
});

test("without persist, nothing is written", async () => {
  form();
  markRestNormal();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(loadTestDraft("screen", ID), null);
});

test("register hands the parent a save that posts, resolves true and clears the draft", async () => {
  const api = mockApi();
  try {
    let save: (() => Promise<boolean>) | null = null;
    form({ persist: true, group: true, register: (fn) => (save = fn) });
    markRestNormal();
    await waitFor(() => assert.ok(save !== null));
    const ok = await save!();
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
    const ok = await save!();
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
    await save!();
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
    await save!();
    assert.deepEqual(msgs, ["Screen saved"]);
  } finally {
    api.restore();
  }
});
```

If a selector in these tests does not match the real DOM (the Date label, the notes placeholder, the footer button text), adjust the selector to the real text in `ScreenModal.tsx`, not the component, and say what you changed.

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/ScreenForm.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find" | head`
Expected: FAIL, `Cannot find module './ScreenForm'`.

- [ ] **Step 3: Move the file and turn it into the form**

Run: `git mv components/ScreenModal.tsx components/ScreenForm.tsx`

Edit `components/ScreenForm.tsx`:

1. Add imports: `import { saveTestDraft, clearTestDraft, type TestDraft } from "@/lib/testDraft";`
2. Rename the default export `ScreenModal` to `ScreenForm` and replace its props type with:

```tsx
export default function ScreenForm({
  athleteId,
  initial,
  takenDates,
  onSaved,
  onCancel,
  group = false,
  draft = null,
  persist = false,
  onDirty,
  register,
}: {
  athleteId: string;
  /** The screen this opens on, today's if one was already recorded. */
  initial: MovementScreen | null;
  /** Dates that already hold a screen, so a new one can warn before it lands on one. */
  takenDates: string[];
  onSaved: (msg: string) => void;
  /** Renders a Cancel button when given. */
  onCancel?: () => void;
  /** Group mode: no Cancel and no Delete (deleting stays on the athlete's own page). */
  group?: boolean;
  /** Unsaved answers to start from, restored after a reload. */
  draft?: TestDraft | null;
  /** Keep a draft in the browser while there are unsaved answers. */
  persist?: boolean;
  /** Told whenever "has unsaved changes" flips. */
  onDirty?: (dirty: boolean) => void;
  /** Gives a parent a way to trigger Save; resolves true on success. */
  register?: (save: () => Promise<boolean>) => void;
}) {
```

3. Replace the state initialisers so a draft wins over `initial`:

```tsx
  const [existing, setExisting] = useState<MovementScreen | null>(initial);
  const [date, setDate] = useState(draft?.date ?? initial?.date ?? todayISO());
  const [results, setResults] = useState<Results>(
    (draft?.data as Results | undefined) ?? initial?.results ?? {},
  );
  const [notes, setNotes] = useState(draft ? draft.notes : (initial?.notes ?? ""));
  const [justSaved, setJustSaved] = useState(false);
  // What "unchanged" means: the saved record (or blank), moved forward after each save.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({ results: initial?.results ?? {}, notes: initial?.notes ?? "" }),
  );
```
   (Keep the existing `open`, `busy`, `err`, `confirmDelete` states.)

4. DELETE the Escape-key and `document.body.style.overflow` `useEffect` (the frame owns it now). Remove the `onClose` references.

5. Add, after the `setField`/`toggle` helpers:

```tsx
  const dirty = JSON.stringify({ results, notes }) !== baseline;

  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  // A draft exists only while there are unsaved answers, so an empty or
  // back-to-saved form leaves nothing behind to date a later test wrongly.
  useEffect(() => {
    if (!persist) return;
    if (dirty && Object.keys(results).length > 0) {
      saveTestDraft("screen", athleteId, { date, notes, data: results });
    } else {
      clearTestDraft("screen", athleteId);
    }
  }, [persist, dirty, results, notes, date, athleteId]);
```

6. Replace `save()` with a version that resolves a boolean, resets `busy`, and records the new baseline:

```tsx
  async function save(): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/screens`, "POST", {
        date,
        results,
        notes: notes.trim(),
      });
      const updating = !!existing || justSaved;
      setJustSaved(true);
      setBaseline(JSON.stringify({ results, notes }));
      setBusy(false);
      onSaved(updating ? "Screen updated" : "Screen saved");
      return true;
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
      return false;
    }
  }

  // Re-registered every render so a parent always calls the latest closure.
  useEffect(() => {
    register?.(save);
  });
```

7. Change `clash` to `const clash = !existing && !justSaved && takenDates.includes(date);` and the date input's `disabled={!!existing || justSaved}`; change the save button label to `existing || justSaved ? "Update screen" : "Save screen"`.

8. Replace the whole returned JSX: drop the `modal-backdrop`, `modal-panel`, `modal-head` wrappers; the component now returns just `<div className="ms"> ... </div>` (the content that used to sit inside the `.ms` div, unchanged). Render Cancel only when `onCancel` is given: `{onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}`; render the Delete block only when `existing && !group`. Remove the now-unused `athleteName` and `isCoach` props, `onClose`. Keep `remove()` as is but have it call `onSaved("Screen deleted")` (it already does).

Keep `TestCard`, `tally` and `MARK_LABEL` in this file unchanged.

- [ ] **Step 4: Write the thin frame**

Create `components/ScreenModal.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import type { MovementScreen } from "@/lib/types";
import ScreenForm from "./ScreenForm";

/*
 * The modal around the movement screen form. The form itself lives in
 * ScreenForm so the group test screen can show several at once; this frame
 * keeps the one-athlete flow exactly as it was: same props, same chrome, same
 * Escape and scroll-lock behaviour.
 */
export default function ScreenModal({
  athleteId,
  athleteName,
  initial,
  takenDates,
  onClose,
  onSaved,
}: {
  athleteId: string;
  athleteName: string;
  /** The screen this opens on, today's if one was already recorded. */
  initial: MovementScreen | null;
  /** Dates that already hold a screen, so a new one can warn before it lands on one. */
  takenDates: string[];
  /** Kept for callers still passing it; the physical screen has no coach-only section any more. */
  isCoach: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Movement screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Movement screen</span>
          <span className="modal-sub">{athleteName}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ScreenForm
          athleteId={athleteId}
          initial={initial}
          takenDates={takenDates}
          onSaved={onSaved}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the new tests and the UNEDITED existing ones**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/ScreenForm.test.tsx components/ScreenModal.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"` then `npx tsc --noEmit`.
Expected: `fail 0` and tsc clean. If an existing ScreenModal test fails, the frame or form changed behaviour: fix the code, never the existing test. Also run `components/ScreenPanel.test.tsx`.

- [ ] **Step 6: Mutation check**

Backup `components/ScreenForm.tsx`. (a) Remove `|| justSaved` from the date input's `disabled`: "after a group save the form reads as an update and the date is locked" must fail. (b) Delete the `register?.(save)` effect: the register tests must fail. (c) Make `dirty` always false: the onDirty and persist tests must fail. (d) Make `save()` return `true` in the catch: "a failed save resolves false" must fail. (e) Write the draft even when not `persist`: "without persist, nothing is written" must fail. (f) Show Delete when `group`: "group mode hides Cancel and Delete" must fail. Restore with `cp` after each.

- [ ] **Step 7: Commit**

```bash
git add components/ScreenForm.tsx components/ScreenModal.tsx components/ScreenForm.test.tsx
git commit -m "Split the movement screen into a form and a thin modal frame

The form gains group-mode props (draft, persist, dirty, register) so several
can sit under tabs; the one-athlete modal keeps its exact props and behaviour.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DeliveryForm and a thin DeliveryModal

**Files:**
- Create (by moving): `components/DeliveryForm.tsx`
- Rewrite: `components/DeliveryModal.tsx`
- Test: `components/DeliveryForm.test.tsx` (create); `components/DeliveryModal.test.tsx` must pass UNEDITED.

**Interfaces:**
- Consumes: `TestDraft`, `saveTestDraft`, `clearTestDraft` (Task 1).
- Produces: default export `DeliveryForm` with props:
  ```ts
  {
    athleteId: string;
    date: string;                       // the date to open on (today, or the draft's)
    initial: DeliveryScreen | null;
    takenDates: string[];
    onSaved: (msg: string) => void;
    onCancel?: () => void;
    group?: boolean;                    // hides Cancel
    draft?: TestDraft | null;           // data = flaws
    persist?: boolean;
    onDirty?: (dirty: boolean) => void;
    register?: (save: () => Promise<boolean>) => void;
  }
  ```
  and `DeliveryModal` keeps today's exact props: `{ athleteId, date, initial, takenDates, onClose, onSaved }`.

- [ ] **Step 1: Write the failing tests**

Create `components/DeliveryForm.test.tsx`, modelled on `components/DeliveryModal.test.tsx` (read it first for its helpers and for how it ticks a flaw: the checkboxes are `input[name="flaw:<key>"]` and `BIG_12` gives the keys). Same pinned clock and `mockApi` (recording `{ url, body }`) as in Task 2. Tests:

```tsx
import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BIG_12 } from "@/lib/big12";
import type { DeliveryScreen } from "@/lib/types";
import { loadTestDraft } from "@/lib/testDraft";
import DeliveryForm from "./DeliveryForm";

const ID = "a1";
const TODAY = "2026-10-16";
const FLAW = BIG_12[0].key;

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

// mockApi: identical to the one in components/ScreenForm.test.tsx (copy it here).
```

Then these tests (mirroring Task 2):
1. no `dialog` role; Cancel only when `onCancel` given; group hides Cancel.
2. A `draft` (`data: { [FLAW]: true }`) pre-ticks that flaw, uses the draft's date and notes.
3. `onDirty` false initially, true after ticking a flaw; a saved assessment opened untouched is not dirty; unticking back to the saved state returns to not dirty.
4. `persist`: ticking writes `loadTestDraft("delivery", ID)` with `data` `{ [FLAW]: true }`, date `TODAY`; unticking removes it; without `persist` nothing is written.
5. `register` → save posts to `/api/athletes/${ID}/delivery` with `{ date, flaws, notes }`, resolves true, clears the draft; a 500 resolves false, keeps the draft, shows `role="alert"`.
6. **A clean assessment can be saved:** with nothing ticked, `register`'s save posts `flaws: {}` and resolves true (the "I looked and found nothing" record). 
7. After a group save the button reads "Update assessment" and the date input is disabled; `onSaved` receives "Assessment saved".

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/DeliveryForm.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))|Cannot find" | head`
Expected: FAIL, `Cannot find module './DeliveryForm'`.

- [ ] **Step 3: Move and convert**

Run: `git mv components/DeliveryModal.tsx components/DeliveryForm.tsx`

Edit `components/DeliveryForm.tsx` with the same pattern as Task 2:
1. Imports: `saveTestDraft, clearTestDraft, type TestDraft`.
2. Rename to `DeliveryForm`; props as in the Interfaces block (no `onClose`, plus `onCancel`, `group`, `draft`, `persist`, `onDirty`, `register`; keep `date: openingDate`).
3. State: `date` from `draft?.date ?? initial?.date ?? openingDate`; `flaws` from `(draft?.data as Record<string, boolean> | undefined) ?? initial?.flaws ?? {}`; `notes` from `draft ? draft.notes : initial?.notes ?? ""`; add `justSaved` and `baseline` (`JSON.stringify({ flaws: initial?.flaws ?? {}, notes: initial?.notes ?? "" })`).
4. Delete the Escape/scroll-lock effect.
5. Add `dirty`, the `onDirty` effect and the persist effect (draft written only when `dirty && Object.keys(flaws).length > 0`, else cleared; type `"delivery"`, `data: flaws`).
6. `save(): Promise<boolean>` as in Task 2 (POST `/api/athletes/${athleteId}/delivery` with `{ date, flaws, notes: notes.trim() }`; success message `initial || justSaved ? "Assessment updated" : "Assessment saved"`; sets `justSaved`, new baseline, `busy` false; returns true/false) and the `register?.(save)` effect.
7. `clash = !initial && !justSaved && takenDates.includes(date)`; date input `disabled={!!initial || justSaved}`; button label `initial || justSaved ? "Update assessment" : "Save assessment"`.
8. Return only the `<div className="ms">...</div>` content; Cancel only when `onCancel` is given.

Create `components/DeliveryModal.tsx` as a frame exactly like Task 2's, with `aria-label="Pitching inhibitors"`, title "Pitching Inhibitors" (no `modal-sub`), props `{ athleteId, date, initial, takenDates, onClose, onSaved }` passed through to `DeliveryForm` with `onCancel={onClose}`.

- [ ] **Step 4: Run new and UNEDITED existing tests**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/DeliveryForm.test.tsx components/DeliveryModal.test.tsx components/ScreenPanel.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"` then `npx tsc --noEmit`.
Expected: `fail 0`, tsc clean. Never edit an existing test to make it pass.

- [ ] **Step 5: Mutation check**

Backup the form. (a) Make `dirty` always false: dirty and persist tests fail. (b) Drop `register?.(save)`: register tests fail. (c) Write drafts even when `flaws` is empty: the "unticking removes it" test fails. (d) Return true from the catch: the failed-save test fails. (e) Show Cancel in group mode: its test fails. Restore with `cp` after each.

- [ ] **Step 6: Commit**

```bash
git add components/DeliveryForm.tsx components/DeliveryModal.tsx components/DeliveryForm.test.tsx
git commit -m "Split Pitching Inhibitors into a form and a thin modal frame

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The athlete picker

**Files:**
- Create: `components/AthletePicker.tsx`
- Test: `components/AthletePicker.test.tsx`
- Modify: `app/globals.css` (append picker styles)

**Interfaces:**
- Produces: default export `AthletePicker` with props `{ title: string; startLabel: (n: number) => string; people: { id: string; name: string }[]; onStart: (ids: string[]) => void; onClose: () => void }`. `onStart` receives ids in the order of `people` (roster order), not click order.

- [ ] **Step 1: Write the failing tests**

Create `components/AthletePicker.test.tsx`:

```tsx
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
  assert.ok(screen.queryByText(/selected/) === null || screen.queryByText("0 selected") !== null);
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
```

If a text matcher does not fit once the component exists (for example the exact count wording), adjust the TEST to the component's wording only where the plan did not fix it; the visible strings fixed by this plan are: placeholder contains "search", buttons "Select all" and "Clear", count `"N selected"`, empty messages "No athletes yet." and "No one matches that.".

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL, `Cannot find module './AthletePicker'`.

- [ ] **Step 3: Implement**

Create `components/AthletePicker.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export interface PickPerson {
  id: string;
  name: string;
}

/**
 * Choose who is in a session or a test. One component for both homepage
 * flows. Picks are held by id, so an athlete filtered out of view by the
 * search is still picked, and Start returns ids in roster order.
 */
export default function AthletePicker({
  title,
  startLabel,
  people,
  onStart,
  onClose,
}: {
  title: string;
  startLabel: (picked: number) => string;
  people: PickPerson[];
  onStart: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
  }, [people, q]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="picker">
          <input
            className="tin"
            type="search"
            placeholder="Search athletes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="picker-bar">
            <span>{picked.size} selected</span>
            <span className="picker-actions">
              <button
                className="btn sm ghost"
                disabled={shown.length === 0}
                onClick={() =>
                  setPicked((s) => new Set([...s, ...shown.map((p) => p.id)]))
                }
              >
                Select all
              </button>
              <button
                className="btn sm ghost"
                disabled={picked.size === 0}
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            </span>
          </div>

          {people.length === 0 ? (
            <p className="picker-empty">No athletes yet.</p>
          ) : shown.length === 0 ? (
            <p className="picker-empty">No one matches that.</p>
          ) : (
            <ul className="picker-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <label className="picker-row">
                    <input
                      type="checkbox"
                      aria-label={p.name}
                      checked={picked.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span>{p.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <button
            className="btn primary"
            disabled={picked.size === 0}
            onClick={() =>
              onStart(people.filter((p) => picked.has(p.id)).map((p) => p.id))
            }
          >
            {startLabel(picked.size)}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Append to `app/globals.css`:

```css
/* Athlete picker (homepage quick start) */
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 16px;
}
.picker-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--ink-dim);
}
.picker-actions {
  display: flex;
  gap: 6px;
}
.picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.picker-list li + li {
  border-top: 1px solid var(--line-soft);
}
.picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.picker-empty {
  margin: 0;
  padding: 14px 4px;
  color: var(--ink-dim);
  font-size: 13.5px;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/AthletePicker.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"` then `npx tsc --noEmit` and `npm run lint` (0 errors).
Expected: `fail 0`.

- [ ] **Step 5: Mutation check**

Backup the component. (a) Return ids in click order (iterate `picked`): the roster-order test fails. (b) Make Select all use `people` instead of `shown`: the select-all test fails. (c) Make search case-sensitive: the search test fails. (d) Clear picks on filter change (`setPicked(new Set())` in the search onChange): "a pick survives being filtered out" fails. (e) Remove `disabled={picked.size === 0}` on Start: the first test fails. Restore with `cp` after each.

- [ ] **Step 6: Commit**

```bash
git add components/AthletePicker.tsx components/AthletePicker.test.tsx app/globals.css
git commit -m "Athlete picker for starting a session or a test

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The group test screen

**Files:**
- Create: `components/GroupTest.tsx`
- Test: `components/GroupTest.test.tsx`

**Interfaces:**
- Consumes: `ScreenForm` (Task 2), `DeliveryForm` (Task 3), `loadTestDraft`, `hasTestDraft`, `TestType` (Task 1); the existing CSS classes `modal-backdrop`, `modal-panel`, `modal-head`, `modal-title`, `modal-x`, `tabstrip`, `modal-tabs`, `atab` (and its `saved`, `data`, `on` states), `toast`.
- Produces: default export `GroupTest` with props `{ type: TestType; people: { id: string; name: string }[]; ids: string[]; onClose: () => void; onSaved?: () => void }`. `onSaved` fires after every successful save so the caller can refresh shared lists.

**Behaviour to build (the spec's "group test screen"):**
- Header: title "Movement screen" or "Pitching Inhibitors" and a close button. One tab per picked athlete (first names, `ids` order restricted to `people`).
- Tab marks: `●` when that athlete has unsaved answers (live from the form's `onDirty`), `✓` once saved this sitting and not dirty again.
- Each athlete's panel loads their records via SWR (`/api/athletes/${id}/screens` for `screen`, `/api/athletes/${id}/delivery` for `delivery`), then mounts the form with: `draft = loadTestDraft(type, id)` read ONCE at mount, `initial = records.find(r => r.date === (draft?.date ?? todayISO())) ?? null`, `takenDates = records.map(r => r.date)`, `group`, `persist`, `onDirty`, `register`, and `onSaved` that refreshes that athlete's SWR key (inside try/catch, a failed revalidation must never break the save) then tells the shell.
- A panel mounts when first visited OR when that athlete already has a draft, and stays mounted afterwards; inactive panels are hidden with the `hidden` attribute so their state survives.
- Footer: `Save all (N)` where N is the number of athletes with unsaved answers right now; disabled at 0. Save all runs the registered save of every dirty athlete one after another, never stopping at a failure, and shows a summary toast ("Saved 2 screens" / "Saved 1, 1 failed"). A per-athlete Save is each form's own button.

- [ ] **Step 1: Write the failing tests**

Create `components/GroupTest.test.tsx`. Fixtures: `withSwr({ "/api/athletes/a1/screens": [], "/api/athletes/a2/screens": [], "/api/athletes/a1/sessions": [], "/api/athletes/a2/sessions": [] , "/api/athletes/a1/delivery": [], "/api/athletes/a2/delivery": [] }, <GroupTest .../>)`. Use the same pinned clock, `mockApi` (recording `{ url, body }`, with an optional `failFor: string` substring that returns 500 for matching URLs) and `markRestNormal` helper as in Task 2. Tests:

1. Tabs show each picked athlete's first name, the first is active, and only the active athlete's form is visible (`hidden` on the other).
2. **The core:** with two athletes: on A press "Mark remaining normal"; switch to B and do the same; switch back to A: A's answers are intact (the progress line "N of M readings recorded" for A equals what it showed before switching).
3. Tab marks: a `●` appears on a tab after answering, and disappears with a `✓` after that athlete's own Save.
4. Per-athlete Save posts only that athlete's body to `/api/athletes/<id>/screens` and does not post for the other.
5. Save all posts for each athlete with answers and none for an athlete without; its label shows the count (`Save all (2)`), and it is disabled at 0.
6. One failing save during Save all: the other still saves, the failing athlete keeps `●`, shows its alert and keeps its draft.
7. **Reload restores:** write a draft for athlete B with `saveTestDraft("screen", "b", ...)` (using real answers from `fillNormal({}, [SCREEN_TESTS[0]])`), then render: B's tab shows `●` immediately though never visited, B's form (once opened) has those answers, and Save all counts it.
8. A draft is removed after its athlete saves (check `loadTestDraft` is null).
9. An athlete who already has today's saved record opens on it (fixture `screens: [{ id, athleteId, date: TODAY, results, notes }]`): the progress line reflects the saved readings, the button reads "Update screen", and the tab is NOT marked `●`.
10. **Pitching Inhibitors group:** `type="delivery"`: tick a flaw for A only; Save all shows `(1)` and posts only A; B's clean assessment is NOT swept up (no POST for B), but B's own Save posts `flaws: {}`.
11. The `onSaved` prop fires once per successful save, not for a failed one.
12. Escape and the close button call `onClose`; closing never deletes drafts.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL, `Cannot find module './GroupTest'`.

- [ ] **Step 3: Implement**

Create `components/GroupTest.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { DeliveryScreen, MovementScreen } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { todayISO } from "@/lib/velo";
import { hasTestDraft, loadTestDraft, type TestType } from "@/lib/testDraft";
import ScreenForm from "./ScreenForm";
import DeliveryForm from "./DeliveryForm";

/* ------------------------------------------------------------------ *
 * Several athletes through the same test on one device
 *
 * One tab per athlete, one form per athlete, all kept mounted once opened so
 * flipping between them never loses an answer. Unsaved answers are also kept
 * in the browser (lib/testDraft.ts), so a reload restores them, and an athlete
 * with a saved draft is mounted straight away so the tab can show its dot and
 * Save all can reach it.
 *
 * Saves are the same POSTs the one-athlete forms make; there is no new API.
 * ------------------------------------------------------------------ */

type Person = { id: string; name: string };

const LABEL: Record<TestType, { title: string; noun: string }> = {
  screen: { title: "Movement screen", noun: "screen" },
  delivery: { title: "Pitching Inhibitors", noun: "assessment" },
};

export default function GroupTest({
  type,
  people,
  ids,
  onClose,
  onSaved,
}: {
  type: TestType;
  people: Person[];
  ids: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const members = ids
    .map((id) => people.find((p) => p.id === id))
    .filter(Boolean) as Person[];

  const [activeId, setActiveId] = useState(members[0]?.id ?? "");
  // Mounted panels: the first tab, plus anyone who already has a draft.
  const [mounted, setMounted] = useState<Set<string>>(
    () =>
      new Set(
        members
          .filter((m, i) => i === 0 || hasTestDraft(type, m.id))
          .map((m) => m.id),
      ),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saves = useRef<Map<string, () => Promise<boolean>>>(new Map());

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const pick = (id: string) => {
    setActiveId(id);
    setMounted((s) => (s.has(id) ? s : new Set(s).add(id)));
  };

  const markDirty = useCallback((id: string, isDirty: boolean) => {
    setDirty((d) => (d[id] === isDirty ? d : { ...d, [id]: isDirty }));
  }, []);

  const afterSave = (id: string, msg: string) => {
    setSaved((s) => new Set(s).add(id));
    onSaved?.();
    show(msg);
  };

  const dirtyIds = members.filter((m) => dirty[m.id]).map((m) => m.id);

  async function saveAll() {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of dirtyIds) {
      const save = saves.current.get(id);
      if (!save) continue;
      if (await save()) ok += 1;
      else failed += 1;
    }
    setBusy(false);
    const noun = LABEL[type].noun;
    show(
      failed
        ? `Saved ${ok}, ${failed} failed`
        : `Saved ${ok} ${noun}${ok === 1 ? "" : "s"}`,
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL[type].title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{LABEL[type].title}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tabstrip modal-tabs">
          {members.map((m) => {
            const status = dirty[m.id] ? "data" : saved.has(m.id) ? "saved" : "empty";
            return (
              <button
                key={m.id}
                className={`atab ${status}${m.id === activeId ? " on" : ""}`}
                onClick={() => pick(m.id)}
              >
                {m.name.split(" ")[0]}
                {status === "saved" ? " ✓" : status === "data" ? " ●" : ""}
              </button>
            );
          })}
        </div>

        <div className="modal-body">
          {members.map((m) =>
            mounted.has(m.id) ? (
              <div key={m.id} hidden={m.id !== activeId}>
                <AthletePanel
                  type={type}
                  athlete={m}
                  onDirty={(d) => markDirty(m.id, d)}
                  register={(fn) => saves.current.set(m.id, fn)}
                  onSaved={(msg) => afterSave(m.id, msg)}
                />
              </div>
            ) : null,
          )}
        </div>

        <div className="ms-actions group-test-foot">
          <button
            className="btn primary"
            disabled={busy || dirtyIds.length === 0}
            onClick={saveAll}
          >
            {busy ? "Saving…" : `Save all (${dirtyIds.length})`}
          </button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * One athlete's form. Loads their records first (the same call their own page
 * makes), works out today's record and any draft ONCE, then mounts the form
 * and never re-derives them: later revalidation must not reset what the coach
 * is in the middle of typing.
 */
function AthletePanel({
  type,
  athlete,
  onDirty,
  register,
  onSaved,
}: {
  type: TestType;
  athlete: Person;
  onDirty: (dirty: boolean) => void;
  register: (save: () => Promise<boolean>) => void;
  onSaved: (msg: string) => void;
}) {
  const path = type === "screen" ? "screens" : "delivery";
  const { data, mutate } = useSWR<(MovementScreen | DeliveryScreen)[]>(
    `/api/athletes/${athlete.id}/${path}`,
    fetcher,
  );
  const [draft] = useState(() => loadTestDraft(type, athlete.id));

  if (!data) {
    return <p style={{ color: "var(--ink-dim)", padding: 16 }}>Loading {athlete.name}…</p>;
  }

  const openingDate = draft?.date ?? todayISO();
  const initial = data.find((r) => r.date === openingDate) ?? null;
  const takenDates = data.map((r) => r.date);

  const done = async (msg: string) => {
    try {
      await mutate();
    } catch {
      /* a failed refresh must never undo a save that worked */
    }
    onSaved(msg);
  };

  return type === "screen" ? (
    <ScreenForm
      athleteId={athlete.id}
      initial={initial as MovementScreen | null}
      takenDates={takenDates}
      group
      persist
      draft={draft}
      onDirty={onDirty}
      register={register}
      onSaved={done}
    />
  ) : (
    <DeliveryForm
      athleteId={athlete.id}
      date={openingDate}
      initial={initial as DeliveryScreen | null}
      takenDates={takenDates}
      group
      persist
      draft={draft}
      onDirty={onDirty}
      register={register}
      onSaved={done}
    />
  );
}
```

Append to `app/globals.css`:

```css
.group-test-foot {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--line-soft);
}
```

Note for the implementer: `onDirty={(d) => markDirty(m.id, d)}` creates a new function each render and `ScreenForm`/`DeliveryForm` call `onDirty` from an effect keyed on `[dirty, onDirty]`; that would fire every render. If tests or React warn about update loops, wrap the callback with `useCallback` per athlete (for example a small `Row` component that owns the stable callback) rather than changing the forms' effect, and say what you did.

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/GroupTest.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"` then `npx tsc --noEmit` and `npm run lint` (0 errors). Run the file 5 times to check for flakiness.

- [ ] **Step 5: Mutation check**

Backup the component. (a) Unmount inactive panels (render only the active one): the "answers intact after switching" test fails. (b) Remove `hasTestDraft(type, m.id)` from the initial mounted set: the reload test fails. (c) Make Save all iterate all members, not `dirtyIds`: the "none for an athlete without" test fails. (d) `break` on the first failure in `saveAll`: the partial-failure test fails. (e) Compute `initial` from today only (ignore the draft's date): the draft-on-existing-record case, if tested, or the date test fails (add one if none covers it: a draft dated 2026-09-16 opens the form on that date). (f) Remove `onSaved?.()` from `afterSave`: the onSaved test fails. Restore with `cp` after each.

- [ ] **Step 6: Commit**

```bash
git add components/GroupTest.tsx components/GroupTest.test.tsx app/globals.css
git commit -m "Group test screen: several athletes through the same test at once

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The homepage buttons and the flows behind them

**Files:**
- Create: `components/QuickStart.tsx`
- Modify: `components/RecordChooser.tsx` (optional `title`), `components/Dashboard.tsx`, `app/globals.css`
- Test: `components/QuickStart.test.tsx`; add one assertion to `components/Dashboard.test.tsx`.

**Interfaces:**
- Consumes: `AthletePicker` (Task 4), `GroupTest` (Task 5), `GroupSession` (existing: props `{ people, ids, onClose, onSaved? }`), `RecordChooser` (existing: `{ onPick(kind: "screen" | "delivery"), onClose }`, gaining an optional `title`), `useSWR`/`useSWRConfig`, `AthleteOverview` from `@/lib/types`.
- Produces: default export `QuickStart` (no props).

**Behaviour:**
- Renders two buttons: "Track a new session" and "Track a new test".
- Session: opens `AthletePicker` (title "Who is in this session?", start label `n => n ? \`Start session with ${n}\` : "Start session"`), then `GroupSession` with those ids.
- Test: opens `RecordChooser` with `title="Track a new test"` offering Movement screen / Pitching Inhibitors, then `AthletePicker` (title "Who is being tested?", start label `n => n ? \`Start test with ${n}\` : "Start test"`), then `GroupTest` of the chosen type.
- The athlete list is `useSWR("/api/athletes/overview")` fetched ONLY once a picker is wanted (key `null` otherwise, so the homepage costs nothing and tests need no fixture for it), filtered to `!archived`.
- When a session or test screen closes or saves, refresh `/api/dashboard`, `/api/screens/overview` and `/api/delivery/overview` (via `useSWRConfig().mutate`), each in a try/catch.

- [ ] **Step 1: Write the failing tests**

Create `components/QuickStart.test.tsx` using `withSwr`. Fixtures: `{ "/api/athletes/overview": [ {id:"a1",name:"Jake Bell",archived:false, ...}, {id:"a2",name:"Cooper Hale",archived:false,...}, {id:"a3",name:"Gone Guy",archived:true,...} ] }` (cast to the type; only `id`, `name`, `archived` matter) plus `"/api/athletes/a1/screens": []`, `"/api/athletes/a2/screens": []`, `"/api/athletes/a1/sessions": []`, `"/api/athletes/a2/sessions": []`, `"/api/athletes/a1/delivery": []`, `"/api/athletes/a2/delivery": []`. `GroupSession` fetches `/api/athletes/<id>/sessions`, so include those. Tests:

1. Both buttons render and nothing else opens.
2. Track a new session -> picker titled "Who is in this session?" lists only active athletes (no "Gone Guy").
3. Pick two, Start -> the group velocity screen opens (assert on its `Log session` title).
4. Track a new test -> chooser offers exactly "Movement screen" and "Pitching Inhibitors" and titled "Track a new test".
5. Choose Movement screen -> picker titled "Who is being tested?"; pick one, Start -> the group test screen opens with the "Movement screen" title and the athlete's tab.
6. Choose Pitching Inhibitors -> the group test opens with the "Pitching Inhibitors" title.
7. Closing a picker returns to the two buttons without opening anything else.
8. Cancelling the chooser opens no picker.
9. The athlete list is NOT requested until a picker is opened (render with fixtures lacking `/api/athletes/overview` entirely: the two buttons still render; `withSwr`'s throwing fetcher would fail the test if it were requested).

In `components/Dashboard.test.tsx` add one test: the dashboard renders both buttons ("Track a new session", "Track a new test") even when every widget is turned off. Read the existing tests in that file for how widgets are toggled and how fixtures are provided.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL, `Cannot find module './QuickStart'`.

- [ ] **Step 3: Implement**

In `components/RecordChooser.tsx` add an optional prop and use it:

```tsx
export default function RecordChooser({
  title = "Record a screen",
  onPick,
  onClose,
}: {
  title?: string;
  onPick: (kind: "screen" | "delivery") => void;
  onClose: () => void;
}) {
```
and render `<span className="modal-title">{title}</span>` and `aria-label={title}` (keep the existing `aria-label="Record an assessment"` behaviour when no title is passed: use `aria-label={title === "Record a screen" ? "Record an assessment" : title}`; the existing tests rely on it).

Create `components/QuickStart.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { AthleteOverview } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import type { TestType } from "@/lib/testDraft";
import AthletePicker from "./AthletePicker";
import GroupSession from "./GroupSession";
import GroupTest from "./GroupTest";
import RecordChooser from "./RecordChooser";

/*
 * Start a session or a test from the homepage. The athlete list is fetched
 * only once a picker is wanted, so the homepage itself costs nothing extra.
 */

type Step =
  | { kind: "idle" }
  | { kind: "choose-test" }
  | { kind: "pick"; flow: "session" | TestType }
  | { kind: "run"; flow: "session" | TestType; ids: string[] };

export default function QuickStart() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const { mutate } = useSWRConfig();
  const wantsList = step.kind === "pick" || step.kind === "run";
  const { data } = useSWR<AthleteOverview[]>(
    wantsList ? "/api/athletes/overview" : null,
    fetcher,
  );
  const people = (data ?? [])
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name }));

  const refresh = async () => {
    for (const key of ["/api/dashboard", "/api/screens/overview", "/api/delivery/overview"]) {
      try {
        await mutate(key);
      } catch {
        /* a refresh that fails must never get in the way of the coach */
      }
    }
  };
  const idle = () => setStep({ kind: "idle" });

  return (
    <>
      <div className="quick-start">
        <button
          className="quick-btn"
          onClick={() => setStep({ kind: "pick", flow: "session" })}
        >
          <span className="quick-name">Track a new session</span>
          <span className="quick-tag">Mound or pulldown, for one athlete or several.</span>
        </button>
        <button className="quick-btn" onClick={() => setStep({ kind: "choose-test" })}>
          <span className="quick-name">Track a new test</span>
          <span className="quick-tag">Movement screen or Pitching Inhibitors.</span>
        </button>
      </div>

      {step.kind === "choose-test" && (
        <RecordChooser
          title="Track a new test"
          onClose={idle}
          onPick={(kind) => setStep({ kind: "pick", flow: kind })}
        />
      )}

      {step.kind === "pick" && (
        <AthletePicker
          title={step.flow === "session" ? "Who is in this session?" : "Who is being tested?"}
          startLabel={(n) =>
            step.flow === "session"
              ? n ? `Start session with ${n}` : "Start session"
              : n ? `Start test with ${n}` : "Start test"
          }
          people={people}
          onClose={idle}
          onStart={(ids) => setStep({ kind: "run", flow: step.flow, ids })}
        />
      )}

      {step.kind === "run" && step.flow === "session" && (
        <GroupSession
          people={people}
          ids={step.ids}
          onSaved={refresh}
          onClose={() => {
            idle();
            void refresh();
          }}
        />
      )}

      {step.kind === "run" && step.flow !== "session" && (
        <GroupTest
          type={step.flow}
          people={people}
          ids={step.ids}
          onSaved={refresh}
          onClose={() => {
            idle();
            void refresh();
          }}
        />
      )}
    </>
  );
}
```

In `components/Dashboard.tsx` import `QuickStart` and render `<QuickStart />` directly after the `sec-h` block and before the loading/data blocks (so it shows even while data loads and regardless of widget settings).

Append to `app/globals.css`:

```css
/* Homepage quick start */
.quick-start {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.quick-btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: var(--ink);
  cursor: pointer;
}
.quick-btn:hover {
  border-color: var(--accent);
}
.quick-name {
  font-family: var(--font-display), sans-serif;
  font-size: 19px;
}
.quick-tag {
  font-size: 13px;
  color: var(--ink-dim);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test --test-reporter=spec --experimental-test-module-mocks components/QuickStart.test.tsx components/Dashboard.test.tsx components/ScreenPanel.test.tsx components/RecordChooser.test.tsx 2>&1 | grep -E "^\s*(✖|ℹ (pass|fail))"` (skip any file that does not exist), then `npx tsc --noEmit` and `npm run lint` (0 errors).
Expected: `fail 0`. The existing `ScreenPanel` chooser behaviour must be unchanged.

- [ ] **Step 5: Mutation check**

Backup `QuickStart.tsx`. (a) Fetch the athlete list always (`"/api/athletes/overview"` with no condition): test 9 fails. (b) Drop the `!a.archived` filter: test 2 fails. (c) Route "Pitching Inhibitors" to type `"screen"`: test 6 fails. (d) Skip the chooser and go straight to the picker: test 4 fails. (e) Remove `<QuickStart />` from the Dashboard: the Dashboard test fails. Restore with `cp` after each.

- [ ] **Step 6: Commit**

```bash
git add components/QuickStart.tsx components/QuickStart.test.tsx components/RecordChooser.tsx components/Dashboard.tsx components/Dashboard.test.tsx app/globals.css
git commit -m "Homepage buttons: track a new session, track a new test

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and the full gate

**Files:**
- Modify: `HANDOFF.md`, `docs/superpowers/specs/2026-10-16-homepage-shortcuts-group-tests-design.md` (status line)
- Create (outside the repo): the memory note.

- [ ] **Step 1: Document it**

In `HANDOFF.md` add a section "Homepage quick start and group tests" stating: the two buttons on the coach Dashboard (not widgets, always shown); the picker (`AthletePicker`, one component for both flows, picks held by id, roster order); sessions open the existing `GroupSession`; tests open `GroupTest`, which mounts one `ScreenForm` or `DeliveryForm` per athlete, keeps visited forms mounted, and reads saved drafts so a tab shows its dot after a reload; drafts live in localStorage under `veloladder:testdraft:<type>:<athleteId>`, exist only while there are answers, and a draft keeps its date while an empty entry always opens on today; Save all covers athletes with answers only, and a clean Pitching Inhibitors assessment is saved with that athlete's own Save; delete stays on the athlete's page; no API or schema change; `ScreenModal` and `DeliveryModal` are thin frames around the forms. Update the component list in HANDOFF if it names `ScreenModal` or `DeliveryModal` as holding the form logic.

In the spec file change `**Status:** awaiting Cole's review` to `**Status:** implemented`.

- [ ] **Step 2: Run the full gate**

Run: `rm -rf .next/static .next/server && npm run verify 2>&1 | grep -E "^ℹ (tests|pass|fail)|error TS|✖ [a-z]|problems|Compiled|Failed"`
Expected: lint 0 errors (the 8 existing warnings), build compiled, `fail 0`. If anything fails, report exactly what and why; do not change tests to pass.

- [ ] **Step 3: Memory note**

Write `/Users/colethomas/.claude/projects/-Users-colethomas/memory/velo-ladder-group-tests.md` (frontmatter `name: velo-ladder-group-tests`, `type: project`) recording: Cole asked for homepage buttons and to run two athletes through the same test at once on one device (the OnBaseU app he copies the tests from is one athlete per device); the two test types only (strength excluded by his choice); drafts survive reload by his choice; the forms are split from the modals; `testDraft` keeps no empty drafts (the velocity draft bug); Save all excludes clean Pitching Inhibitors assessments. Add one line to `MEMORY.md` (read it first; insert beside the other velo-ladder lines; do not rewrite others).

- [ ] **Step 4: Commit**

```bash
git add HANDOFF.md docs/superpowers/specs/2026-10-16-homepage-shortcuts-group-tests-design.md
git commit -m "Document the homepage quick start and group tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand off to Cole**

Push. No setup run (no schema change). Then on the live site: start a test for two athletes from the homepage, answer both, flip between them, reload mid-way and confirm the answers and the dots are still there, save both, confirm they appear on the Tests page and the dashboard's screening-due list updates. Also start a velocity session from the homepage for two athletes and confirm the date at the top is today.
