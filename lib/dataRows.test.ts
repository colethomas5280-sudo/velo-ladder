import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, toScreen } from "@/lib/data";

/* ------------------------------------------------------------------ *
 * Row mappers
 *
 * The two drivers disagree about DATE: node-postgres hands back a string
 * because we install a type parser, PGlite hands back a Date. Anything that
 * reaches the UI as a date has to survive both, and `String(row.date)` on the
 * PGlite side yields "Tue Sep 08 2026 18:00:00 GMT-0600" — which no date
 * input accepts, and which names the previous day west of Greenwich.
 * ------------------------------------------------------------------ */

test("a date column arrives as YYYY-MM-DD whichever driver produced it", () => {
  assert.equal(isoDate("2026-09-09"), "2026-09-09", "postgres: already a string");
  assert.equal(
    isoDate(new Date("2026-09-09T00:00:00Z")),
    "2026-09-09",
    "pglite: a Date at UTC midnight",
  );
});

test("a screen row keeps the day it was recorded on", () => {
  const row = {
    id: "s1",
    athlete_id: "a1",
    date: new Date("2026-09-09T00:00:00Z"),
    results: { "hip-45.45-degree-angle:L": "good" },
    notes: "guarding",
  };
  assert.equal(toScreen(row).date, "2026-09-09");
});

test("a screen row reads the same from either driver", () => {
  const base = { id: "s1", athlete_id: "a1", results: {}, notes: "" };
  assert.deepEqual(
    toScreen({ ...base, date: new Date("2026-09-09T00:00:00Z") }),
    toScreen({ ...base, date: "2026-09-09" }),
  );
});

test("a screen with no findings yet reads as empty, not undefined", () => {
  const s = toScreen({ id: "s1", athlete_id: "a1", date: "2026-09-09", results: null, notes: null });
  assert.deepEqual(s.results, {});
  assert.equal(s.notes, "");
});
