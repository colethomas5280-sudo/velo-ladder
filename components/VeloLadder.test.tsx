import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import type { VeloRange, VeloSource } from "@/lib/veloTypes";
import { withSwr } from "./testSwr";
import VeloLadder from "./VeloLadder";

/* ------------------------------------------------------------------ *
 * The velo ladder
 *
 * Fixtures below mirror the shape of the real 25-row/11-source snapshot
 * (db/velo-ladder-seed-data.json) closely enough to exercise every rule the
 * page has to follow, without importing lib/veloSeed.ts: that file is
 * server-only, and a test file pulling a value out of it would be exactly
 * the kind of import lib/clientSafe.test.ts exists to catch elsewhere.
 * Notes and Notion URLs are placeholders; slugs, categories, row types,
 * bands, confidence and elite-trajectory references match the real data.
 * ------------------------------------------------------------------ */

const RANGES: VeloRange[] = [
  {
    slug: "10u",
    level: "10U",
    category: "Youth (8U-12U)",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 1,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 40,
    combinedHigh: 60,
    eliteTrajectoryRef: null,
    confidence: "Low",
    notes: "Notes for 10u.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/10u",
    sourceSlugs: ["win-reality-age", "premier-pitching-average"],
  },
  {
    slug: "11u",
    level: "11U",
    category: "Youth (8U-12U)",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 2,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 45,
    combinedHigh: 60,
    eliteTrajectoryRef: null,
    confidence: "Low",
    notes: "Notes for 11u.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/11u",
    sourceSlugs: ["win-reality-age", "premier-pitching-average"],
  },
  {
    slug: "12u",
    level: "12U",
    category: "Youth (8U-12U)",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 3,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 50,
    combinedHigh: 64,
    eliteTrajectoryRef: null,
    confidence: "Low",
    notes: "Notes for 12u.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/12u",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "coleman-how-hard", "premier-pitching-average"],
  },
  {
    slug: "13u",
    level: "13U",
    category: "Youth (13U-14U)",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 4,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 55,
    combinedHigh: 75,
    eliteTrajectoryRef: 72,
    confidence: "High",
    notes: "Notes for 13u.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/13u",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "eisenmann-percentiles", "coleman-how-hard", "eisenmann-mlb-trajectory", "premier-pitching-average"],
  },
  {
    slug: "14u",
    level: "14U",
    category: "Youth (13U-14U)",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 5,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 60,
    combinedHigh: 75,
    eliteTrajectoryRef: 78,
    confidence: "Medium",
    notes: "Notes for 14u.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/14u",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "coleman-how-hard", "eisenmann-mlb-trajectory", "premier-pitching-average"],
  },
  {
    slug: "15u-hs-freshman",
    level: "15U (HS Freshman)",
    category: "High School",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 6,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 65,
    combinedHigh: 80,
    eliteTrajectoryRef: 84,
    confidence: "Medium",
    notes: "Notes for 15u-hs-freshman.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/15u-hs-freshman",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "coleman-how-hard", "eisenmann-mlb-trajectory"],
  },
  {
    slug: "16u-hs-jv-soph",
    level: "16U (HS JV/Soph)",
    category: "High School",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 7,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 69,
    combinedHigh: 85,
    eliteTrajectoryRef: 89,
    confidence: "Medium",
    notes: "Notes for 16u-hs-jv-soph.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/16u-hs-jv-soph",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "coleman-how-hard", "eisenmann-mlb-trajectory"],
  },
  {
    slug: "17u-hs-varsity-jr",
    level: "17U (HS Varsity/Jr)",
    category: "High School",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 8,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 74,
    combinedHigh: 87,
    eliteTrajectoryRef: 92,
    confidence: "Medium",
    notes: "Notes for 17u-hs-varsity-jr.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/17u-hs-varsity-jr",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "coleman-how-hard", "eisenmann-mlb-trajectory"],
  },
  {
    slug: "18u-hs-varsity-sr",
    level: "18U (HS Varsity/Sr)",
    category: "High School",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 9,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 75,
    combinedHigh: 92,
    eliteTrajectoryRef: 94,
    confidence: "High",
    notes: "Notes for 18u-hs-varsity-sr.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/18u-hs-varsity-sr",
    sourceSlugs: ["win-reality-age", "nextcommit-age-chart", "uncommitted-u-benchmarks", "eisenmann-percentiles", "coleman-how-hard", "eisenmann-mlb-trajectory"],
  },
  {
    slug: "juco",
    level: "JUCO",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 10,
    rhpLow: 82,
    rhpHigh: 90,
    lhpLow: 80,
    lhpHigh: 87,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for juco.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/juco",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age"],
  },
  {
    slug: "ncaa-d3",
    level: "NCAA D3",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 11,
    rhpLow: 78,
    rhpHigh: 86,
    lhpLow: 77,
    lhpHigh: 83,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for ncaa-d3.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/ncaa-d3",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age", "premier-pitching-average"],
  },
  {
    slug: "ncaa-d2",
    level: "NCAA D2",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 12,
    rhpLow: 84,
    rhpHigh: 90,
    lhpLow: 82,
    lhpHigh: 87,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for ncaa-d2.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/ncaa-d2",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age"],
  },
  {
    slug: "naia",
    level: "NAIA",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 13,
    rhpLow: 78,
    rhpHigh: 86,
    lhpLow: 77,
    lhpHigh: 84,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for naia.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/naia",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age"],
  },
  {
    slug: "ncaa-d1-power-4",
    level: "NCAA D1 \u2014 Power 4",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 14,
    rhpLow: 90,
    rhpHigh: 97,
    lhpLow: 88,
    lhpHigh: 94,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for ncaa-d1-power-4.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/ncaa-d1-power-4",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age"],
  },
  {
    slug: "ncaa-d1-mid-major",
    level: "NCAA D1 \u2014 Mid-Major",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 15,
    rhpLow: 88,
    rhpHigh: 92,
    lhpLow: 85,
    lhpHigh: 90,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for ncaa-d1-mid-major.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/ncaa-d1-mid-major",
    sourceSlugs: ["nextcommit-standards-screenshot", "topvelocity-recruiting", "win-reality-age"],
  },
  {
    slug: "ncaa-d1-low-major",
    level: "NCAA D1 \u2014 Low-Major",
    category: "College",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 16,
    rhpLow: 85,
    rhpHigh: 88,
    lhpLow: 83,
    lhpHigh: 86,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Unverified",
    notes: "Notes for ncaa-d1-low-major.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/ncaa-d1-low-major",
    sourceSlugs: ["nextcommit-standards-screenshot"],
  },
  {
    slug: "independent-pro",
    level: "Independent Pro",
    category: "Independent/Pro",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 17,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: null,
    notes: "Notes for independent-pro.",
    lastUpdated: null,
    notionUrl: "https://notion.so/independent-pro",
    sourceSlugs: [],
  },
  {
    slug: "milb-rookie-low-a",
    level: "MiLB \u2014 Rookie/Low-A",
    category: "Affiliated MiLB/MLB",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 18,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: null,
    notes: "Notes for milb-rookie-low-a.",
    lastUpdated: null,
    notionUrl: "https://notion.so/milb-rookie-low-a",
    sourceSlugs: [],
  },
  {
    slug: "milb-high-a-aa",
    level: "MiLB \u2014 High-A/AA",
    category: "Affiliated MiLB/MLB",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 19,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: null,
    notes: "Notes for milb-high-a-aa.",
    lastUpdated: null,
    notionUrl: "https://notion.so/milb-high-a-aa",
    sourceSlugs: [],
  },
  {
    slug: "milb-aaa",
    level: "MiLB \u2014 AAA",
    category: "Affiliated MiLB/MLB",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 20,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: null,
    notes: "Notes for milb-aaa.",
    lastUpdated: null,
    notionUrl: "https://notion.so/milb-aaa",
    sourceSlugs: [],
  },
  {
    slug: "mlb",
    level: "MLB",
    category: "Affiliated MiLB/MLB",
    rowType: "primary" as VeloRange["rowType"],
    displayOrder: 21,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 92,
    combinedHigh: 97,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for mlb.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/mlb",
    sourceSlugs: ["win-reality-age", "premier-pitching-average"],
  },
  {
    slug: "college-all-divisions-rapsodo",
    level: "College \u2014 All Divisions (Rapsodo Measured Avg)",
    category: "College",
    rowType: "anchor" as VeloRange["rowType"],
    displayOrder: 22,
    rhpLow: 85,
    rhpHigh: 85,
    lhpLow: 83,
    lhpHigh: 83,
    combinedLow: null,
    combinedHigh: null,
    eliteTrajectoryRef: null,
    confidence: "Medium",
    notes: "Notes for college-all-divisions-rapsodo.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/college-all-divisions-rapsodo",
    sourceSlugs: ["rapsodo-college-averages"],
  },
  {
    slug: "gobig-tier-1",
    level: "College \u2014 Go Big Tier 1 (High D1 / Elite JUCO)",
    category: "College",
    rowType: "secondary" as VeloRange["rowType"],
    displayOrder: 23,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 84,
    combinedHigh: 95,
    eliteTrajectoryRef: null,
    confidence: "Unverified",
    notes: "Notes for gobig-tier-1.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/gobig-tier-1",
    sourceSlugs: ["gobig-tier-profiles"],
  },
  {
    slug: "gobig-tier-2",
    level: "College \u2014 Go Big Tier 2 (Lower D1 / High D2 / NAIA / Lower JUCO)",
    category: "College",
    rowType: "secondary" as VeloRange["rowType"],
    displayOrder: 24,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 82,
    combinedHigh: 90,
    eliteTrajectoryRef: null,
    confidence: "Unverified",
    notes: "Notes for gobig-tier-2.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/gobig-tier-2",
    sourceSlugs: ["gobig-tier-profiles"],
  },
  {
    slug: "gobig-tier-3",
    level: "College \u2014 Go Big Tier 3 (Lower NAIA / D2)",
    category: "College",
    rowType: "secondary" as VeloRange["rowType"],
    displayOrder: 25,
    rhpLow: null,
    rhpHigh: null,
    lhpLow: null,
    lhpHigh: null,
    combinedLow: 77,
    combinedHigh: 82,
    eliteTrajectoryRef: null,
    confidence: "Unverified",
    notes: "Notes for gobig-tier-3.",
    lastUpdated: "2026-09-25",
    notionUrl: "https://notion.so/gobig-tier-3",
    sourceSlugs: ["gobig-tier-profiles"],
  },
];

