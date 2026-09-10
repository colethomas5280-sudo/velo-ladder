import "./testDom";
import { shiftDate, todayISO } from "@/lib/velo";
import type { ScreenOverviewRow } from "@/lib/types";
import { screenSummary, fillNormal, type Results } from "@/lib/screen";

/* Fixtures are built relative to today, so the tests don't rot overnight. */
export const TODAY = todayISO();
export const daysAgo = (n: number) => shiftDate(TODAY, -n);

/** A clean screen, or a clean one with the given readings overridden. */
export function screenOf(over: Results = {}): Results {
  return { ...fillNormal({}), ...over };
}

/** A roster row, defaulting to an athlete screened clean today. */
export function rowOf(over: Partial<ScreenOverviewRow> = {}): ScreenOverviewRow {
  return {
    athleteId: "a1",
    name: "Test Athlete",
    last: TODAY,
    lastFull: TODAY,
    summary: screenSummary(screenOf()),
    spotSince: null,
    spotTests: 0,
    called: null,
    phase: null,
    ...over,
  };
}
