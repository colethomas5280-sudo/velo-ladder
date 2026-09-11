import "./testDom";
import { shiftDate, todayISO } from "@/lib/velo";
import type { ScreenOverviewRow } from "@/lib/types";
import { screenSummary, fillNormal, type Results } from "@/lib/screen";
import { liftMenu } from "@/lib/strength";
import { programLifts } from "@/lib/program";

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

/*
 * The lift menu a fresh database starts with. Components fetch theirs from
 * `/api/lifts`, so a test that renders one has to provide that key — MENU is
 * the object form for anything taking it as a prop, LIFT_ROWS the wire form.
 */
export const LIFT_ROWS = programLifts();
export const MENU = liftMenu(LIFT_ROWS);
