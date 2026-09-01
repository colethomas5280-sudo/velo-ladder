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

test("an athlete can see but not edit email, level and status", () => {
  const athleteKeys = editableKeys(false);
  for (const k of ["inviteEmail", "level", "status"])
    assert.equal(athleteKeys.includes(k), false, `${k} must not be athlete-editable`);
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
    positions: null, hsGradYear: null, bats: null, // optional — must not count
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
