import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup } from "@testing-library/react";
import type { MovementScreen } from "@/lib/types";
import { withSwr } from "./testSwr";
import { daysAgo, screenOf, TODAY } from "./testRender";
import { AthleteRetestPrompt } from "./RetestPrompt";

/*
 * The coach-side "who needs screening" list moved to a standing dashboard
 * card (Dashboard.test.tsx covers its due/overdue/spot-check/called-reason
 * behavior via useScreeningDue) — this file is the athlete-facing daily
 * pop-up only now.
 */

beforeEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* storage is optional */
  }
});

/* An athlete cannot run their own screen, so this is a heads-up, not a task. */
test("the athlete's prompt asks them to mention it, not to do it", () => {
  const screens: MovementScreen[] = [
    {
      id: "s1",
      athleteId: "a1",
      date: daysAgo(100),
      results: screenOf(),
      notes: "",
    },
  ];
  render(
    withSwr(
      {
        "/api/athletes/a1": { id: "a1", name: "Kid", hand: "R", phase: null },
        "/api/athletes/a1/screens": screens,
      },
      <AthleteRetestPrompt athleteId="a1" />,
    ),
  );
  const body = document.body.textContent!;
  assert.match(body, /mention it at your next session/i);
  assert.doesNotMatch(body, /overdue/i, "not framed as their failure");
});

test("an athlete who isn't due sees nothing", () => {
  render(
    withSwr(
      {
        "/api/athletes/a1": { id: "a1", name: "Kid", hand: "R", phase: null },
        "/api/athletes/a1/screens": [
          { id: "s1", athleteId: "a1", date: TODAY, results: screenOf(), notes: "" },
        ],
      },
      <AthleteRetestPrompt athleteId="a1" />,
    ),
  );
  assert.equal(document.querySelector(".rp"), null);
});
