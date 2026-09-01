import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitName, joinName, visibleProfile, editableKeys,
  missingProfileFields, PROFILE_FIELDS, PROFILE_SECTIONS,
} from "@/lib/profile";

test("splitName splits on the LAST space, so compound given names survive", () => {
  assert.deepEqual(splitName("Martin Duff"), { first: "Martin", last: "Duff" });
  assert.deepEqual(splitName("Mary Jo Smith"), { first: "Mary Jo", last: "Smith" });
});

test("splitName handles a single name and stray whitespace", () => {
  assert.deepEqual(splitName("Prince"), { first: "Prince", last: "" });
  assert.deepEqual(splitName("  Martin   Duff  "), { first: "Martin", last: "Duff" });
  assert.deepEqual(splitName(""), { first: "", last: "" });
});

test("joinName is the only way name is built, and trims a missing half", () => {
  assert.equal(joinName("Martin", "Duff"), "Martin Duff");
  assert.equal(joinName("Prince", ""), "Prince");
  assert.equal(joinName("", "Duff"), "Duff");
});

test("an athlete never receives coach_notes", () => {
  const row = { id: "a1", name: "Martin Duff", phone: "555", coachNotes: "shoulder concern" };
  const asAthlete = visibleProfile(row, false);
  assert.equal("coachNotes" in asAthlete, false, "stripped, not blanked");
  assert.equal(asAthlete.phone, "555");
});

test("a coach receives every field", () => {
  const row = { id: "a1", name: "Martin Duff", coachNotes: "shoulder concern" };
  assert.equal(visibleProfile(row, true).coachNotes, "shoulder concern");
});

test("an athlete can see but never edit email, level and status", () => {
  // birthDate is deliberately NOT in this list — it is set-once, covered below.
  const athleteKeys = editableKeys(false, { birthDate: null });
  for (const k of ["inviteEmail", "level", "status"])
    assert.equal(athleteKeys.includes(k), false, `${k} must not be athlete-editable`);
  assert.equal(
    PROFILE_FIELDS.find((f) => f.key === "birthDate")?.athleteCanSee,
    true,
    "birthDate stays visible — he supplies it once at signup and then reads it",
  );
  for (const k of ["phone", "heightIn", "school", "injuryNotes"])
    assert.equal(athleteKeys.includes(k), true, `${k} should be athlete-editable`);
  assert.equal(editableKeys(false).includes("coachNotes"), false);
  assert.equal(editableKeys(true).includes("coachNotes"), true);
});

test("missing counts only the fields a coach would actually chase", () => {
  const full = {
    firstName: "Martin", lastName: "Duff", phone: "555-0100",
    birthDate: "2000-03-02", level: "High School",
    heightIn: 74, weightLb: 190, school: "Ralston Valley",
    hsGradYear: null, bats: null, // optional — must not count
  };
  assert.deepEqual(missingProfileFields(full), []);
  const bare = { ...full, phone: null, school: "" };
  assert.deepEqual(missingProfileFields(bare).sort(), ["phone", "school"]);
});

test("guardian details are required only for a minor", () => {
  const base = {
    firstName: "Sam", lastName: "Ortiz", phone: "555", level: "Youth",
    heightIn: 60, weightLb: 110, school: "Middle School",
    guardianName: null, guardianPhone: null,
  };
  const minor = { ...base, birthDate: "2015-01-10" };
  const adult = { ...base, birthDate: "2000-01-10" };
  assert.deepEqual(
    missingProfileFields(minor).sort(),
    ["guardianName", "guardianPhone"],
  );
  assert.deepEqual(missingProfileFields(adult), []);
});

test("a field that is absent entirely counts as missing, not as complete", () => {
  // A partial object must not report itself finished — the roster's marker
  // exists to show who still owes details.
  const partial = { firstName: "Sam", lastName: "Ortiz" };
  const missing = missingProfileFields(partial);
  for (const k of ["phone", "birthDate", "level", "heightIn", "weightLb", "school"])
    assert.ok(missing.includes(k), `${k} is absent and must be reported missing`);
});

test("every field declares a section that exists, and keys are unique", () => {
  const keys = PROFILE_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate keys");
  const validSections = new Set(PROFILE_SECTIONS.map((s) => s.id));
  for (const f of PROFILE_FIELDS) {
    assert.ok(f.label.length > 0, `${f.key} needs a label`);
    assert.ok(validSections.has(f.section), `${f.key} section "${f.section}" must exist in PROFILE_SECTIONS`);
  }
});

test("birth date is set-once for an athlete: his while blank, the coach's after", () => {
  // The youth age bands derive from it and those boards are visible to every
  // athlete in the building, so he supplies it once and cannot then revise it.
  assert.equal(editableKeys(false, { birthDate: null }).includes("birthDate"), true);
  assert.equal(editableKeys(false, { birthDate: "" }).includes("birthDate"), true);
  assert.equal(
    editableKeys(false, { birthDate: "2012-06-15" }).includes("birthDate"),
    false,
  );
  // A coach's answer never depends on what is stored.
  for (const cur of [{ birthDate: null }, { birthDate: "2012-06-15" }])
    assert.equal(editableKeys(true, cur).includes("birthDate"), true);
  // Omitting the row fails closed.
  assert.equal(editableKeys(false).includes("birthDate"), false);
});

test("a set-once field stays editable while it is only being typed, not stored", () => {
  // The bug this pins: the form once decided editability from the half-typed
  // value as well as the stored one, so the field locked the instant you typed
  // into it — a fat-fingered birthday couldn't be corrected in the same
  // sitting. Editability depends on what is STORED, and nothing is stored
  // until the athlete hits Complete.
  const stored = { birthDate: null };
  assert.equal(editableKeys(false, stored).includes("birthDate"), true);
  // A typed-but-unsaved value never reaches this function, so there is no
  // shape of `stored` that a half-filled form could produce which locks it.
  assert.equal(editableKeys(false, { birthDate: "" }).includes("birthDate"), true);
  assert.equal(
    editableKeys(false, { birthDate: "2012-06-15" }).includes("birthDate"),
    false,
    "and it does lock once the value is actually stored",
  );
});
