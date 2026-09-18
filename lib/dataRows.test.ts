import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, toScreen, toDeliveryScreen, reduceDeliveryOverview } from "@/lib/data";

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

test("a delivery row reads back with its marks and notes", () => {
  const d = toDeliveryScreen({
    id: "d1", athlete_id: "a1", date: "2026-01-01",
    flaws: { sway: true }, notes: "filmed from the side",
  });
  assert.deepEqual(d.flaws, { sway: true });
  assert.equal(d.notes, "filmed from the side");
  assert.equal(d.athleteId, "a1");
});

test("a delivery row with no marks is still an assessment", () => {
  const d = toDeliveryScreen({ id: "d1", athlete_id: "a1", date: "2026-01-01" });
  assert.deepEqual(d.flaws, {});
  assert.equal(d.notes, "");
});

test("an athlete never assessed reads last: null, count: 0 from the join", () => {
  /*
   * The LEFT JOIN hands back one row per athlete even when they have no
   * delivery_screens row at all — date and flaws both null on that row. The
   * `flaws` value here is one no real query would ever pair with a null
   * date, chosen deliberately: `count` must come from the guarded block, not
   * from `flaws` alone, and this is the only way to tell those apart.
   */
  const rows = reduceDeliveryOverview([
    { athlete_id: "a1", name: "Kid", phase: null, date: null, flaws: { sway: true } },
  ]);
  assert.deepEqual(rows, [{ athleteId: "a1", name: "Kid", last: null, count: 0, phase: null }]);
});

test("with two assessments, the later date wins for both last and count", () => {
  /*
   * The query orders rows `a.name, d.date` ascending, so the reducer relies
   * on "last one seen wins" to land on the most recent assessment. Two
   * different dates with different marks is the only shape that can tell
   * "took the last row" apart from "took the first" or "merged both."
   */
  const rows = reduceDeliveryOverview([
    { athlete_id: "a1", name: "Kid", phase: null, date: "2026-01-01", flaws: { sway: true } },
    {
      athlete_id: "a1",
      name: "Kid",
      phase: null,
      date: "2026-02-01",
      flaws: { sway: true, "high-hand": true },
    },
  ]);
  assert.deepEqual(rows, [
    { athleteId: "a1", name: "Kid", last: "2026-02-01", count: 2, phase: null },
  ]);
});
