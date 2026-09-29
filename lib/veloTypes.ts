/* ------------------------------------------------------------------ *
 * Types only, no values.
 *
 * TypeScript erases this file entirely, so a client component may import a
 * type from it without pulling anything into the browser bundle. Anything
 * with a runtime value belongs in lib/veloData.ts instead, which is
 * server-only.
 * ------------------------------------------------------------------ */

export interface VeloBand {
  kind: "RHP" | "LHP" | "Combined";
  low: number;
  high: number;
  midpoint: number;
}

export interface VeloRange {
  slug: string;
  level: string;
  category: string;
  rowType: "primary" | "anchor" | "secondary";
  displayOrder: number;
  rhpLow: number | null;
  rhpHigh: number | null;
  lhpLow: number | null;
  lhpHigh: number | null;
  combinedLow: number | null;
  combinedHigh: number | null;
  eliteTrajectoryRef: number | null;
  confidence: string | null;
  notes: string;
  lastUpdated: string | null;
  notionUrl: string;
  sourceSlugs: string[];
}

export interface VeloSource {
  slug: string;
  title: string;
  author: string;
  dataType: string;
  quality: string;
  publishedDate: string | null;
  limitationsSummary: string;
  notionUrl: string;
}
