import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { VeloRange, VeloSource } from "@/lib/veloTypes";
import { DISCLOSURES, evaluate } from "@/lib/veloPlacement";
import { withSwr } from "./testSwr";
import VeloLadder from "./VeloLadder";

/* ------------------------------------------------------------------ *
 * The placement calculator
 *
 * It mounts inside the ladder page's coach-only body, so every test renders
 * the whole VeloLadder the way VeloLadder.test.tsx does: the rows and sources
 * come through the same SWR keys the real page fetches, and an athlete never
 * gets that far. Fixtures copy the shape and bands of the real snapshot; no
 * import from lib/veloSeed.ts, which lib/clientSafe.test.ts would flag.
 *
 * The placing happens on the server (POST /api/velo/evaluate, tested in
 * lib/veloRoute.test.ts) and the classification itself in
 * lib/veloPlacement.test.ts. What is tested here is that the UI sends the
 * server the right thing and then shows everything it sends back, above all
 * the confidence and the disclosures.
 *
 * The server is stood in for by a fetch stub that runs the real `evaluate`
 * against the fixture rows. Importing it here is fine: this is a test, not a
 * client component, and it is the same function the route calls. The
 * disclosures are asserted as the exact strings from DISCLOSURES rather than
 * fragments of them, so a reworded caveat fails here instead of slipping by.
 * ------------------------------------------------------------------ */

const NONE = {
  rhpLow: null,
  rhpHigh: null,
  lhpLow: null,
  lhpHigh: null,
  combinedLow: null,
  combinedHigh: null,
  eliteTrajectoryRef: null,
  confidence: null,
  lastUpdated: null,
  sourceSlugs: [],
};

function row(
  over: Partial<VeloRange> & Pick<VeloRange, "slug" | "level" | "category" | "displayOrder">,
): VeloRange {
  return {
    rowType: "primary",
    notes: `Notes for ${over.slug}.`,
    notionUrl: `https://notion.so/${over.slug}`,
    ...NONE,
    ...over,
  };
}

const RANGES: VeloRange[] = [
  row({
    slug: "16u-hs-jv-soph",
    level: "16U (HS JV/Soph)",
    category: "High School",
    displayOrder: 7,
    combinedLow: 69,
    combinedHigh: 85,
    eliteTrajectoryRef: 89,
    confidence: "Medium",
    sourceSlugs: ["win-reality-age", "eisenmann-mlb-trajectory"],
  }),
  row({
    slug: "juco",
    level: "JUCO",
    category: "College",
    displayOrder: 10,
    rhpLow: 82,
    rhpHigh: 90,
    lhpLow: 80,
    lhpHigh: 87,
    confidence: "Medium",
    sourceSlugs: ["win-reality-age"],
  }),
  row({
    slug: "ncaa-d1-power-4",
    level: "NCAA D1 — Power 4",
    category: "College",
    displayOrder: 14,
    rhpLow: 90,
    rhpHigh: 97,
    lhpLow: 88,
    lhpHigh: 94,
    confidence: "Medium",
    sourceSlugs: ["win-reality-age"],
  }),
  row({
    slug: "milb-aaa",
    level: "MiLB — AAA",
    category: "Affiliated MiLB/MLB",
    displayOrder: 20,
  }),
  row({
    slug: "college-all-divisions-rapsodo",
    level: "College — All Divisions (Rapsodo Measured Avg)",
    category: "College",
    displayOrder: 21,
    rowType: "anchor",
    rhpLow: 85,
    rhpHigh: 88,
    confidence: "Medium",
  }),
  row({
    slug: "gobig-tier-1",
    level: "College — Go Big Tier 1 (High D1 / Elite JUCO)",
    category: "College",
    displayOrder: 22,
    rowType: "secondary",
    combinedLow: 92,
    combinedHigh: 99,
  }),
  row({
    slug: "gobig-tier-2",
    level: "College — Go Big Tier 2 (Lower D1 / High D2 / NAIA / Lower JUCO)",
    category: "College",
    displayOrder: 23,
    rowType: "secondary",
  }),
  row({
    slug: "gobig-tier-3",
    level: "College — Go Big Tier 3 (Lower NAIA / D2)",
    category: "College",
    displayOrder: 24,
    rowType: "secondary",
  }),
];

const SOURCES: VeloSource[] = [
  {
    slug: "win-reality-age",
    title: "Win Reality: Pitch Speed by Age",
    author: "Win Reality",
    dataType: "Aggregator",
    quality: "Medium",
    publishedDate: null,
    limitationsSummary: "Limitations.",
    notionUrl: "https://notion.so/win-reality-age",
  },
  {
    slug: "eisenmann-mlb-trajectory",
    title: "Eisenmann: MLB Velocity Trajectory",
    author: "Eisenmann",
    dataType: "Percentile study",
    quality: "High",
    publishedDate: null,
    limitationsSummary: "Limitations.",
    notionUrl: "https://notion.so/eisenmann-mlb-trajectory",
  },
];

