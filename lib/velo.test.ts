import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKERS,
  ALL_SLOT_KEYS,
  slotKeysFor,
  EMPTY,
  num,
  mean,
  fmt,
  fmtDate,
  fmtDateShort,
  sBest,
  sAvg,
  hundredsG,
  sBestG,
  sAvgG,
  sMinG,
  recStatsG,
  gid,
  groupById,
  groupOf,
  fiveOzPR,
  lastBest,
  prWithDate,
  sessionsOfType,
  validateSessionInput,
  throwsFromDraft,
  sessionsToCsv,
} from "@/lib/velo";
import type { Throws, TrackerId, TrainingSession } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * Throw arrays are [80% primer, 100% #1, #2, #3, #4]. The primer is never
 * scored, so almost every test below puts a deliberately huge number in
 * index 0 — if it ever leaks into a stat, the assertion fails loudly.
 * ------------------------------------------------------------------ */

const S = (
  id: string,
  date: string,
  type: TrackerId,
  throws: Throws,
): TrainingSession =>
  ({ id, athleteId: "a1", type, date, notes: "", level: null, throws }) as TrainingSession;

/* ------------------------------------------------------------------ *
 * num / mean / fmt
 * ------------------------------------------------------------------ */

test("num accepts positive numbers and rejects everything else", () => {
  assert.equal(num(94.5), 94.5);
  assert.equal(num("94.5"), 94.5);
  assert.equal(num(0), null, "zero is not a velocity");
  assert.equal(num(-5), null);
  assert.equal(num(""), null);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num("abc"), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
});

test("mean is null on an empty set rather than NaN", () => {
  assert.equal(mean([]), null);
  assert.equal(mean([90, 92, 94]), 92);
});

test("fmt shows at most one decimal and drops a trailing .0", () => {
  assert.equal(fmt(87), "87");
  assert.equal(fmt(87.0), "87");
  assert.equal(fmt(84.3), "84.3");
  assert.equal(fmt(94.85), "94.9");
  assert.equal(fmt(94.95), "95");
});

test("fmt renders a missing velocity as the en-dash placeholder", () => {
  assert.equal(fmt(null), EMPTY);
  assert.equal(fmt(undefined), EMPTY);
  assert.equal(fmt(Infinity), EMPTY);
});

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

test("fmtDate keeps the calendar day it was given", () => {
  // Built in local time on purpose. Parsing as UTC and rendering locally is
  // how a session logged on the 5th starts displaying as the 4th.
  const out = fmtDate("2026-08-05");
  assert.match(out, /\b5\b/);
  assert.match(out, /2026/);
});

test("fmtDate and fmtDateShort pass unparseable input straight through", () => {
  assert.equal(fmtDate(""), "");
  assert.equal(fmtDate("2026-08"), "2026-08");
  assert.equal(fmtDateShort(""), "");
  assert.equal(fmtDateShort("2026-08"), "2026-08");
});

test("a three-part non-numeric string renders as literal junk", () => {
  // Documented, not endorsed. The guard counts hyphen-separated parts rather
  // than checking they are numbers, so "a-b-c" gets past it and reaches the
  // Date constructor. Unreachable through the app — every caller is fed a
  // date column out of Postgres — but it is what these would print if one
  // ever arrived.
  assert.equal(fmtDate("a-b-c"), "Invalid Date");
  assert.equal(fmtDateShort("a-b-c"), "NaN/NaN");
});

test("fmtDateShort strips leading zeros", () => {
  assert.equal(fmtDateShort("2026-08-05"), "8/5");
  assert.equal(fmtDateShort("2026-12-25"), "12/25");
});

/* ------------------------------------------------------------------ *
 * The 80% primer is never scored
 * ------------------------------------------------------------------ */

test("sBest and sAvg ignore the 80% primer in index 0", () => {
  const s = S("s1", "2026-08-01", "pulldown", { p1: [999, 90, 92, 94] });
  assert.equal(sBest(s, "p1"), 94);
  assert.equal(sAvg(s, "p1"), 92);
});

test("stats read whatever length the array is, 4 boxes or 5", () => {
  const four = S("s1", "2026-08-01", "pulldown", { p1: [999, 90, 92, 94] });
  const five = S("s2", "2026-08-02", "pulldown", { p1: [999, 90, 92, 94, 96] });
  assert.equal(sBest(four, "p1"), 94);
  assert.equal(sBest(five, "p1"), 96);
});

test("a blank or missing slot yields null, not zero", () => {
  const s = S("s1", "2026-08-01", "pulldown", { p1: [999, null, null, null] });
  assert.equal(sBest(s, "p1"), null);
  assert.equal(sAvg(s, "p1"), null);
  assert.equal(sBest(s, "p2"), null);
});

test("a primer with no scored throws behind it contributes nothing", () => {
  const s = S("s1", "2026-08-01", "pulldown", { p1: [80, null, null, null] });
  assert.equal(sBest(s, "p1"), null);
  assert.deepEqual(hundredsG([s], ["p1"]), []);
});

/* ------------------------------------------------------------------ *
 * Group folding — the combined 5 oz record
 * ------------------------------------------------------------------ */

test("sBestG folds every slot in the group into one record", () => {
  const s = S("s1", "2026-08-01", "pulldown", {
    p1: [999, 93.4, 93.5, 94.5],
    p4: [999, 92.1, 93.1, 90.6],
  });
  assert.equal(sBestG(s, ["p1", "p4"]), 94.5);
  assert.equal(sMinG(s, ["p1", "p4"]), 90.6);
});

test("sAvgG pools the throws rather than averaging the two averages", () => {
  // p1 averages 100, p4 averages 91. Averaging those gives 95.5; pooling the
  // six actual throws gives 94. Pooling is right — the sets differ in size in
  // real sessions, and a half-finished set should not carry equal weight.
  const s = S("s1", "2026-08-01", "pulldown", {
    p1: [999, 100, 100, 100],
    p4: [999, 90, 91, 92],
  });
  assert.equal(sAvgG(s, ["p1", "p4"]), 95.5);

  const uneven = S("s2", "2026-08-02", "pulldown", {
    p1: [999, 100, 100, 100],
    p4: [999, 88, null, null],
  });
  assert.equal(sAvgG(uneven, ["p1", "p4"]), 97);
});

test("group stats skip slots the session never recorded", () => {
  const s = S("s1", "2026-08-01", "pulldown", { p1: [999, 90, 92, 94] });
  assert.equal(sBestG(s, ["p1", "p4"]), 94);
  assert.equal(sAvgG(s, ["p1", "p4"]), 92);
});

test("recStatsG reports count, PR, average and floor across sessions", () => {
  const a = S("s1", "2026-08-01", "pulldown", { p1: [999, 90, 92] });
  const b = S("s2", "2026-08-08", "pulldown", { p4: [999, 88, 96] });
  assert.deepEqual(recStatsG([a, b], ["p1", "p4"]), {
    n: 4,
    pr: 96,
    avg: 91.5,
    min: 88,
  });
});

test("recStatsG on no data is empty rather than zero", () => {
  assert.deepEqual(recStatsG([], ["p1", "p4"]), {
    n: 0,
    pr: null,
    avg: null,
    min: null,
  });
});

test("fiveOzPR folds both 5 oz sets in each tracker", () => {
  const pull = S("s1", "2026-08-01", "pulldown", {
    p1: [999, 93],
    p4: [999, 95],
  });
  assert.equal(fiveOzPR([pull], "pulldown"), 95);

  const mound = S("s2", "2026-08-01", "mound", {
    m5: [999, 88],
    m5b: [999, 91],
  });
  assert.equal(fiveOzPR([mound], "mound"), 91);
});

test("a mound session logged before m5b existed still reads correctly", () => {
  const legacy = S("s1", "2026-08-01", "mound", { m5: [999, 88, 90] });
  assert.equal(fiveOzPR([legacy], "mound"), 90);
});

/* ------------------------------------------------------------------ *
 * Group identity
 * ------------------------------------------------------------------ */

test("gid joins a group's slots into one stable id", () => {
  assert.equal(gid({ oz: 5, keys: ["p1", "p4"] }), "p1+p4");
});

test("groupById falls back to the first group on an unknown id", () => {
  const cfg = TRACKERS.pulldown;
  assert.deepEqual(groupById(cfg, "p1+p4"), { oz: 5, keys: ["p1", "p4"] });
  assert.deepEqual(groupById(cfg, "nonsense"), cfg.groups[0]);
  assert.deepEqual(groupById(cfg, undefined), cfg.groups[0]);
});

test("groupOf finds the group holding a slot, or invents a lone one", () => {
  const cfg = TRACKERS.pulldown;
  assert.deepEqual(groupOf(cfg, "p4"), { oz: 5, keys: ["p1", "p4"] });
  assert.deepEqual(groupOf(cfg, "zz"), { oz: 0, keys: ["zz"] });
});

test("every tracker group only references slots that tracker declares", () => {
  for (const id of Object.keys(TRACKERS) as TrackerId[]) {
    const slots = slotKeysFor(id);
    for (const g of TRACKERS[id].groups)
      for (const k of g.keys)
        assert.ok(slots.has(k), `${id} group ${gid(g)} references unknown slot ${k}`);
  }
});

test("every slot belongs to exactly one group", () => {
  for (const id of Object.keys(TRACKERS) as TrackerId[]) {
    for (const s of TRACKERS[id].slots) {
      const owning = TRACKERS[id].groups.filter((g) => g.keys.includes(s.key));
      assert.equal(owning.length, 1, `${id} slot ${s.key} is in ${owning.length} groups`);
      assert.equal(owning[0].oz, s.oz, `${id} slot ${s.key} oz disagrees with its group`);
    }
  }
});

test("ALL_SLOT_KEYS is the union of both trackers", () => {
  assert.equal(ALL_SLOT_KEYS.size, 12);
  assert.ok(ALL_SLOT_KEYS.has("m5b"));
  assert.ok(ALL_SLOT_KEYS.has("p4"));
});

/* ------------------------------------------------------------------ *
 * lastBest / prWithDate / sessionsOfType
 * ------------------------------------------------------------------ */

test("lastBest reads the most recent session that has a number", () => {
  const s = [
    S("s1", "2026-08-01", "pulldown", { p1: [999, 90] }),
    S("s2", "2026-08-08", "pulldown", { p1: [999, 94] }),
    S("s3", "2026-08-15", "pulldown", { p2: [999, 88] }),
  ];
  assert.deepEqual(lastBest(s, ["p1"]), { value: 94, date: "2026-08-08" });
});

test("lastBest skips the session being edited", () => {
  // Otherwise the entry form shows you your own in-progress numbers as the
  // target you are trying to beat.
  const s = [
    S("s1", "2026-08-01", "pulldown", { p1: [999, 90] }),
    S("s2", "2026-08-08", "pulldown", { p1: [999, 94] }),
  ];
  assert.deepEqual(lastBest(s, ["p1"], "s2"), { value: 90, date: "2026-08-01" });
});

test("lastBest is null when nothing in range has a number", () => {
  assert.equal(lastBest([], ["p1"]), null);
  const blank = [S("s1", "2026-08-01", "pulldown", { p1: [80, null] })];
  assert.equal(lastBest(blank, ["p1"]), null);
});

test("prWithDate gives a tie to the day it was first reached", () => {
  const s = [
    S("s1", "2026-08-01", "pulldown", { p1: [999, 94] }),
    S("s2", "2026-08-20", "pulldown", { p1: [999, 94] }),
  ];
  assert.deepEqual(prWithDate(s, ["p1"]), { value: 94, date: "2026-08-01" });
});

test("prWithDate is order-independent", () => {
  const a = S("s1", "2026-08-01", "pulldown", { p1: [999, 90] });
  const b = S("s2", "2026-08-20", "pulldown", { p1: [999, 96] });
  assert.deepEqual(prWithDate([a, b], ["p1"]), prWithDate([b, a], ["p1"]));
  assert.deepEqual(prWithDate([b, a], ["p1"]), { value: 96, date: "2026-08-20" });
});

test("sessionsOfType filters by tracker and sorts oldest first", () => {
  const s = [
    S("s3", "2026-08-15", "pulldown", { p1: [999, 90] }),
    S("s1", "2026-08-01", "mound", { m5: [999, 90] }),
    S("s2", "2026-08-08", "pulldown", { p1: [999, 90] }),
  ];
  assert.deepEqual(
    sessionsOfType(s, "pulldown").map((x) => x.id),
    ["s2", "s3"],
  );
  assert.deepEqual(
    sessionsOfType(s, "mound").map((x) => x.id),
    ["s1"],
  );
});

test("two sessions on the same date sort by id, not by insertion order", () => {
  const s = [
    S("sB", "2026-08-08", "pulldown", { p1: [999, 90] }),
    S("sA", "2026-08-08", "pulldown", { p1: [999, 90] }),
  ];
  assert.deepEqual(
    sessionsOfType(s, "pulldown").map((x) => x.id),
    ["sA", "sB"],
  );
});

/* ------------------------------------------------------------------ *
 * validateSessionInput — the server-side write guard
 * ------------------------------------------------------------------ */

const ok = (over: Record<string, unknown> = {}) =>
  validateSessionInput({
    type: "pulldown",
    date: "2026-08-01",
    throws: { p1: [80, 90, 92, 94] },
    ...over,
  });

test("a well-formed session is accepted", () => {
  const r = ok();
  assert.equal(r.ok, true);
  assert.deepEqual(r.value!.throws, { p1: [80, 90, 92, 94] });
});

test("validateSessionInput rejects a body that is not an object", () => {
  for (const bad of [null, undefined, "x", 5, true])
    assert.equal(validateSessionInput(bad).ok, false);
});

test("validateSessionInput rejects an unknown tracker", () => {
  assert.equal(ok({ type: "bullpen" }).ok, false);
  assert.equal(ok({ type: undefined }).ok, false);
});

test("validateSessionInput requires a YYYY-MM-DD date", () => {
  assert.equal(ok({ date: "8/1/2026" }).ok, false);
  assert.equal(ok({ date: "2026-8-1" }).ok, false);
  assert.equal(ok({ date: "" }).ok, false);
});

test("a mound slot is refused on a pulldown session", () => {
  // The tracker's own slot list is the allow-list, so a client cannot smuggle
  // throws into a column that tracker does not have.
  const r = validateSessionInput({
    type: "pulldown",
    date: "2026-08-01",
    throws: { m5: [80, 90, 92, 94] },
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /unknown slot 'm5' for pulldown/);
});

test("throw arrays must hold 4 or 5 boxes", () => {
  assert.equal(ok({ throws: { p1: [80, 90, 92] } }).ok, false);
  assert.equal(ok({ throws: { p1: [80, 90, 92, 94, 96, 98] } }).ok, false);
  assert.equal(ok({ throws: { p1: [80, 90, 92, 94, 96] } }).ok, true);
  assert.equal(ok({ throws: { p1: "90,92,94" } }).ok, false);
});

test("out-of-range velocities are blanked, not accepted", () => {
  const r = ok({ throws: { p1: [80, 131, 0, -5, 94] } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value!.throws.p1, [80, null, null, null, 94]);
});

test("130 is allowed and 131 is not", () => {
  assert.deepEqual(ok({ throws: { p1: [80, 130, null, null] } }).value!.throws.p1, [
    80, 130, null, null,
  ]);
  assert.equal(ok({ throws: { p1: [80, 131, null, null] } }).ok, false);
});

test("a session needs at least one 100% throw", () => {
  // A primer on its own is not a session. This mirrors the client guard.
  const primerOnly = ok({ throws: { p1: [80, null, null, null] } });
  assert.equal(primerOnly.ok, false);
  assert.match(primerOnly.error!, /at least one 100% throw/);
});

test("slots with nothing in them are dropped from the stored payload", () => {
  const r = ok({ throws: { p1: [80, 90, 92, 94], p2: [null, null, null, null] } });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value!.throws), ["p1"]);
});

test("notes are capped rather than rejected", () => {
  const r = ok({ notes: "x".repeat(3000) });
  assert.equal(r.value!.notes!.length, 2000);
  assert.equal(ok({ notes: 12345 }).value!.notes, "");
});

test("the date check is format-only, not a calendar check", () => {
  // Documented, not endorsed: "2026-13-45" is the right shape, so it passes
  // here and is refused later by the date column in Postgres.
  assert.equal(ok({ date: "2026-13-45" }).ok, true);
});

/* ------------------------------------------------------------------ *
 * throwsFromDraft
 * ------------------------------------------------------------------ */

test("throwsFromDraft turns typed strings into numbers", () => {
  const r = throwsFromDraft({ p1: ["80", "90", "92", "94"] }, ["p1", "p2"]);
  assert.deepEqual(r.throws.p1, [80, 90, 92, 94, null]);
  assert.equal(r.hasHundred, true);
});

test("throwsFromDraft drops slots the athlete never touched", () => {
  const r = throwsFromDraft({ p1: ["", "", "", ""] }, ["p1", "p2"]);
  assert.deepEqual(r.throws, {});
  assert.equal(r.hasHundred, false);
});

test("throwsFromDraft does not count a lone primer as a real throw", () => {
  const r = throwsFromDraft({ p1: ["80", "", "", ""] }, ["p1"]);
  assert.deepEqual(Object.keys(r.throws), ["p1"]);
  assert.equal(r.hasHundred, false);
});

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */

test("sessionsToCsv emits a header and one row per recorded slot", () => {
  const s = [
    S("s1", "2026-08-01", "pulldown", { p1: [80, 90, 92, 94], p2: [78, 88] }),
  ];
  const lines = sessionsToCsv("Martin Duff", s).split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^athlete,date,tracker,weight_oz,slot,/);
  assert.equal(lines[1], "Martin Duff,2026-08-01,pulldown,5,p1,80,90,92,94,,94,92");
});

