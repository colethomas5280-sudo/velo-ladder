import { test } from "node:test";
import assert from "node:assert/strict";
import { VELO_SEED_SQL, veloSeedData, veloSnapshotDate } from "@/lib/veloSeed";

/* ------------------------------------------------------------------ *
 * The benchmark snapshot
 *
 * Notion is the source of truth; this is a snapshot of it. The seed is an
 * idempotent upsert by slug, so re-running with a newer export updates rows
 * in place rather than duplicating them.
 *
 * These tests pin the SHAPE and the counts, never the values. The values are
 * Cole's and are not code's to assert.
 * ------------------------------------------------------------------ */

test("the snapshot holds every source and range the spec counted", () => {
  assert.equal(veloSeedData.sources.length, 11);
  assert.equal(veloSeedData.ranges.length, 25);
});

test("four rows have no data yet, and they are the pro tiers", () => {
  /*
   * Independent Pro and the three MiLB rows. These must render "No data yet",
   * never 0 and never blank, so the loader has to be able to tell a missing
   * band from a zero one.
   */
  const empty = veloSeedData.ranges.filter(
    (r) => r.combined_low === null && r.rhp_low === null && r.lhp_low === null,
  );
  assert.deepEqual(
    empty.map((r) => r.slug).sort(),
    ["independent-pro", "milb-aaa", "milb-high-a-aa", "milb-rookie-low-a"],
  );
  for (const r of empty) assert.equal(r.confidence, null);
});

test("every range's sources exist", () => {
  const known = new Set(veloSeedData.sources.map((s) => s.slug));
  for (const r of veloSeedData.ranges)
    for (const slug of r.source_slugs)
      assert.ok(known.has(slug), `${r.slug} cites '${slug}', which is not a source`);
});

test("display order is unique and complete", () => {
  const orders = veloSeedData.ranges.map((r) => r.display_order).sort((a, b) => a - b);
  assert.deepEqual(orders, Array.from({ length: 25 }, (_, i) => i + 1));
});

test("row types are only the three the spec defines", () => {
  for (const r of veloSeedData.ranges)
    assert.ok(["primary", "anchor", "secondary"].includes(r.row_type), r.slug);
});

test("the seed upserts by slug rather than inserting blindly", () => {
  assert.match(VELO_SEED_SQL, /INSERT INTO velo_sources[\s\S]*?ON CONFLICT \(slug\) DO UPDATE/);
  assert.match(VELO_SEED_SQL, /INSERT INTO velo_ranges[\s\S]*?ON CONFLICT \(slug\) DO UPDATE/);
});

test("the seed deletes nothing", () => {
  /*
   * The spec is explicit: do not remove rows missing from the file unless a
   * prune flag is passed, and there is no prune flag. A DELETE here would
   * silently drop a row Cole had added in Notion and not yet re-exported.
   */
  assert.ok(!/DELETE FROM velo_/i.test(VELO_SEED_SQL));
});

test("an apostrophe in the source text does not break the SQL", () => {
  /*
   * The notes contain "50-55 is right on track" with quotes, and several rows
   * use apostrophes. Naive concatenation produces SQL that will not parse.
   */
  assert.ok(VELO_SEED_SQL.includes("right on track"));
});

test("an apostrophe in a note is escaped, not passed through raw", () => {
  /*
   * A prior version of this test only counted total `'` characters in
   * VELO_SEED_SQL and asserted the count was even. That passes whether or not
   * q() escapes anything at all: the JSON has an even number of apostrophes
   * (18), and both "each one doubled" and "each one left alone" sum to even.
   * Deleting q()'s .replace() entirely would still have passed it.
   *
   * This anchors to one real row instead. gobig-tier-1's note contains
   * "source's own prose" verbatim; the generated SQL must contain the
   * doubled-quote form "source''s own prose" and must NOT contain the raw,
   * single-quote form anywhere, because a raw apostrophe there terminates the
   * string literal early and either breaks the statement or truncates it.
   */
  const row = veloSeedData.ranges.find((r) => r.slug === "gobig-tier-1");
  assert.ok(row, "fixture row gobig-tier-1 is missing from the snapshot");
  assert.ok(
    row!.notes.includes("source's own prose"),
    "fixture note changed underneath this test; pick a different apostrophe to anchor on",
  );
  assert.ok(
    VELO_SEED_SQL.includes("source''s own prose"),
    "the apostrophe in gobig-tier-1's note was not doubled for SQL",
  );
  assert.ok(
    !VELO_SEED_SQL.includes("source's own prose"),
    "a raw, unescaped apostrophe reached the generated SQL",
  );
});

test("the snapshot date is exposed for the UI to show", () => {
  assert.equal(veloSnapshotDate(), "2026-09-28");
});
