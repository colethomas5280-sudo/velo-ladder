import { sql } from "./db";
import type { VeloRange, VeloSource } from "./veloTypes";

/* ------------------------------------------------------------------ *
 * Reading the benchmark ladder
 *
 * SERVER ONLY. A client component importing anything from this file pulls the
 * Postgres driver into the browser bundle, which has already broken a build in
 * this repo once, and would ship coach-only benchmarks to every athlete.
 * lib/clientSafe.test.ts enforces it.
 *
 * Numbers come back from pg as strings for a numeric column, so every band is
 * parsed explicitly. A null stays null: four rows have no sourced data and the
 * UI must render "No data yet" rather than a zero.
 * ------------------------------------------------------------------ */

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function listVeloRanges(): Promise<VeloRange[]> {
  const rows = (await sql`
    SELECT r.*, COALESCE(
             (SELECT array_agg(s.source_slug ORDER BY s.source_slug)
                FROM velo_range_sources s WHERE s.range_slug = r.slug),
             '{}') AS source_slugs
      FROM velo_ranges r
     ORDER BY r.display_order
  `) as Record<string, unknown>[];

  return rows.map((r) => ({
    slug: String(r.slug),
    level: String(r.level),
    category: String(r.category),
    rowType: String(r.row_type) as VeloRange["rowType"],
    displayOrder: Number(r.display_order),
    rhpLow: num(r.rhp_low),
    rhpHigh: num(r.rhp_high),
    lhpLow: num(r.lhp_low),
    lhpHigh: num(r.lhp_high),
    combinedLow: num(r.combined_low),
    combinedHigh: num(r.combined_high),
    eliteTrajectoryRef: num(r.elite_trajectory_ref),
    confidence: (r.confidence as string | null) ?? null,
    notes: String(r.notes ?? ""),
    lastUpdated: r.last_updated ? String(r.last_updated).slice(0, 10) : null,
    notionUrl: String(r.notion_url ?? ""),
    sourceSlugs: (r.source_slugs ?? []) as string[],
  }));
}

export async function listVeloSources(): Promise<VeloSource[]> {
  const rows = (await sql`SELECT * FROM velo_sources ORDER BY title`) as Record<string, unknown>[];
  return rows.map((s) => ({
    slug: String(s.slug),
    title: String(s.title),
    author: String(s.author ?? ""),
    dataType: String(s.data_type ?? ""),
    quality: String(s.quality ?? ""),
    publishedDate: s.published_date ? String(s.published_date).slice(0, 10) : null,
    limitationsSummary: String(s.limitations_summary ?? ""),
    notionUrl: String(s.notion_url ?? ""),
  }));
}