const SOURCES: VeloSource[] = [
  {
    slug: "nextcommit-standards-screenshot",
    title: "Next Commit \u2014 Pitcher Velocity Standards (Fastball MPH)",
    author: "Next Commit",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Low",
    publishedDate: null,
    limitationsSummary: "Limitations for nextcommit-standards-screenshot.",
    notionUrl: "https://notion.so/nextcommit-standards-screenshot",
  },
  {
    slug: "topvelocity-recruiting",
    title: "TopVelocity \u2014 What Velocity to Get Recruited (College Standards)",
    author: "TopVelocity",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Low",
    publishedDate: null,
    limitationsSummary: "Limitations for topvelocity-recruiting.",
    notionUrl: "https://notion.so/topvelocity-recruiting",
  },
  {
    slug: "win-reality-age",
    title: "WIN Reality \u2014 Pitching Velocity by Age: Average Fastball Benchmarks from Youth Baseball to MLB",
    author: "Andrew Don \u2014 WIN Reality",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Medium",
    publishedDate: "2026-08-05",
    limitationsSummary: "Limitations for win-reality-age.",
    notionUrl: "https://notion.so/win-reality-age",
  },
  {
    slug: "rapsodo-college-averages",
    title: "Rapsodo \u2014 College Baseball Pitching Averages and How to Reach Them",
    author: "Rapsodo",
    dataType: "Showcase/aggregate radar data",
    quality: "Medium",
    publishedDate: "2023-06-07",
    limitationsSummary: "Limitations for rapsodo-college-averages.",
    notionUrl: "https://notion.so/rapsodo-college-averages",
  },
  {
    slug: "gobig-tier-profiles",
    title: "Go Big Recruiting \u2014 College Pitcher Tier Profiles",
    author: "Go Big Recruiting",
    dataType: "Coach/anecdotal observation",
    quality: "Unverified",
    publishedDate: null,
    limitationsSummary: "Limitations for gobig-tier-profiles.",
    notionUrl: "https://notion.so/gobig-tier-profiles",
  },
  {
    slug: "nextcommit-age-chart",
    title: "NextCommit \u2014 Pitching Velocity by Age (12-18) + College Targets",
    author: "Adam Paganelli, Co-founder \u2014 NextCommit",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Medium",
    publishedDate: "2026-07-05",
    limitationsSummary: "Limitations for nextcommit-age-chart.",
    notionUrl: "https://notion.so/nextcommit-age-chart",
  },
  {
    slug: "uncommitted-u-benchmarks",
    title: "Uncommitted U \u2014 Pitching Velocity Benchmarks by Level",
    author: "Wayne Keeton \u2014 Uncommitted U",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Medium",
    publishedDate: "2026-07-28",
    limitationsSummary: "Limitations for uncommitted-u-benchmarks.",
    notionUrl: "https://notion.so/uncommitted-u-benchmarks",
  },
  {
    slug: "eisenmann-percentiles",
    title: "Joe Eisenmann \u2014 Chasing Velo: Benchmarks for 13-18 Year Old Competitive Pitchers",
    author: "Joe Eisenmann, PhD",
    dataType: "Peer-reviewed study",
    quality: "High",
    publishedDate: "2026-06-21",
    limitationsSummary: "Limitations for eisenmann-percentiles.",
    notionUrl: "https://notion.so/eisenmann-percentiles",
  },
  {
    slug: "eisenmann-mlb-trajectory",
    title: "Joe Eisenmann \u2014 Age- and Maturity-based Modeling of Fastball Velocity in 25 MLB Pitchers",
    author: "Joe Eisenmann, PhD",
    dataType: "Peer-reviewed study",
    quality: "High",
    publishedDate: "2026-06-18",
    limitationsSummary: "Limitations for eisenmann-mlb-trajectory.",
    notionUrl: "https://notion.so/eisenmann-mlb-trajectory",
  },
  {
    slug: "coleman-how-hard",
    title: "Gene Coleman \u2014 How Hard Should You Throw?",
    author: "Gene Coleman, Ed.D., RSCC*E \u2014 Pro Baseball Strength & Conditioning Coaches Society",
    dataType: "Coach/anecdotal observation",
    quality: "Low",
    publishedDate: "2023-06-08",
    limitationsSummary: "Limitations for coleman-how-hard.",
    notionUrl: "https://notion.so/coleman-how-hard",
  },
  {
    slug: "premier-pitching-average",
    title: "Premier Pitching \u2014 What Is the Average Baseball Pitch Speed?",
    author: "Premier Pitching Performance Team",
    dataType: "Aggregator database (PG/PBR)",
    quality: "Unverified",
    publishedDate: null,
    limitationsSummary: "Limitations for premier-pitching-average.",
    notionUrl: "https://notion.so/premier-pitching-average",
  },
];

