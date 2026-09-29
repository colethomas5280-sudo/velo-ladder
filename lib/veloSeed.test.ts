import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VELO_SEED_SQL,
  hasNoBand,
  q,
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
 * These tests pin the SHAPE and the invariants, never the values and never the
 * totals. The data is Cole's and grows: a re-export that adds a source or fills
 * in a MiLB row is a good change, and a test that fails on it is a test that
 * teaches him to distrust the suite.
 * ------------------------------------------------------------------ */

test("the snapshot holds sources and ranges, each with a unique slug", () => {
  assert.ok(veloSeedData.sources.length > 0, "no sources in the snapshot");
  assert.ok(veloSeedData.ranges.length > 0, "no ranges in the snapshot");
  // Not a count: a slug seen twice is two rows fighting over one primary key,
  // and the upsert would silently keep whichever came last.
  const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
  assert.deepEqual(dupes(veloSeedData.sources.map((s) => s.slug)), []);
  assert.deepEqual(dupes(veloSeedData.ranges.map((r) => r.slug)), []);
});

test("a row with no band of any kind has no confidence either", () => {
  /*
   * Not WHICH rows, and not how many. Today it is Independent Pro and the three
   * MiLB tiers; the day Cole sources pro-level data that list shrinks, and that
   * must not fail a build. What has to hold is the rule the loader and the page
   * lean on: a level with no band reads "No data yet", and a level that reads
   * "No data yet" claims no confidence, so it cannot look sourced.
   */
  const empty = veloSeedData.ranges.filter(hasNoBand);
  for (const r of empty)
    assert.equal(r.confidence, null, `${r.slug} has no band but carries a confidence`);
});

test("every range's sources exist", () => {
  const known = new Set(veloSeedData.sources.map((s) => s.slug));
  for (const r of veloSeedData.ranges)
    for (const slug of r.source_slugs)
      assert.ok(known.has(slug), `${r.slug} cites '${slug}', which is not a source`);
});

test("display order is unique, so the ladder has one order and not a tie", () => {
  const orders = veloSeedData.ranges.map((r) => r.display_order);
  for (const o of orders)
    assert.ok(Number.isInteger(o) && o > 0, `display_order ${o} is not a positive integer`);
  // Unique, not gap-free: new rows are appended after the last, and a gap harms nothing.
  assert.equal(new Set(orders).size, orders.length, "two rows share a display_order");
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

test("the escaper doubles every apostrophe and quotes plainly", () => {
  /*
   * Tested directly. The earlier versions of this were anchored to one note's
   * wording, so a re-export that reworded that note would fail a test that had
   * nothing to say about the change, and a version that counted quote marks
   * passed with the escaping deleted entirely.
   */
  assert.equal(q("it's"), "'it''s'");
  assert.equal(q("a'b'c"), "'a''b''c'");
  assert.equal(q("no quote"), "'no quote'");
  assert.equal(q(""), "''");
  assert.equal(q(null), "NULL");
  // A string of nothing but apostrophes is the case a sloppy replace gets wrong.
  assert.equal(q("''"), "''''''");
});

test("every apostrophe in the real snapshot reaches the SQL escaped", () => {
  /*
   * The data-driven half: whatever text is in the file today, wherever an
   * apostrophe appears, the generated SQL holds the doubled form and never the
   * raw one. A window of a few characters either side, so it cannot be
   * satisfied by an unrelated apostrophe elsewhere. Visits zero fields if the
   * snapshot ever has no apostrophes, which is fine: the direct test above
   * still holds the escaper to account.
   */
  const texts: string[] = [];
  for (const r of veloSeedData.ranges) texts.push(r.level, r.category, r.notes);
  for (const s of veloSeedData.sources)
    texts.push(s.title, s.author, s.data_type, s.limitations_summary);
  for (const text of texts) {
    const i = text.indexOf("'");
    if (i < 0) continue;
    const raw = text.slice(Math.max(0, i - 4), i + 5);
    const escaped = raw.replace(/'/g, "''");
    assert.ok(VELO_SEED_SQL.includes(escaped), `apostrophe not doubled near "${raw}"`);
    assert.ok(!VELO_SEED_SQL.includes(raw), `a raw apostrophe reached the SQL near "${raw}"`);
  }
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
