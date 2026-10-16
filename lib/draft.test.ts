import "../components/testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { loadDraft, saveDraft, emptyDraft, type Draft } from "@/lib/draft";

/* ------------------------------------------------------------------ *
 * Restoring an unfinished session entry.
 *
 * The coach reported a new session opening on September 16 and October 5
 * when it was October 16. Drafts are remembered per athlete and tracker and
 * come back with whatever date they were saved under, and an EMPTY draft is
 * saved whenever Save is pressed with nothing entered, so it sat in the
 * browser and dated every later session. The rule now: an entry with no
 * numbers always starts on today. An entry WITH numbers keeps its date, so
 * nothing is ever saved under the wrong day by accident (the coach's call).
 *
 * The clock is pinned so "today" is a known day whatever day this runs.
 * ------------------------------------------------------------------ */

const TODAY = "2026-10-16";
const STALE = "2026-09-16";

beforeEach(() => {
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  date: STALE,
  notes: "",
  throws: {},
  editingId: null,
  ...over,
});

test("with nothing saved, a draft starts on today", () => {
  assert.equal(loadDraft("a1", "mound").date, TODAY);
  assert.equal(emptyDraft().date, TODAY);
});

test("a leftover empty draft from an earlier day starts on today", () => {
  saveDraft("a1", "mound", draft());
  assert.equal(loadDraft("a1", "mound").date, TODAY);
});

test("a leftover draft whose boxes are all blank starts on today", () => {
  saveDraft("a1", "mound", draft({ throws: { m5: ["", "", "", "", ""], m1: ["", " ", "", "", ""] } }));
  assert.equal(loadDraft("a1", "mound").date, TODAY);
});

test("notes survive when the date moves to today", () => {
  saveDraft("a1", "mound", draft({ notes: "felt good" }));
  const d = loadDraft("a1", "mound");
  assert.equal(d.date, TODAY);
  assert.equal(d.notes, "felt good");
});

test("a leftover draft with a number in it keeps its own date and its numbers", () => {
  saveDraft("a1", "mound", draft({ throws: { m5: ["", "92.1", "", "", ""] } }));
  const d = loadDraft("a1", "mound");
  assert.equal(d.date, STALE, "unsaved numbers must stay dated the day they were typed");
  assert.deepEqual(d.throws, { m5: ["", "92.1", "", "", ""] });
});

test("a number in the 80% box alone also counts as an entry", () => {
  saveDraft("a1", "mound", draft({ throws: { m5: ["80", "", "", "", ""] } }));
  assert.equal(loadDraft("a1", "mound").date, STALE);
});

test("a zero typed into a box is a number, not blank", () => {
  saveDraft("a1", "mound", draft({ throws: { m5: ["", "0", "", "", ""] } }));
  assert.equal(loadDraft("a1", "mound").date, STALE);
});

test("editing an existing session keeps that session's date even with no numbers", () => {
  saveDraft("a1", "mound", draft({ editingId: "sess-9" }));
  const d = loadDraft("a1", "mound");
  assert.equal(d.date, STALE);
  assert.equal(d.editingId, "sess-9");
});

test("a draft saved today without numbers is still today", () => {
  saveDraft("a1", "mound", draft({ date: TODAY }));
  assert.equal(loadDraft("a1", "mound").date, TODAY);
});

test("each athlete and tracker is judged on its own draft", () => {
  saveDraft("a1", "mound", draft({ throws: { m5: ["", "90", "", "", ""] } }));
  saveDraft("a2", "mound", draft());
  saveDraft("a1", "pulldown", draft());
  assert.equal(loadDraft("a1", "mound").date, STALE);
  assert.equal(loadDraft("a2", "mound").date, TODAY);
  assert.equal(loadDraft("a1", "pulldown").date, TODAY);
});

test("a saved entry with numbers but no date falls back to today", () => {
  saveDraft("a1", "mound", draft({ date: "", throws: { m5: ["", "92.1", "", "", ""] } }));
  const d = loadDraft("a1", "mound");
  assert.equal(d.date, TODAY);
  assert.deepEqual(d.throws, { m5: ["", "92.1", "", "", ""] });
});

test("a corrupt saved draft falls back to a fresh one on today", () => {
  window.localStorage.setItem("veloladder:draft:a1:mound", "{not json");
  assert.equal(loadDraft("a1", "mound").date, TODAY);
});