const CATEGORY_ORDER = [
  "Youth (8U-12U)",
  "Youth (13U-14U)",
  "High School",
  "College",
  "Independent/Pro",
  "Affiliated MiLB/MLB",
];

/** Level text with the row's caret glyph and "Reference only" marker
 * stripped off, so it compares cleanly against the plain level name. */
function levelText(el: Element): string {
  return (el.textContent ?? "")
    .replace(/^[▸▾]/, "")
    .replace(/Reference only$/, "")
    .trim();
}

const renderLadder = (me: { role: "coach" | "athlete" | "none"; athleteId: string | null } = { role: "coach", athleteId: null }) =>
  render(
    withSwr(
      {
        "/api/me": me,
        "/api/velo/ranges": RANGES,
        "/api/velo/sources": SOURCES,
      },
      <VeloLadder snapshotDate="2026-09-28" />,
    ),
  );

beforeEach(cleanup);

test("every category and all 25 rows render, in display order", () => {
  renderLadder();
  for (const cat of CATEGORY_ORDER) {
    assert.ok(screen.getByText(cat), `${cat} heading missing`);
  }
  const levels = [...document.querySelectorAll(".vl-level")].map(levelText);
  assert.equal(levels.length, 25);
  assert.deepEqual(
    levels,
    RANGES.slice()
      .sort((a, b) => {
        const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
        return ci !== 0 ? ci : a.displayOrder - b.displayOrder;
      })
      .map((r) => r.level),
  );
});

