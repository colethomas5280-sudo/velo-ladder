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
