import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenInput } from "@/lib/screenInput";
import { NOT_TESTED, fieldKey } from "@/lib/screen";

const TODAY = "2026-09-08";
const HIP = fieldKey("hip-45", "45-degree-angle", "L");
const ok = (over: Record<string, unknown> = {}) =>
  parseScreenInput({ date: TODAY, results: { [HIP]: "greater" }, ...over }, TODAY);

test("a well-formed screen is accepted", () => {
  const r = ok();
  assert.equal(r.ok, true);
  assert.deepEqual(r.value!.results, { [HIP]: "greater" });
});

test("the body must be an object", () => {
  for (const bad of [null, undefined, "x", 5, true])
    assert.equal(parseScreenInput(bad, TODAY).ok, false);
});

test("the date must be a real shape and not ahead of today", () => {
  assert.equal(ok({ date: "9/8/2026" }).ok, false);
  assert.equal(ok({ date: "" }).ok, false);
  assert.equal(ok({ date: "2026-09-09" }).ok, false, "tomorrow is a typo");
  assert.equal(ok({ date: "2026-09-08" }).ok, true);
});

test("an unknown field is refused, not quietly dropped", () => {
  // A renamed test in the config would otherwise silently discard results.
  const r = ok({ results: { "made-up.field": "greater" } });
  assert.equal(r.ok, false);
  assert.match(r.error!, /unknown field 'made-up\.field'/);
});

test("a finding that doesn't belong to its sub-test is refused", () => {
  const r = ok({ results: { [HIP]: "rolls-outside" } });
  assert.equal(r.ok, false);
  assert.match(r.error!, /not a finding of/);
});

test("not-tested is accepted anywhere", () => {
  const r = ok({ results: { [HIP]: NOT_TESTED } });
  assert.equal(r.ok, true);
  assert.equal(r.value!.results[HIP], NOT_TESTED);
});

test("a cleared field is left unrecorded rather than stored empty", () => {
  const r = parseScreenInput(
    { date: TODAY, results: { [HIP]: null }, notes: "checked" },
    TODAY,
  );
  assert.equal(r.ok, true);
  assert.equal(HIP in r.value!.results, false);
});

test("nothing at all is refused", () => {
  assert.equal(parseScreenInput({ date: TODAY }, TODAY).ok, false);
  assert.equal(parseScreenInput({ date: TODAY, results: {} }, TODAY).ok, false);
});

test("notes alone are enough to save", () => {
  const r = parseScreenInput({ date: TODAY, results: {}, notes: "Couldn't finish" }, TODAY);
  assert.equal(r.ok, true);
});

test("one bad value refuses the whole screen", () => {
  // Half a screen is worse than none: the coach walks away believing it saved.
  const r = ok({ results: { [HIP]: "greater", "nope.nope": "x" } });
  assert.equal(r.ok, false);
  assert.equal(r.value, undefined);
});

test("notes are capped rather than rejected", () => {
  assert.equal(ok({ notes: "x".repeat(3000) }).value!.notes.length, 2000);
});

test("an answer on a closed branch is kept, not stripped", () => {
  /*
   * Arms Down only applies once they break parallel. Storing it anyway means
   * a coach who flips the parent back doesn't lose the answer, and the read
   * path already ignores branches that never happened.
   */
  const r = parseScreenInput(
    {
      date: TODAY,
      results: {
        [fieldKey("wide-squat", "arms-in-front")]: "limited-squat",
        [fieldKey("wide-squat", "arms-down")]: "stable",
      },
    },
    TODAY,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value!.results[fieldKey("wide-squat", "arms-down")], "stable");
});