test("a row with no sourced data says so instead of showing a number", () => {
  renderLadder();
  // MiLB AAA
  assert.match(document.body.textContent!, /no data yet/i);
  assert.doesNotMatch(document.body.textContent!, /MiLB — AAA[^]*?\b0\b/);
});

test("a hand-split row shows both bands, a combined row shows one", () => {
  renderLadder();
  const rows = [...document.querySelectorAll("tr.sess")];
  // JUCO shows RHP 82-90 and LHP 80-87; 16U shows 69-85 with no RHP/LHP label
  const juco = rows.find((r) => r.textContent?.includes("JUCO"))!;
  const sixteen = rows.find((r) => r.textContent?.includes("16U (HS JV/Soph)"))!;
  assert.match(juco.textContent!, /RHP 82-90 mph/);
  assert.match(juco.textContent!, /LHP 80-87 mph/);
  assert.match(sixteen.textContent!, /69-85 mph/);
  assert.doesNotMatch(sixteen.textContent!, /RHP|LHP/);
});

test("the elite reference only appears on the 13U to 18U rows", () => {
  renderLadder();
  const rows = [...document.querySelectorAll("tr.sess")];
  // present on 16u-hs-jv-soph, absent on juco
  const sixteen = rows.find((r) => r.textContent?.includes("16U (HS JV/Soph)"))!;
  const juco = rows.find((r) => r.textContent?.includes("JUCO"))!;
  assert.match(sixteen.querySelector(".vl-elite")!.textContent!, /89/);
  assert.equal(juco.querySelector(".vl-elite")!.textContent!.trim(), "–");
});

