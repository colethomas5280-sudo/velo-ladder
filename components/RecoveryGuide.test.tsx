import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANSWERED_ITEMS, recoveryScore } from "@/lib/recovery";
import { CNS_DEFAULT_PCT } from "@/lib/setback";
import type { RecoveryEntry } from "@/lib/types";
import RecoveryGuide from "./RecoveryGuide";

/* ------------------------------------------------------------------ *
 * The recovery score explainer
 *
 * The page exists because athletes see a number every morning that nothing
 * explains. Its job is to be true rather than reassuring — most of all about
 * what the score does NOT do, which is the part they are most likely to have
 * assumed wrong.
 * ------------------------------------------------------------------ */

const open = () => render(<RecoveryGuide />);
const scoreOf = () => document.querySelector(".ci-score .n")!.textContent!;
const pick = (label: string, value: number) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });

beforeEach(cleanup);

test("it opens on a worked example rather than a blank form", () => {
  open();
  // Every question mid-scale: a 3 across the board is 60.
  assert.equal(scoreOf(), "60");
});

test("the arithmetic is the real scorer, not a copy of it", () => {
  open();
  pick("Fatigue", 5);
  const answers: Record<string, number> = {};
  for (const q of ANSWERED_ITEMS) answers[q.key] = q.key === "energy" ? 5 : 3;
  assert.equal(
    scoreOf(),
    String(recoveryScore(answers as unknown as RecoveryEntry)),
  );
});

test("moving any answer moves the number", () => {
  open();
  const before = scoreOf();
  pick("Sleep quality", 5);
  assert.notEqual(scoreOf(), before);
});

/*
 * The assumption athletes make: that sleep counts for more than diet. It does
 * not — the score is a plain mean of whatever was filled in.
 */
test("every question carries the same weight, and the page says so", () => {
  open();
  pick("Fatigue", 5);
  const viaFatigue = scoreOf();
  cleanup();
  open();
  pick("Diet", 5);
  assert.equal(scoreOf(), viaFatigue, "one question is worth any other");
  assert.ok(screen.getByText(/every question counts the same/i));
});

test("every scored question on the check-in appears here", () => {
  open();
  for (const q of ANSWERED_ITEMS)
    assert.ok(screen.getByLabelText(q.label), `${q.label} is missing`);
});

test("bodyweight is not offered, because it is never scored", () => {
  open();
  assert.equal(screen.queryByLabelText(/weight today/i), null);
});

/* ---------------- the part that matters ---------------- */

/*
 * `recoveryScore` is displayed and charted and drives nothing else — checked
 * against the codebase, not assumed. The page has to say so, because an
 * athlete who thinks a low score cancels his session will answer to get the
 * score he wants rather than the one that is true.
 */
test("it says plainly that the score decides nothing", () => {
  open();
  assert.ok(screen.getByText(/does not decide anything/i));
});

test("it names the two things that do carry consequences", () => {
  open();
  const body = document.body.textContent!;
  assert.match(body, /arm question/i, "pain raises a flag on its own");
  assert.match(body, new RegExp(`${CNS_DEFAULT_PCT}%`), "and a velocity drop does");
  assert.match(body, /30-day average/i);
  assert.match(body, /against you, never\s+against anyone else/i);
});

test("it explains what is tracked but deliberately unscored", () => {
  open();
  const body = document.body.textContent!;
  for (const thing of [/bodyweight/i, /resting heart rate/i, /HRV/])
    assert.match(body, thing);
  assert.match(body, /against your own baseline/i, "and why, not merely that");
});

test("reset puts the example back", () => {
  open();
  pick("Fatigue", 5);
  assert.notEqual(scoreOf(), "60");
  fireEvent.click(screen.getByRole("button", { name: /reset/i }));
  assert.equal(scoreOf(), "60");
});

/*
 * The bug this codebase has shipped before: a number typed beside the config
 * it describes, which then goes stale silently. The retest cadence caption
 * went three commits describing a policy that had already been replaced.
 *
 * Asserting the rendered "5%" is not enough — it passes just as well when the
 * 5 is typed. So this checks the value FLOWS: the source must reference the
 * constant, and the page must show whatever that constant currently says.
 */
test("the velocity threshold is read from the config, not typed beside it", () => {
  const src = readFileSync(
    join(process.cwd(), "components", "RecoveryGuide.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /\{CNS_DEFAULT_PCT\}/,
    "the threshold is hardcoded — change CNS_DEFAULT_PCT and this page lies",
  );
  open();
  assert.match(document.body.textContent!, new RegExp(`${CNS_DEFAULT_PCT}%`));
});
