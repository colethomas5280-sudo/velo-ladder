import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreTrend,
  weightTrend,
  windowLabel,
  windowPhrase,
} from "@/lib/recovery";
import type { RecoveryEntry } from "@/lib/types";

/** A day offset back from a fixed anchor, so tests never depend on today. */
const day = (back: number): string => {
  const d = new Date("2026-08-31T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};

/** A check-in whose score is fully determined: one rated item, so score = v*20. */
const entry = (back: number, over: Partial<RecoveryEntry> = {}): RecoveryEntry =>
  ({ date: day(back), ...over }) as RecoveryEntry;

const scored = (back: number, rating: number) =>
  entry(back, { energy: rating } as Partial<RecoveryEntry>);

const weighed = (back: number, lb: number) =>
  entry(back, { bodyWeight: lb } as Partial<RecoveryEntry>);

test("windowLabel reads as days under a week and weeks above", () => {
  assert.equal(windowLabel(7), "7-day");
  assert.equal(windowLabel(14), "2-week");
  assert.equal(windowLabel(28), "4-week");
});

test("scoreTrend windows by date, not by the last N check-ins", () => {
  // Seven check-ins spread across three weeks. The old code took the last
  // seven ENTRIES and called it a seven-day average; only three sit inside
  // an actual seven-day window.
  const entries = [
    scored(20, 1),
    scored(17, 1),
    scored(14, 1),
    scored(11, 1),
    scored(5, 5),
    scored(3, 5),
    scored(0, 5),
  ];
  const t = scoreTrend(entries, 7)!;
  assert.equal(t.n, 3, "only the three inside the window count");
  assert.equal(t.avg, 100, "and they average 100, not the all-seven mix");
});

test("scoreTrend compares against the window before it, like for like", () => {
  const entries = [
    // previous week: three at rating 3 -> 60
    scored(13, 3),
    scored(12, 3),
    scored(11, 3),
    // current week: three at rating 4 -> 80
    scored(5, 4),
    scored(4, 4),
    scored(3, 4),
  ];
  const t = scoreTrend(entries, 7)!;
  assert.equal(t.avg, 80);
  assert.equal(t.prev, 60);
  assert.equal(t.change, 20);
  assert.equal(t.days, 7);
});

test("a longer window pulls in readings a shorter one excludes", () => {
  const entries = [scored(20, 1), scored(18, 1), scored(16, 1), scored(1, 5)];
  assert.equal(scoreTrend(entries, 7)!.n, 1, "one reading inside a week");
  assert.equal(scoreTrend(entries, 28)!.n, 4, "all four inside four weeks");
});

test("fewer than three readings is not a trend", () => {
  const t = scoreTrend([scored(1, 4), scored(0, 4)], 7)!;
  assert.equal(t.avg, null, "two readings claim no average");
  assert.equal(t.n, 2, "but the count is still reported");
});

test("scoreTrend is null when nothing scoreable exists", () => {
  assert.equal(scoreTrend([], 7), null);
  assert.equal(scoreTrend([entry(0, { notes: "sick" })], 7), null);
});

test("weightTrend takes the same window and reports the same shape", () => {
  const entries = [
    weighed(13, 180),
    weighed(12, 180),
    weighed(11, 180),
    weighed(5, 184),
    weighed(4, 184),
    weighed(3, 184),
  ];
  const t = weightTrend(entries, 7)!;
  assert.equal(t.avg, 184);
  assert.equal(t.prev, 180);
  assert.equal(t.change, 4);
  assert.equal(t.latest, 184);
  assert.equal(t.days, 7);
});

test("weightTrend's acute reading compares the latest against its own window", () => {
  // Steady at 186, then one morning 4 lb light — fluid, not mass.
  const entries = [
    weighed(4, 186),
    weighed(3, 186),
    weighed(2, 186),
    weighed(0, 182),
  ];
  const t = weightTrend(entries, 7)!;
  assert.equal(t.latest, 182);
  assert.equal(t.avg, 185); // (186*3 + 182) / 4
  assert.equal(t.acute, -3);
});

test("both trends anchor on the latest reading, not on today", () => {
  // Nobody has checked in for two weeks; the window still resolves rather
  // than blanking, so the card shows the last thing that was true.
  const entries = [scored(30, 4), scored(29, 4), scored(28, 4)];
  const t = scoreTrend(entries, 7)!;
  assert.equal(t.n, 3);
  assert.equal(t.avg, 80);
});

test("windowPhrase reads as a noun phrase, so labels are grammatical", () => {
  assert.equal(windowPhrase(7), "7 days");
  assert.equal(windowPhrase(14), "2 weeks");
  assert.equal(windowPhrase(28), "4 weeks");
});