test("the anchor and secondary rows are marked reference-only", () => {
  renderLadder();
  const rows = [...document.querySelectorAll("tr.sess")];
  // Rapsodo anchor and the three Go Big tiers carry a visible marker
  const refLevels = [
    "College — All Divisions (Rapsodo Measured Avg)",
    "College — Go Big Tier 1 (High D1 / Elite JUCO)",
    "College — Go Big Tier 2 (Lower D1 / High D2 / NAIA / Lower JUCO)",
    "College — Go Big Tier 3 (Lower NAIA / D2)",
  ];
  for (const level of refLevels) {
    const row = rows.find((r) => r.textContent?.includes(level));
    assert.ok(row, `${level} row missing`);
    assert.ok(
      row!.querySelector(".vl-refonly"),
      `${level} should be marked reference-only`,
    );
  }
  const juco = rows.find((r) => r.textContent?.includes("JUCO"))!;
  assert.equal(juco.querySelector(".vl-refonly"), null);
});

test("the banner and the snapshot date are both shown", () => {
  renderLadder();
  assert.match(document.body.textContent!, /check the Confidence rating/i);
  assert.match(document.body.textContent!, /2026-09-28|Sep 28, 2026/);
});

test("an athlete never renders the ladder at all", () => {
  // me.role === "athlete": the component renders nothing of substance
  render(
    withSwr(
      { "/api/me": { role: "athlete", athleteId: "a1" } },
      <VeloLadder snapshotDate="2026-09-28" />,
    ),
  );
  assert.doesNotMatch(document.body.textContent!, /Elite Trajectory|69-85/);
});
