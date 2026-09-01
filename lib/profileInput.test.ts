import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfilePatch } from "@/lib/profileInput";

test("an absent field is left alone, an explicit null clears it", () => {
  const r = parseProfilePatch({ phone: null }, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.patch, { phone: null });
  const empty = parseProfilePatch({}, true);
  assert.deepEqual(empty.ok && empty.patch, {}, "nothing sent, nothing written");
});

test("an invalid value is refused and writes nothing — the birth-date fix", () => {
  // The old behaviour mapped this to null and cleared the stored date,
  // silently dropping the athlete off his age board.
  const r = parseProfilePatch({ birthDate: "2009-13-45" }, true);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /date/i);
});

test("a future birth date is refused", () => {
  assert.equal(parseProfilePatch({ birthDate: "2103-06-15" }, true).ok, false);
});

test("numbers are range-checked, not merely coerced", () => {
  assert.equal(parseProfilePatch({ heightIn: 74 }, true).ok, true);
  assert.equal(parseProfilePatch({ heightIn: 5 }, true).ok, false, "30-90 inches");
  assert.equal(parseProfilePatch({ heightIn: 200 }, true).ok, false);
  assert.equal(parseProfilePatch({ weightLb: 190 }, true).ok, true);
  assert.equal(parseProfilePatch({ weightLb: 5 }, true).ok, false);
  assert.equal(parseProfilePatch({ hsGradYear: 2028 }, true).ok, true);
  assert.equal(parseProfilePatch({ hsGradYear: 12 }, true).ok, false);
});

test("select fields accept only their own options", () => {
  assert.equal(parseProfilePatch({ bats: "R" }, true).ok, true);
  assert.equal(parseProfilePatch({ bats: "X" }, true).ok, false);
  assert.equal(parseProfilePatch({ status: "Remote" }, true).ok, true);
  assert.equal(parseProfilePatch({ status: "Hybrid" }, true).ok, false);
});

test("an athlete cannot write email, level or status even by sending them", () => {
  for (const key of ["inviteEmail", "level", "status", "coachNotes"]) {
    const r = parseProfilePatch({ [key]: "anything" }, false);
    assert.equal(r.ok, false, `${key} must be refused for an athlete`);
  }
  const coach = parseProfilePatch({ level: "College" }, true);
  assert.equal(coach.ok, true, "but a coach may set it");
});

test("over-long free text is refused rather than truncated", () => {
  const r = parseProfilePatch({ positions: "P".repeat(500) }, true);
  assert.equal(r.ok, false, "silently truncating loses what he typed");
});

test("an athlete may write his own fields", () => {
  const r = parseProfilePatch({ phone: "555-0100", heightIn: 74 }, false);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.patch, { phone: "555-0100", heightIn: 74 });
});

// --- carried findings from Task 2's review ---

test("firstName and lastName refuse an explicit null (Task 2 finding 1)", () => {
  // Both are required. The schema's name backfill uses `first_name IS NULL`
  // as its "never split" marker, so a write that blanks a first name lets
  // the next /api/setup re-split that athlete from `name` and undo a
  // coach's correction. Reject null for those two keys.
  assert.equal(parseProfilePatch({ firstName: null }, true).ok, false);
  assert.equal(parseProfilePatch({ lastName: null }, true).ok, false);
  assert.equal(
    parseProfilePatch({ firstName: null }, false).ok,
    false,
    "an athlete cannot blank it either",
  );
  assert.equal(
    parseProfilePatch({ firstName: "" }, true).ok,
    false,
    "an emptied required name field is still a clear, and still refused",
  );
  assert.equal(parseProfilePatch({ firstName: "Mara" }, true).ok, true);
});

test('an emptied form field ("") clears a date/number rather than reaching Postgres as "" (Task 2 finding 2)', () => {
  const d = parseProfilePatch({ birthDate: "" }, true);
  assert.equal(d.ok, true);
  assert.deepEqual(d.ok && d.patch, { birthDate: null }, '"" means clear this');
  const n = parseProfilePatch({ heightIn: "" }, true);
  assert.equal(n.ok, true);
  assert.deepEqual(n.ok && n.patch, { heightIn: null });
});
