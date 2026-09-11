import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import type { LiftSession, RecoveryEntry } from "@/lib/types";
import { e1rm } from "@/lib/strength";
import { targetFor } from "@/lib/relative";
import { withSwr } from "./testSwr";
import { daysAgo, LIFT_ROWS, TODAY } from "./testRender";
import StrengthPanel from "./StrengthPanel";

/* ------------------------------------------------------------------ *
 * One athlete's lifting
 *
 * The panel derives every number it shows. These tests are mostly about it
 * deriving the RIGHT one — the estimated max off the best set rather than the
 * heaviest, reps rather than pounds on a push-up — and about the read-only
 * case, where a coach's page must not offer an athlete's buttons.
 * ------------------------------------------------------------------ */

let n = 0;
const day = (date: string, lifts: LiftSession["lifts"], notes = ""): LiftSession => ({
  id: `d${n++}`,
  athleteId: "a1",
  date,
  lifts,
  notes,
  level: null,
});

/** A steady weigh-in history — the denominator the ratios need. */
const weighing = (lb: number): RecoveryEntry[] =>
  [1, 3, 5].map((d) => ({ date: daysAgo(d), bodyWeight: lb }) as RecoveryEntry);

const panel = (
  days: LiftSession[],
  canEdit = true,
  opts: { weighIns?: RecoveryEntry[]; profileWeight?: number | null } = {},
) =>
  render(
    withSwr(
      {
        "/api/athletes/a1/lifts": days,
        "/api/lifts": LIFT_ROWS,
        "/api/athletes/a1/recovery": opts.weighIns ?? [],
        "/api/athletes/a1": { id: "a1", name: "Kid", weightLb: opts.profileWeight ?? null },
      },
      <StrengthPanel athleteId="a1" canEdit={canEdit} />,
    ),
  );

beforeEach(cleanup);

test("nothing logged yet says so instead of showing an empty board", () => {
  panel([]);
  assert.ok(screen.getByText(/nothing logged yet/i));
  assert.equal(document.querySelector(".st-bests"), null);
});

test("a lift's best is the estimated max, taken off the best set", () => {
  panel([
    day(daysAgo(7), { "front-squat": [{ w: 245, r: 1 }, { w: 225, r: 8 }] }),
  ]);
  const tile = document.querySelector(".st-best")!.textContent!;
  assert.match(tile, /Front squat/);
  assert.match(
    tile,
    new RegExp(`${Math.round(e1rm(225, 8)!)} lb`),
    "the back-off set says more than the grinding single",
  );
  assert.match(tile, /Est\. 1RM/i);
});

test("a bodyweight lift is read in reps, not in pounds", () => {
  panel([day(daysAgo(3), { "push-up": [{ w: 45, r: 3 }, { w: 0, r: 12 }] })]);
  const tile = document.querySelector(".st-best")!.textContent!;
  assert.match(tile, /12 reps/, "the longest set, not the heaviest");
  assert.match(tile, /Top set reps/i);
  assert.match(tile, /last BW × 12/);
});

test("added load on a bodyweight lift reads as added", () => {
  panel([day(daysAgo(3), { "push-up": [{ w: 25, r: 10 }] })]);
  assert.match(document.querySelector(".st-best")!.textContent!, /BW\+25 × 10/);
});

test("the session list totals the day's work", () => {
  panel([
    day(daysAgo(1), {
      "front-squat": [{ w: 225, r: 5 }, { w: 225, r: 5 }],
      "bench": [{ w: 185, r: 5 }],
    }),
  ]);
  const row = document.querySelector(".st-list li")!.textContent!;
  assert.match(row, /3 sets/);
  assert.match(row, /3,175 lb/, "volume, grouped");
  assert.match(row, /Front squat 225 × 5/);
});

test("a session with only a note still shows the note", () => {
  panel([day(daysAgo(1), {}, "Deload week — no lifting")]);
  assert.ok(screen.getByText(/deload week/i));
  assert.match(document.querySelector(".st-list li")!.textContent!, /note only/);
});

/*
 * A coach looking at an athlete's page can edit; anyone who can only read
 * must not be offered a button that would 403. The panel is the only thing
 * that knows which it is.
 */
