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

/* ------------------------------------------------------------------ *
 * Only real answers survive loading: a screen reading is a non-empty
 * string, a delivery flaw is `true`. Anything else in storage is dropped so
 * the forms can trust the type.
 * ------------------------------------------------------------------ */

const store = (value: unknown) =>
  window.localStorage.setItem(
    "veloladder:testdraft:screen:a1",
    JSON.stringify(value),
  );

test("stored data that is an array is no draft", () => {
  store({ date: OLD, notes: "", data: ["x"] });
  assert.equal(loadTestDraft("screen", "a1"), null);
});

test("stored data whose values are all objects is no draft", () => {
  store({ date: OLD, notes: "", data: { a: { b: 1 } } });
  assert.equal(loadTestDraft("screen", "a1"), null);
});

test("entries that are not answers are dropped and real ones kept", () => {
  store({ date: OLD, notes: "", data: { a: null, b: "normal", c: "", d: 3, e: false, f: true } });
  assert.deepEqual(loadTestDraft("screen", "a1")!.data, { b: "normal", f: true });
});

test("false is not an answer", () => {
  store({ date: OLD, notes: "", data: { a: false } });
  assert.equal(loadTestDraft("screen", "a1"), null);
});

test("a date that is not a calendar-shaped date falls back to today and the answers survive", () => {
  store({ date: "tomorrow", notes: "n", data: { b: "normal" } });
  const d = loadTestDraft("screen", "a1")!;
  assert.equal(d.date, TODAY);
  assert.deepEqual(d.data, { b: "normal" });
});

/* ------------------------------------------------------------------ *
 * Saving an empty state removes the draft instead of leaving an entry
 * behind. A form must therefore restore before it saves, so it never
 * clobbers a stored draft by saving its empty initial state on mount.
 * ------------------------------------------------------------------ */

test("saving a draft with no answers leaves nothing in storage", () => {
  saveTestDraft("screen", "a1", draft({ data: {} }));
  assert.equal(window.localStorage.getItem("veloladder:testdraft:screen:a1"), null);
});

test("saving a draft whose answers are all invalid leaves nothing in storage", () => {
  saveTestDraft("screen", "a1", draft({ data: { a: false, b: "" } }));
  assert.equal(window.localStorage.getItem("veloladder:testdraft:screen:a1"), null);
});

test("saving an empty draft over a good one removes it", () => {
  saveTestDraft("screen", "a1", draft());
  assert.equal(hasTestDraft("screen", "a1"), true);
  saveTestDraft("screen", "a1", draft({ data: {} }));
  assert.equal(window.localStorage.getItem("veloladder:testdraft:screen:a1"), null);
  assert.equal(hasTestDraft("screen", "a1"), false);
});

test("an empty save of one athlete does not touch another's draft", () => {
  saveTestDraft("screen", "a2", draft());
  saveTestDraft("screen", "a1", draft({ data: {} }));
  assert.equal(hasTestDraft("screen", "a2"), true);
});

test("saving stores only the real answers, not blanks or false flags", () => {
  saveTestDraft("screen", "a1", draft({ data: { a: "normal", b: "", c: false, d: true } }));
  const raw = JSON.parse(window.localStorage.getItem("veloladder:testdraft:screen:a1")!);
  assert.deepEqual(raw.data, { a: "normal", d: true });
});
