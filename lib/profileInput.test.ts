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
  // These are visible-but-read-only for an athlete: the "ask your coach"
  // message is fine because he can already see the field on his form.
  // birthDate is excluded here — it is set-once, covered by its own tests.
  for (const key of ["inviteEmail", "level", "status"]) {
    const r = parseProfilePatch({ [key]: "2005-01-01" }, false, { birthDate: null });
    assert.equal(r.ok, false, `${key} must be refused for an athlete`);
    assert.match(r.ok === false ? r.error : "", /ask your coach/i);
  }
  const coach = parseProfilePatch({ level: "College" }, true);
  assert.equal(coach.ok, true, "but a coach may set it");
});

test("a field an athlete can't see is ignored, not refused — no message confirming it exists (finding 7)", () => {
  // `coachNotes` has athleteCanSee: false. Telling him "you can't change coach
  // notes — ask your coach" confirms the field is there. Treat it like an
  // unknown key: skipped, 200, nothing written.
  const r = parseProfilePatch({ coachNotes: "let me in", phone: "555-0100" }, false);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.patch, { phone: "555-0100" }, "coachNotes dropped silently");
  // A coach still writes it normally.
  assert.equal(parseProfilePatch({ coachNotes: "shoulder" }, true).ok, true);
});

test('clearing "hand" stores "" not null — the column is NOT NULL DEFAULT \'\' (finding 2)', () => {
  // The roster's "–" option and the form's "Choose…" option both send an
  // empty value. `SET hand = NULL` is a not-null violation → unhandled 500.
  for (const empty of ["", null] as const) {
    const r = parseProfilePatch({ hand: empty }, true);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.patch, { hand: "" }, `hand: ${JSON.stringify(empty)} → ""`);
  }
  // An athlete may do it too (hand is athlete-editable).
  const asAthlete = parseProfilePatch({ hand: "" }, false);
  assert.equal(asAthlete.ok, true);
  assert.deepEqual(asAthlete.ok && asAthlete.patch, { hand: "" });
  // A real value still validates against the options.
  assert.equal(parseProfilePatch({ hand: "R" }, true).ok, true);
  assert.equal(parseProfilePatch({ hand: "X" }, true).ok, false);
});

test('a coach\'s `name` that splits to an empty first name is refused (finding 4)', () => {
  // updateAthlete falls back to the old `name` while writing first/last empty,
  // and first_name = '' is unrecoverable by the setup backfill.
  for (const bad of ["", "   ", "\t"]) {
    const r = parseProfilePatch({ name: bad }, true);
    assert.equal(r.ok, false, `name ${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(
    parseProfilePatch({ name: "x".repeat(161) }, true).ok,
    false,
    "an over-long name is capped",
  );
  assert.equal(parseProfilePatch({ name: "Mara Vance" }, true).ok, true);
  assert.equal(parseProfilePatch({ name: "Prince" }, true).ok, true, "a single name is fine");
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

test("integer-backed number fields reject a fractional value (400, not a 500 at write)", () => {
  assert.equal(parseProfilePatch({ heightIn: 74.5 }, true).ok, false, "height_in is an int column");
  assert.equal(parseProfilePatch({ hsGradYear: 2028.5 }, true).ok, false);
  assert.equal(parseProfilePatch({ heightIn: 74 }, true).ok, true);
  // weightLb is numeric(5,1) — one decimal place is fine, two is not
  assert.equal(parseProfilePatch({ weightLb: 190.5 }, true).ok, true);
  assert.equal(parseProfilePatch({ weightLb: 190.55 }, true).ok, false);
});

test("a coach may rename via `name`; an athlete may not; an explicit split always wins", () => {
  const coach = parseProfilePatch({ name: "Mara Vance" }, true);
  assert.equal(coach.ok, true);
  assert.deepEqual(coach.ok && coach.patch, { name: "Mara Vance" });

  const athlete = parseProfilePatch({ name: "Mara Vance" }, false);
  assert.deepEqual(
    athlete.ok && athlete.patch,
    {},
    "an athlete edits firstName/lastName, never the derived name",
  );

  const split = parseProfilePatch(
    { name: "Mara Vance", firstName: "Mara", lastName: "Vance-Okafor" },
    true,
  );
  assert.deepEqual(
    split.ok && split.patch,
    { firstName: "Mara", lastName: "Vance-Okafor" },
    "name is dropped when the halves are sent explicitly",
  );
});

test("an athlete may fill a blank birth date, once", () => {
  const blank = { birthDate: null };
  const r = parseProfilePatch({ birthDate: "2012-06-15" }, false, blank);
  assert.equal(r.ok, true, "his to supply while nothing is stored");
  assert.deepEqual(r.ok && r.patch, { birthDate: "2012-06-15" });
});

test("an athlete may not change a birth date that is already set", () => {
  const filled = { birthDate: "2012-06-15" };
  const r = parseProfilePatch({ birthDate: "2010-01-01" }, false, filled);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /already set/i);
});

test("an athlete may not clear a birth date to reopen it", () => {
  // Otherwise set-once is set-as-often-as-you-like: clear, then re-set.
  const filled = { birthDate: "2012-06-15" };
  assert.equal(parseProfilePatch({ birthDate: null }, false, filled).ok, false);
  assert.equal(parseProfilePatch({ birthDate: "" }, false, filled).ok, false);
});

test("a coach may change a birth date whatever is stored", () => {
  const filled = { birthDate: "2012-06-15" };
  assert.equal(parseProfilePatch({ birthDate: "2010-01-01" }, true, filled).ok, true);
  assert.equal(parseProfilePatch({ birthDate: null }, true, filled).ok, true);
});

test("a blank birth date is still validated, not waved through", () => {
  const blank = { birthDate: null };
  assert.equal(parseProfilePatch({ birthDate: "2012-13-45" }, false, blank).ok, false);
  assert.equal(parseProfilePatch({ birthDate: "2103-06-15" }, false, blank).ok, false);
});

test("without a current row, a set-once field reads as locked", () => {
  // Failing closed matters: a caller that forgets to pass the row must not
  // accidentally hand an athlete a field he cannot otherwise change.
  assert.equal(parseProfilePatch({ birthDate: "2012-06-15" }, false).ok, false);
});
