import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The benchmark snapshot, and the SQL that seeds it
 *
 * SERVER ONLY. Nothing in components/ may import this file, and
 * lib/clientSafe.test.ts enforces that. The whole point of this feature is
 * that athletes never receive these numbers, and a value import into a client
 * component would ship all 25 rows to every browser that loads the app.
 *
 * Notion is the source of truth. This is a dated snapshot of it, re-exported
 * by hand. The seed upserts by slug so a newer export updates rows in place,
 * and deletes nothing: a row missing from the file is far more likely to be a
 * partial export than a deliberate removal.
 * ------------------------------------------------------------------ */

export interface VeloSourceSeed {
  slug: string;
  title: string;
  author: string;
  data_type: string;
  quality: string;
  limitations_summary: string;
  notion_url: string;
  published_date: string | null;
}

export interface VeloRangeSeed {
  slug: string;
  level: string;
  category: string;
  row_type: string;
  rhp_low: number | null;
  rhp_high: number | null;
  lhp_low: number | null;
  lhp_high: number | null;
  combined_low: number | null;
  combined_high: number | null;
  elite_trajectory_ref: number | null;
  confidence: string | null;
  source_slugs: string[];
  notes: string;
  last_updated: string | null;
  notion_url: string;
  display_order: number;
}

interface VeloSeedFile {
  meta: { snapshot_date: string };
  sources: VeloSourceSeed[];
  ranges: VeloRangeSeed[];
}

export const veloSeedData: VeloSeedFile = JSON.parse(
  readFileSync(join(process.cwd(), "db", "velo-ladder-seed-data.json"), "utf8"),
);

/** Shown in the UI as "Data snapshot", so a coach knows how old this is. */
export function veloSnapshotDate(): string {
  return veloSeedData.meta.snapshot_date;
}

/** Single-quote escaping for a SQL literal, or NULL. */
// Exported so the escaping can be tested directly, not only through whatever
// happens to be in a note this month.
export const q = (v: string | null): string =>
  v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
const n = (v: number | null): string => (v === null ? "NULL" : String(v));

const sourceRows = veloSeedData.sources
  .map(
    (s) =>
      `INSERT INTO velo_sources (slug, title, author, data_type, quality, published_date, limitations_summary, notion_url) VALUES (${q(s.slug)}, ${q(s.title)}, ${q(s.author)}, ${q(s.data_type)}, ${q(s.quality)}, ${s.published_date === null ? "NULL" : `${q(s.published_date)}::date`}, ${q(s.limitations_summary)}, ${q(s.notion_url)}) ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, author = EXCLUDED.author, data_type = EXCLUDED.data_type, quality = EXCLUDED.quality, published_date = EXCLUDED.published_date, limitations_summary = EXCLUDED.limitations_summary, notion_url = EXCLUDED.notion_url;`,
  )
  .join("\n");

const rangeRows = veloSeedData.ranges
  .map(
    (r) =>
      `INSERT INTO velo_ranges (slug, level, category, row_type, display_order, rhp_low, rhp_high, lhp_low, lhp_high, combined_low, combined_high, elite_trajectory_ref, confidence, notes, last_updated, notion_url) VALUES (${q(r.slug)}, ${q(r.level)}, ${q(r.category)}, ${q(r.row_type)}, ${r.display_order}, ${n(r.rhp_low)}, ${n(r.rhp_high)}, ${n(r.lhp_low)}, ${n(r.lhp_high)}, ${n(r.combined_low)}, ${n(r.combined_high)}, ${n(r.elite_trajectory_ref)}, ${q(r.confidence)}, ${q(r.notes)}, ${r.last_updated === null ? "NULL" : `${q(r.last_updated)}::date`}, ${q(r.notion_url)}) ON CONFLICT (slug) DO UPDATE SET level = EXCLUDED.level, category = EXCLUDED.category, row_type = EXCLUDED.row_type, display_order = EXCLUDED.display_order, rhp_low = EXCLUDED.rhp_low, rhp_high = EXCLUDED.rhp_high, lhp_low = EXCLUDED.lhp_low, lhp_high = EXCLUDED.lhp_high, combined_low = EXCLUDED.combined_low, combined_high = EXCLUDED.combined_high, elite_trajectory_ref = EXCLUDED.elite_trajectory_ref, confidence = EXCLUDED.confidence, notes = EXCLUDED.notes, last_updated = EXCLUDED.last_updated, notion_url = EXCLUDED.notion_url;`,
  )
  .join("\n");

