import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VELO_SEED_SQL,
  hasNoBand,
  veloWarnings,
  missingSeedVelo,
  veloSeedData,
  veloSnapshotDate,
} from "@/lib/veloSeed";

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


/* ------------------------------------------------------------------ *
 * What setup can say about the seed
 * ------------------------------------------------------------------ */

const allRanges = veloSeedData.ranges.map((r) => r.slug);
const allSources = veloSeedData.sources.map((s) => s.slug);

test("nothing is missing when every seeded row is present", () => {
  assert.deepEqual(missingSeedVelo(allRanges, allSources), { ranges: [], sources: [] });
});

test("a level absent from the database is named, and only that one", () => {
  const got = missingSeedVelo(allRanges.filter((s) => s !== "juco"), allSources);
  assert.deepEqual(got.ranges, ["juco"]);
  assert.deepEqual(got.sources, []);
});

test("a source absent from the database is named, and only that one", () => {
  const got = missingSeedVelo(allRanges, allSources.filter((s) => s !== "coleman-how-hard"));
  assert.deepEqual(got.sources, ["coleman-how-hard"]);
  assert.deepEqual(got.ranges, []);
});

test("an empty database is missing everything, in seed order", () => {
  const got = missingSeedVelo([], []);
  assert.equal(got.ranges.length, veloSeedData.ranges.length);
  assert.equal(got.sources.length, veloSeedData.sources.length);
  assert.deepEqual(got.ranges, allRanges);
});

test("an EXTRA row in the database is not reported as missing", () => {
  /*
   * The seed deletes nothing, so a row left over from an older export is
   * expected and harmless. Only what the seed expects and the table lacks is
   * a failure to land.
   */
  assert.deepEqual(missingSeedVelo([...allRanges, "retired-level"], allSources), {
    ranges: [],
    sources: [],
  });
});

test("hasNoBand is true only when no band of any kind exists", () => {
  assert.equal(hasNoBand({ rhp_low: null, lhp_low: null, combined_low: null }), true);
  assert.equal(hasNoBand({ rhp_low: 82, lhp_low: null, combined_low: null }), false);
  assert.equal(hasNoBand({ rhp_low: null, lhp_low: 80, combined_low: null }), false);
  assert.equal(hasNoBand({ rhp_low: null, lhp_low: null, combined_low: 69 }), false);
  // A band whose low is 0 is still a band, on EACH of the three. Null is the
  // only "no data". Tested per band because a check that treated zero as empty
  // on just one of them is exactly the slip that passed review once.
  assert.equal(hasNoBand({ rhp_low: 0, lhp_low: null, combined_low: null }), false);
  assert.equal(hasNoBand({ rhp_low: null, lhp_low: 0, combined_low: null }), false);
  assert.equal(hasNoBand({ rhp_low: null, lhp_low: null, combined_low: 0 }), false);
});


const CLEAN = {
  ranges: { live: 25, expected: 25, noData: 4, expectedNoData: 4, missingSeed: [] as string[] },
  sources: { live: 11, expected: 11, missingSeed: [] as string[] },
  links: { live: 68, expected: 68 },
};

test("a clean ladder produces no warning at all", () => {
  assert.deepEqual(veloWarnings(CLEAN), []);
});

test("a missing level is named in the sentence, not only in a field", () => {
  const w = veloWarnings({ ...CLEAN, ranges: { ...CLEAN.ranges, missingSeed: ["juco", "ncaa-d2"] } });
  assert.equal(w.length, 1);
  assert.match(w[0], /2 velo level\(s\) are missing: juco, ncaa-d2/);
});

test("a missing source is named in the sentence", () => {
  const w = veloWarnings({ ...CLEAN, sources: { ...CLEAN.sources, missingSeed: ["coleman-how-hard"] } });
  assert.equal(w.length, 1);
  assert.match(w[0], /1 velo source\(s\) are missing: coleman-how-hard/);
});

test("short links are reported with both numbers", () => {
  const w = veloWarnings({ ...CLEAN, links: { live: 60, expected: 68 } });
  assert.equal(w.length, 1);
  assert.match(w[0], /Only 60 of 68/);
});

test("MORE links than expected is not a warning, because the seed deletes nothing", () => {
  assert.deepEqual(veloWarnings({ ...CLEAN, links: { live: 70, expected: 68 } }), []);
});

test("a changed count of no-data levels is reported with both numbers", () => {
  const w = veloWarnings({ ...CLEAN, ranges: { ...CLEAN.ranges, noData: 3 } });
  assert.equal(w.length, 1);
  assert.match(w[0], /3 velo level\(s\) read "No data yet" but the seed says 4/);
});

test("several problems at once each get their own sentence", () => {
  const w = veloWarnings({
    ranges: { live: 24, expected: 25, noData: 4, expectedNoData: 4, missingSeed: ["juco"] },
    sources: { live: 10, expected: 11, missingSeed: ["coleman-how-hard"] },
    links: { live: 60, expected: 68 },
  });
  assert.equal(w.length, 3);
});