/** What the browser sent to the evaluate route, one entry per call. */
let sent: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;

/**
 * Stands in for POST /api/velo/evaluate: finds the row by slug in the
 * fixtures and answers the way the route does, 200 with the result or 400
 * with evaluate's own message. `hold` makes it wait, for the stale-answer test.
 */
function stubServer(hold?: Promise<void>) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) !== "/api/velo/evaluate" || init?.method !== "POST") {
      throw new Error(`unexpected fetch ${String(input)}`);
    }
    const body = JSON.parse(String(init.body));
    sent.push(body);
    if (hold) await hold;
    const range = RANGES.find((r) => r.slug === body.slug);
    const res = range
      ? evaluate({
          range,
          hand: body.hand ?? undefined,
          floor: body.floor,
          sitting: body.sitting,
          peak: body.peak,
        })
      : ({ ok: false, error: `No such level: ${body.slug}` } as const);
    return new Response(JSON.stringify(res.ok ? res : { error: res.error }), {
      status: res.ok ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const renderPage = (
  me: { role: "coach" | "athlete" | "none"; athleteId: string | null } = {
    role: "coach",
    athleteId: null,
  },
) =>
  render(
    withSwr(
      { "/api/me": me, "/api/velo/ranges": RANGES, "/api/velo/sources": SOURCES },
      <VeloLadder snapshotDate="2026-09-28" />,
    ),
  );

beforeEach(() => {
  cleanup();
  sent = [];
  stubServer();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const levelSelect = () => screen.getByLabelText("Level") as HTMLSelectElement;
const option = (slug: string) => [...levelSelect().options].find((o) => o.value === slug);
const hand = (h: "R" | "L") => screen.getByRole("button", { name: `${h} throwing hand` });
const resultCard = () => screen.queryByRole("region", { name: "Placement result" });
const placed = () => screen.findByRole("region", { name: "Placement result" });

/** Fill the form and press Evaluate. `h` left out means no hand chosen. */
function evaluateSession(slug: string, low: string, avg: string, high: string, h?: "R" | "L") {
  fireEvent.change(levelSelect(), { target: { value: slug } });
  if (h) fireEvent.click(hand(h));
  fireEvent.change(screen.getByLabelText("Low"), { target: { value: low } });
  fireEvent.change(screen.getByLabelText("Average"), { target: { value: avg } });
  fireEvent.change(screen.getByLabelText("High"), { target: { value: high } });
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
}

const text = () => document.body.textContent!;

test("only primary rows are selectable, and the empty ones are disabled", () => {
  renderPage();
  // the Rapsodo anchor and the Go Big tiers are reference rows, not choices
  assert.equal(option("college-all-divisions-rapsodo"), undefined);
  assert.equal(option("gobig-tier-1"), undefined);
  assert.equal(option("gobig-tier-2"), undefined);
  assert.equal(option("gobig-tier-3"), undefined);
  // MiLB AAA is a primary row with no data: listed, disabled, and says so
  const aaa = option("milb-aaa")!;
  assert.ok(aaa, "MiLB AAA should be listed");
  assert.equal(aaa.disabled, true);
  assert.match(aaa.textContent!, /No data yet/);
  // a row with data is a live choice
  assert.equal(option("16u-hs-jv-soph")!.disabled, false);
});

test("an empty row cannot be evaluated even if the select is forced onto it", async () => {
  renderPage();
  evaluateSession("milb-aaa", "74", "79", "83");
  assert.match((await screen.findByRole("alert")).textContent!, /Choose a level/);
  assert.equal(sent.length, 0, "nothing goes to the server for a row with no band");
  assert.equal(resultCard(), null);
});

test("evaluating a 16U session shows the placement, the band and the confidence", async () => {
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  const card = await placed();
  assert.match(text(), /upper half/i);
  assert.match(text(), /69/);
  assert.match(text(), /Medium/);
  assert.match(card.textContent!, /16U \(HS JV\/Soph\)/);
  assert.match(card.textContent!, /High School/);
  assert.match(card.textContent!, /69-85 mph/);
  assert.match(card.textContent!, /midpoint 77/);
  assert.match(card.textContent!, /Elite ref/);
  assert.match(card.textContent!, /89 mph/, "the elite reference is shown when the row has one");
  assert.match(card.textContent!, /Win Reality: Pitch Speed by Age/);
  assert.match(card.textContent!, /Eisenmann: MLB Velocity Trajectory/);
  // the guide's note for this case: 83 is 4 above 79
  assert.match(card.textContent!, /Projectability gap/);
});

test("the browser sends the server a slug, a hand and three numbers, and no band", async () => {
  renderPage();
  evaluateSession("juco", "84", "88", "91", "R");
  await placed();
  assert.deepEqual(sent, [
    { slug: "juco", hand: "R", floor: 84, sitting: 88, peak: 91 },
  ]);
});

test("a JUCO right-hander at 84 / 88 / 91 matches the guide's worked example", async () => {
  renderPage();
  evaluateSession("juco", "84", "88", "91", "R");
  const card = await placed();
  const label = card.querySelector(".vc-label")!.textContent!;
  assert.equal(label, "Average, upper half");
  assert.match(card.textContent!, /RHP 82-90 mph/);
  assert.match(card.textContent!, /midpoint 86/);
  assert.match(card.textContent!, /Peak above the band/);
  assert.doesNotMatch(label, /outlier/i);
});

test("the low side is called notably behind for level, never an outlier", async () => {
  renderPage();
  evaluateSession("juco", "70", "75", "78", "R");
  const card = await placed();
  const label = card.querySelector(".vc-label")!.textContent!;
  assert.match(label, /notably behind for level/i);
  assert.doesNotMatch(label, /outlier/i);
});

test("a peak below the average is refused with a message, not a placement", async () => {
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "79", "77");
  assert.match((await screen.findByRole("alert")).textContent!, /high.*(cannot|must)/i);
  assert.equal(resultCard(), null);
});

test("a blank field asks for all three numbers instead of guessing zero", async () => {
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "", "83");
  assert.match((await screen.findByRole("alert")).textContent!, /Low, Average and High/);
  assert.equal(sent.length, 0);
  assert.equal(resultCard(), null);
});

test("no level chosen asks for one", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
  assert.match((await screen.findByRole("alert")).textContent!, /level/i);
  assert.equal(resultCard(), null);
});

test("the disclosures always appear with a result, word for word", async () => {
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  const card = await placed();
  const shown = [...card.querySelectorAll(".vc-disc li")].map((li) => li.textContent);
  assert.deepEqual(shown, [DISCLOSURES.confidence("Medium"), DISCLOSURES.percentileScope]);
});

test("the disclosures appear on the low side too, with the late-development note", async () => {
  renderPage();
  evaluateSession("juco", "70", "75", "78", "R");
  const card = await placed();
  const shown = [...card.querySelectorAll(".vc-disc li")].map((li) => li.textContent);
  assert.deepEqual(shown, [
    DISCLOSURES.confidence("Medium"),
    DISCLOSURES.percentileScope,
    DISCLOSURES.belowRangeNormal,
  ]);
});

test("a hand-split row demands a hand", async () => {
  renderPage();
  // D1 Power 4 splits by hand and no hand is chosen
  evaluateSession("ncaa-d1-power-4", "90", "93", "95");
  assert.match((await screen.findByRole("alert")).textContent!, /throwing hand is required/i);
  assert.equal(resultCard(), null);
});

test("editing an input clears a result that no longer matches it", async () => {
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  await placed();
  fireEvent.change(screen.getByLabelText("Average"), { target: { value: "80" } });
  assert.equal(resultCard(), null);
});

test("an answer that arrives after the form changed is dropped", async () => {
  let release!: () => void;
  stubServer(new Promise<void>((r) => (release = r)));
  renderPage();
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  fireEvent.change(screen.getByLabelText("Average"), { target: { value: "80" } });
  release();
  await waitFor(() => assert.equal(sent.length, 1));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resultCard(), null, "the result was for Average 79, which is no longer on screen");
});