const joinRows = veloSeedData.ranges
  .flatMap((r) =>
    r.source_slugs.map(
      (s) =>
        `INSERT INTO velo_range_sources (range_slug, source_slug) VALUES (${q(r.slug)}, ${q(s)}) ON CONFLICT (range_slug, source_slug) DO NOTHING;`,
    ),
  )
  .join("\n");

export const VELO_SEED_SQL = [sourceRows, rangeRows, joinRows].join("\n");

/**
 * Which seeded rows are absent from the database, by slug.
 *
 * The seed upserts and never deletes, so nothing here ever leaves a table:
 * a slug named is one that genuinely failed to land. Same idea as the lift
 * menu's and the recipe library's missing-seed checks, and for the same
 * reason: "the tables exist" was all the setup response could say, which
 * looks identical whether a re-export landed or not.
 */
export function missingSeedVelo(
  rangeSlugs: readonly string[],
  sourceSlugs: readonly string[],
): { ranges: string[]; sources: string[] } {
  const haveRanges = new Set(rangeSlugs);
  const haveSources = new Set(sourceSlugs);
  return {
    ranges: veloSeedData.ranges
      .filter((r) => !haveRanges.has(r.slug))
      .map((r) => r.slug),
    sources: veloSeedData.sources
      .filter((s) => !haveSources.has(s.slug))
      .map((s) => s.slug),
  };
}

/** A level with no band of any kind: what the ladder renders as "No data yet". */
export function hasNoBand(r: {
  rhp_low: number | null;
  lhp_low: number | null;
  combined_low: number | null;
}): boolean {
  return r.rhp_low === null && r.lhp_low === null && r.combined_low === null;
}

/** What /api/setup reads back about the ladder, against what the seed expects. */
export interface VeloSetupState {
  ranges: {
    live: number;
    expected: number;
    noData: number;
    expectedNoData: number;
    missingSeed: string[];
  };
  sources: { live: number; expected: number; missingSeed: string[] };
  links: { live: number; expected: number };
}

/**
 * The sentences setup adds to its response when the ladder is short.
 *
 * A pure function of the state so every branch can be tested on its own. The
 * seed repairs a missing row before the check ever reads the table, which means
 * a real shortfall cannot be staged through the database: without this, a
 * branch like "only 60 of 68 links landed" would have no test that could ever
 * reach it.
 *
 * Empty when nothing is wrong, so a clean run carries no warning at all.
 */
export function veloWarnings(v: VeloSetupState): string[] {
  const out: string[] = [];
  if (v.ranges.missingSeed.length)
    out.push(
      `${v.ranges.missingSeed.length} velo level(s) are missing: ` +
        `${v.ranges.missingSeed.join(", ")}.`,
    );
  if (v.sources.missingSeed.length)
    out.push(
      `${v.sources.missingSeed.length} velo source(s) are missing: ` +
        `${v.sources.missingSeed.join(", ")}.`,
    );
  if (v.links.live < v.links.expected)
    out.push(
      `Only ${v.links.live} of ${v.links.expected} velo source links landed, ` +
        `so some levels will show fewer sources than they cite.`,
    );
  if (v.ranges.noData !== v.ranges.expectedNoData)
    out.push(
      `${v.ranges.noData} velo level(s) read "No data yet" but the seed says ` +
        `${v.ranges.expectedNoData}.`,
    );
  return out;
}