test("a read-only panel offers no way to write", () => {
  panel([day(daysAgo(1), { "front-squat": [{ w: 225, r: 5 }] })], false);
  assert.equal(screen.queryByText(/log today's lifting/i), null);
  assert.equal(screen.queryByText(/^Edit$/), null);
  assert.equal(screen.queryByText(/^Del$/), null);
});

test("an editable panel offers to log today, or to edit today once it exists", () => {
  panel([day(daysAgo(1), { "front-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/\+ Log today's lifting/i));

  cleanup();
  panel([day(TODAY, { "front-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/edit today's lifting/i));
});

test("the chart needs two sessions before it draws a line", () => {
  panel([day(daysAgo(9), { "front-squat": [{ w: 225, r: 5 }] })]);
  assert.ok(screen.getByText(/the line starts at two/i));
  assert.equal(document.querySelector(".lc-line"), null);

  cleanup();
  panel([
    day(daysAgo(9), { "front-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(2), { "front-squat": [{ w: 245, r: 5 }] }),
  ]);
  assert.ok(document.querySelector(".lc-line"), "two points is a line");
  assert.equal(
    document.querySelectorAll(".lc-dot").length,
    2,
    "one dot per session",
  );
  assert.equal(
    document.querySelectorAll(".lc-dot.lc-rec").length,
    1,
    "and the second is the record, the first is not",
  );
});

/*
 * Found by using the page, not by reading it. Config order put a trap-bar
 * deadlift done once above a front squat with five sessions, so the chart
 * opened on "the line starts at two" while the athlete's main lift sat
 * unshown behind the picker.
 */
test("the chart opens on the lift with the most behind it, not the first on the menu", () => {
  panel([
    day(daysAgo(60), { "deadlift": [{ w: 315, r: 5 }], "front-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(30), { "front-squat": [{ w: 245, r: 5 }] }),
    day(daysAgo(5), { "front-squat": [{ w: 255, r: 5 }] }),
  ]);
  assert.match(document.querySelector(".lc-foot")!.textContent!, /Front squat/);
  assert.equal(screen.queryByText(/the line starts at two/i), null);
  // The trap bar is still on the board, just not leading the chart.
  assert.ok(screen.getByText("Deadlift"));
});

test("a session the chart can't plot is still counted as a session done", () => {
  panel([
    day(daysAgo(20), { "front-squat": [{ w: 225, r: 5 }] }),
    day(daysAgo(10), { "front-squat": [{ w: 135, r: 20 }] }), // too long to estimate from
    day(daysAgo(2), { "front-squat": [{ w: 245, r: 5 }] }),
  ]);
  assert.match(
    document.querySelector(".lc-foot")!.textContent!,
    /2 of 3 sessions plotted/,
    "not '2 sessions' — he squatted three times",
  );
});


/* ------------------------------------------------------------------ *
 * Strength standards
 *
 * The reason Cole wanted this built: a number to chase, not a diary. The
 * tests hold it to being honest about both halves of the ratio.
 * ------------------------------------------------------------------ */

/*
 * Read off the chart rather than typed, so a change of ambition — Cole
 * moving the band, say — cannot leave this test asserting an old number
 * while the page shows a new one.
 */
const DL_TARGET = targetFor("deadlift")!;

test("a ratio shows against its target, with the gap in pounds on the bar", () => {
  panel([day(daysAgo(3), { deadlift: [{ w: 320, r: 1 }] })], true, {
    weighIns: weighing(180),
  });
  const row = document.querySelector(".sd")!.textContent!;
  assert.match(row, /1\.78×/);
  assert.match(row, new RegExp(`of ${DL_TARGET}× bodyweight`, "i"));
  assert.match(row, new RegExp(`${Math.ceil(DL_TARGET * 180 - 320)} lb to go`));
  /*
   * 1.78x is above the chart's novice deadlift (1.25x) and below its
   * intermediate (2x). The band is the one he has REACHED, not the one he is
   * nearest — rounding him up to intermediate would be the app flattering him.
   */
  assert.match(row, /novice/i, "the band he has actually reached");
  assert.equal(/intermediate/i.test(row), false);
});

test("clearing the standard says so rather than showing a negative gap", () => {
  panel([day(daysAgo(3), { deadlift: [{ w: Math.ceil(DL_TARGET * 180) + 5, r: 1 }] })], true, {
    weighIns: weighing(180),
  });
  const row = document.querySelector(".sd")!;
  assert.match(row.textContent!, /Cleared/);
  assert.equal(row.className.includes("met"), true);
  assert.equal(/to go/.test(row.textContent!), false);
});

/*
 * A ratio is two measurements. An athlete should be able to check either,
 * and especially so when the weight behind it is one lone weigh-in.
 */
test("the row says where both numbers came from", () => {
  panel([day(daysAgo(3), { deadlift: [{ w: 320, r: 1 }] })], true, {
    weighIns: [{ date: daysAgo(3), bodyWeight: 180 } as RecoveryEntry],
  });
  const row = document.querySelector(".sd")!.textContent!;
  assert.match(row, /320 lb est\./);
  assert.match(row, /at 180 lb/);
  assert.match(row, /1 weigh-in/, "one reading is thin and the row admits it");
});

test("with no check-ins it falls back to the profile weight and marks it", () => {
  panel([day(daysAgo(3), { deadlift: [{ w: 320, r: 1 }] })], true, {
    profileWeight: 180,
  });
  assert.match(document.querySelector(".sd")!.textContent!, /from your profile/i);
});

/*
 * The case an athlete will actually hit first: lifting logged, never weighed.
 * A blank section would read as "you have no standards"; it has to say what
 * to do about it.
 */
test("no bodyweight anywhere explains itself instead of showing nothing", () => {
  panel([day(daysAgo(3), { deadlift: [{ w: 320, r: 1 }] })]);
  assert.equal(document.querySelector(".sd"), null);
  assert.ok(screen.getByText(/put your weight on a recovery check-in/i));
});

test("a lift with no standard behind it prompts for one that has", () => {
  panel([day(daysAgo(3), { "barbell-hip-thrust": [{ w: 315, r: 5 }] })], true, {
    weighIns: weighing(180),
  });
  assert.equal(document.querySelector(".sd"), null);
  assert.ok(screen.getByText(/carries a standard/i));
});

test("nothing logged at all shows no standards section", () => {
  panel([], true, { weighIns: weighing(180) });
  assert.equal(screen.queryByText(/strength standards/i), null);
});

/*
 * The pull-up ladder, as an athlete climbs it. Cole: "once we can get to 14+,
 * I believe we start concerning ourselves with adding weight."
 */
const pullDay = (date: string, sets: { w: number; r: number }[]) =>
  day(date, { "pull-up": sets });

test("under the rep mark, the pull-up row counts reps", () => {
  panel([pullDay(daysAgo(2), [{ w: 0, r: 9 }])], true, { weighIns: weighing(180) });
  const row = [...document.querySelectorAll(".sd")].find((e) =>
    /pull/i.test(e.textContent!),
  )!;
  assert.match(row.textContent!, /of 14 reps/i);
  assert.match(row.textContent!, /5 reps to go/);
});

/*
 * The state that matters most. "Cleared" on its own leaves an athlete who can
 * do fifteen pull-ups with nothing to chase — the row has to say what next.
 */
test("clearing the reps tells him to start adding weight", () => {
  panel([pullDay(daysAgo(2), [{ w: 0, r: 15 }])], true, { weighIns: weighing(180) });
  const row = [...document.querySelectorAll(".sd")].find((e) =>
    /pull/i.test(e.textContent!),
  )!;
  assert.match(row.textContent!, /Cleared/);
  assert.match(row.textContent!, /start adding weight/i);
});

test("once loaded, the row turns into a ratio of total load", () => {
  panel([pullDay(daysAgo(2), [{ w: 0, r: 15 }, { w: 45, r: 3 }])], true, {
    weighIns: weighing(180),
  });
  const row = [...document.querySelectorAll(".sd")].find((e) =>
    /pull/i.test(e.textContent!),
  )!;
  assert.match(row.textContent!, /of 250 lb total/i);
  assert.match(row.textContent!, /45 lb/, "and names what was hung on");
  assert.equal(/of 14 reps/i.test(row.textContent!), false, "the rep stage is behind him");
});

/*
 * Cole reads the DB press for horizontal pushing and wants the barbell number
 * kept underneath, not beside it. Nothing but the rendering enforces that —
 * the tier on the config is inert if the page ignores it.
 */
test("a sub marker is shown apart from the main ones, not among them", () => {
  panel(
    [
      day(daysAgo(2), {
        deadlift: [{ w: 355, r: 3 }],
        bench: [{ w: 225, r: 3 }],
        "db-bench-press": [{ w: 80, r: 5 }],
      }),
    ],
    true,
    { weighIns: weighing(180) },
  );
  assert.ok(screen.getByText(/also tracked/i));

  const subs = document.querySelector(".st-subs")!.textContent!;
  assert.match(subs, /Bench/);
  assert.equal(/Deadlift/.test(subs), false, "the mains are not down here");

  const mains = document.querySelectorAll(".st-standards:not(.st-subs) .sd");
  const mainLifts = [...mains].map((e) => e.querySelector(".sd-lift")!.textContent!);
  assert.ok(mainLifts.includes("DB bench press"), "the dumbbells are the marker");
  assert.ok(mainLifts.includes("Deadlift"));
  /*
   * The one that matters: filtering only the SUB list still leaves the
   * barbell press sitting among the mains, which is the arrangement Cole
   * asked to change.
   */
  assert.equal(
    mainLifts.includes("Bench"),
    false,
    `barbell bench is still a main marker: ${mainLifts.join(", ")}`,
  );
});

test("with no sub marker logged, no second section appears", () => {
  panel([day(daysAgo(2), { deadlift: [{ w: 355, r: 3 }] })], true, {
    weighIns: weighing(180),
  });
  assert.equal(screen.queryByText(/also tracked/i), null);
});
