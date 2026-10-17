import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, type Draft } from "./draft";
import { fmtDate, todayISO } from "./velo";
import {
  summarizeDraft,
  sessionTitle,
  sessionLine,
  groupTitle,
  groupLine,
} from "./saveSummary";

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => mock.timers.reset());

const draft = (over: Partial<Draft> = {}): Draft => ({
  date: "2026-10-10",
  notes: "",
  throws: {},
  editingId: null,
  ...over,
});

/* ---- the best throw ---- */

test("best is the highest 100% throw across every slot", () => {
  const s = summarizeDraft(
    draft({ throws: { m5: ["", "88", "90", "", ""], m6: ["", "", "", "93.4", "91"], m7: ["", "89", "", "", ""] } }),
    "mound",
  );
  assert.equal(s?.best, 93.4);
});

test("the 80% primer box is never the best, even when it is the biggest number", () => {
  const s = summarizeDraft(draft({ throws: { m5: ["99", "88", "", "", ""] } }), "mound");
  assert.equal(s?.best, 88);
});

test("a draft with only a primer has no 100% throw", () => {
  assert.equal(summarizeDraft(draft({ throws: { m5: ["95", "", "", "", ""] } }), "mound"), null);
});

test("blank, zero, whitespace and non-numeric boxes are ignored", () => {
  const s = summarizeDraft(
    draft({ throws: { m5: ["", " ", "0", "abc", "."], m6: ["", "", "", "", "84"] } }),
    "mound",
  );
  assert.equal(s?.best, 84);
});

test("null when nothing is entered at all", () => {
  assert.equal(summarizeDraft(emptyDraft(), "mound"), null);
  assert.equal(summarizeDraft(draft({ throws: { m5: ["", "", "", "", ""] } }), "mound"), null);
});

test("only the slots of the chosen tracker count", () => {
  const d = draft({ throws: { p1: ["", "97", "", "", ""], m5: ["", "80", "", "", ""] } });
  assert.equal(summarizeDraft(d, "mound")?.best, 80);
  assert.equal(summarizeDraft(d, "pulldown")?.best, 97);
  assert.equal(summarizeDraft(draft({ throws: { p1: ["", "97", "", "", ""] } }), "mound"), null);
});

/* ---- the date ---- */

test("the date is the draft's own date", () => {
  const s = summarizeDraft(draft({ date: "2026-09-01", throws: { m5: ["", "90", "", "", ""] } }), "mound");
  assert.equal(s?.date, "2026-09-01");
});

test("a draft with no date falls back to today, the way the post does", () => {
  const s = summarizeDraft(draft({ date: "", throws: { m5: ["", "90", "", "", ""] } }), "mound");
  assert.equal(s?.date, todayISO());
  assert.equal(s?.date, "2026-10-16");
});

/* ---- editing ---- */

test("the editing flag follows editingId", () => {
  const throws = { m5: ["", "90", "", "", ""] };
  assert.equal(summarizeDraft(draft({ throws }), "mound")?.editing, false);
  assert.equal(summarizeDraft(draft({ throws, editingId: "s1" }), "mound")?.editing, true);
});

/* ---- wording ---- */

const base = { tracker: "mound" as const, date: "2026-10-16", best: 94.46, editing: false };

test("single titles say Save, or Update when editing", () => {
  assert.equal(sessionTitle("Jake Bell", false), "Save Jake Bell's session?");
  assert.equal(sessionTitle("Jake Bell", true), "Update Jake Bell's session?");
});

test("the single line names the tracker, the date and the best", () => {
  assert.equal(sessionLine(base), `Mound · ${fmtDate("2026-10-16")} · best 100% throw 94.5 mph`);
  assert.equal(
    sessionLine({ ...base, tracker: "pulldown", best: 87 }),
    `Pull-Down · ${fmtDate("2026-10-16")} · best 100% throw 87 mph`,
  );
});

test("the group title is singular for one", () => {
  assert.equal(groupTitle(1), "Save 1 session?");
  assert.equal(groupTitle(3), "Save 3 sessions?");
});

test("a group line is name, date and best", () => {
  assert.equal(groupLine("Jake Bell", base), `Jake Bell · ${fmtDate("2026-10-16")} · 94.5 mph`);
});

test("no copy uses an em dash or an en dash", () => {
  const all = [
    sessionTitle("A B", true),
    sessionLine(base),
    groupTitle(2),
    groupLine("A B", base),
  ].join("");
  assert.ok(!/[–—]/.test(all));
});