test("the write-up copies the placement, the confidence and the disclosures", async () => {
  renderPage();
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (t: string) => {
        copied = t;
      },
    },
  });
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  await placed();
  fireEvent.click(screen.getByRole("button", { name: "Copy write-up" }));
  await waitFor(() => assert.notEqual(copied, ""));
  assert.match(copied, /Average, upper half/);
  assert.match(copied, /Confidence: Medium/);
  assert.ok(copied.includes(DISCLOSURES.confidence("Medium")));
  assert.ok(copied.includes(DISCLOSURES.percentileScope));
  assert.match(copied, /69-85 mph/);
  await waitFor(() => screen.getByText("Copied"));
});

test("a blocked clipboard leaves the write-up on screen to copy by hand", async () => {
  renderPage();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("blocked");
      },
    },
  });
  evaluateSession("16u-hs-jv-soph", "74", "79", "83");
  await placed();
  fireEvent.click(screen.getByRole("button", { name: "Copy write-up" }));
  const box = (await screen.findByLabelText("Write-up")) as HTMLTextAreaElement;
  assert.match(box.value, /Confidence: Medium/);
  assert.ok(box.value.includes(DISCLOSURES.percentileScope));
  assert.match(screen.getByRole("alert").textContent!, /Couldn.t copy/);
});

test("an athlete never gets the calculator", () => {
  // same data supplied as the coach tests, so only the role check keeps it off
  renderPage({ role: "athlete", athleteId: "a1" });
  assert.equal(screen.queryByLabelText("Level"), null);
  assert.doesNotMatch(text(), /16U \(HS JV\/Soph\)|Evaluate/);
});
