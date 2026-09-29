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
const q = (v: string | null): string =>
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