test("sessionsToCsv omits slots with no throws", () => {
  const s = [S("s1", "2026-08-01", "pulldown", { p1: [80, 90, 92, 94] })];
  assert.equal(sessionsToCsv("A", s).split("\n").length, 2);
});

test("sessionsToCsv quotes fields containing commas, quotes or newlines", () => {
  const s = [S("s1", "2026-08-01", "pulldown", { p1: [80, 90, 92, 94] })];
  const row = sessionsToCsv('Smith, John "JD"', s).split("\n")[1];
  assert.ok(row.startsWith('"Smith, John ""JD"""'), row);
});

test("sessionsToCsv groups mound rows before pulldown rows", () => {
  const s = [
    S("s1", "2026-08-01", "pulldown", { p1: [80, 90, 92, 94] }),
    S("s2", "2026-08-02", "mound", { m5: [80, 88, 89, 90] }),
  ];
  const trackers = sessionsToCsv("A", s)
    .split("\n")
    .slice(1)
    .map((r) => r.split(",")[2]);
  assert.deepEqual(trackers, ["mound", "pulldown"]);
});

test("an empty roster still produces a usable header row", () => {
  const csv = sessionsToCsv("A", []);
  assert.equal(csv.split("\n").length, 1);
  assert.match(csv, /^athlete,date,tracker/);
});
