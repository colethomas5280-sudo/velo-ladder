# Athlete Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An intake form an athlete fills in when he joins and keeps current afterwards, so the coach stops chasing details.

**Architecture:** The fields are **one config array** in `lib/profile.ts`, following the codebase's existing declarative pattern (`TRACKERS`, `WELLNESS_SECTIONS`, `LEVELS`). The form, the API's validation and write-allowlist, the role filter, and the roster's completeness count all derive from that one array — so they cannot disagree about which fields exist or who may see them. Name splits into `first_name`/`last_name` with `name` kept as a display string written only by a single function, so no existing display code changes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres via `pg` (PGlite locally with `USE_PGLITE=1`), SWR on the client, Node's built-in test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-31-athlete-profile-design.md`

## Global Constraints

- **`coach_notes` is stripped server-side by role**, never merely hidden in the UI.
- **No new cross-athlete visibility.** `canSeeAthlete` in `lib/scope.ts` must not change. The leaderboard's name/band/hand/velocity stays the only thing one athlete sees about another.
- An athlete may **view but not edit** his own `email`, `level` and `status`.
- **Three states per field:** absent → unchanged; valid value → set; explicit `null` → cleared; **invalid value → 400, nothing written.** This is the birth-date fix — a malformed value must never blank what is stored.
- `name` is only ever written as `first + " " + last`, from one function.
- Validation ranges: `height_in` 30–90, `weight_lb` 50–500, grad years 1900–2100, `bats` ∈ R/L/S, `status` ∈ On-Site/Remote.
- Schema changes are additive (`ADD COLUMN IF NOT EXISTS`) and bump `SCHEMA_VERSION`. Target: **v14**.
- Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` before each commit. Lint reports **8 pre-existing errors** in `components/*.tsx`; the count must not increase.
- Node is via nvm: `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"` before any node/npm command.
- **Never run `/api/setup` against production.** All verification uses the local PGlite database.

---

### Task 1: The field config and its pure helpers

**Files:**
- Create: `lib/profile.ts`
- Test: `lib/profile.test.ts`

**Interfaces:**
- Consumes: `Athlete` from `lib/types.ts`; `LEVELS` from `lib/leaderboard.ts`.
- Produces:
  ```ts
  export type FieldKind = "text" | "number" | "date" | "select" | "textarea";
  export interface ProfileField {
    key: string; label: string; kind: FieldKind;
    section: "identity" | "physical" | "school" | "contact" | "health";
    /** false = coach only, for both editing and reading */
    athleteCanSee: boolean;
    athleteCanEdit: boolean;
    required?: boolean;
    requiredIfMinor?: boolean;
    options?: readonly string[];
    min?: number; max?: number; maxLength?: number;
    unit?: string; help?: string;
  }
  export const PROFILE_FIELDS: ProfileField[]
  export const PROFILE_SECTIONS: { id: ProfileField["section"]; title: string }[]
  export function splitName(full: string): { first: string; last: string }
  export function joinName(first: string, last: string): string
  export function visibleProfile<T extends Record<string, unknown>>(
    athlete: T, isCoach: boolean,
  ): Partial<T>
  export function editableKeys(isCoach: boolean): string[]
  export function missingProfileFields(a: {
    [k: string]: unknown; birthDate?: string | null;
  }): string[]
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/profile.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitName, joinName, visibleProfile, editableKeys,
  missingProfileFields, PROFILE_FIELDS,
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
    birthDate: "2009-03-02", level: "High School",
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

test("every field declares a section that exists, and keys are unique", () => {
  const keys = PROFILE_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate keys");
  for (const f of PROFILE_FIELDS)
    assert.ok(f.label.length > 0, `${f.key} needs a label`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/profile'`

- [ ] **Step 3: Write the implementation**

Create `lib/profile.ts`:

```ts
import { LEVELS } from "./leaderboard";

/* ------------------------------------------------------------------ *
 * The athlete profile, as data.
 *
 * One array drives the form, the API's write-allowlist and validation,
 * the role filter, and the roster's completeness count. They cannot
 * disagree about which fields exist or who may see them, because there
 * is only one list to disagree with.
 * ------------------------------------------------------------------ */

export type FieldKind = "text" | "number" | "date" | "select" | "textarea";

export interface ProfileField {
  key: string;
  label: string;
  kind: FieldKind;
  section: "identity" | "physical" | "school" | "contact" | "health";
  /** false = coach only, for reading as well as writing */
  athleteCanSee: boolean;
  athleteCanEdit: boolean;
  /** counts toward the roster's "N missing" marker */
  required?: boolean;
  /** counts only when the athlete is under 18 */
  requiredIfMinor?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  unit?: string;
  help?: string;
}

export const PROFILE_SECTIONS: { id: ProfileField["section"]; title: string }[] = [
  { id: "identity", title: "Who you are" },
  { id: "physical", title: "Physical" },
  { id: "school", title: "School" },
  { id: "contact", title: "Contact" },
  { id: "health", title: "Health" },
];

export const STATUSES = ["On-Site", "Remote"] as const;
export const BATS = ["R", "L", "S"] as const;

export const PROFILE_FIELDS: ProfileField[] = [
  // identity
  { key: "firstName", label: "First name", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 80 },
  { key: "lastName", label: "Last name", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 80 },
  { key: "birthDate", label: "Date of birth", kind: "date", section: "identity",
    athleteCanSee: true, athleteCanEdit: true, required: true },
  // His login. Editable by the coach only: a typo here locks him out.
  { key: "inviteEmail", label: "Login email", kind: "text", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, maxLength: 200 },
  // Stamps his records, so it is a program decision rather than a preference.
  { key: "level", label: "Level", kind: "select", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, required: true, options: LEVELS },
  { key: "status", label: "Training", kind: "select", section: "identity",
    athleteCanSee: true, athleteCanEdit: false, options: STATUSES },

  // physical
  { key: "heightIn", label: "Height", kind: "number", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, required: true,
    min: 30, max: 90, unit: "in", help: "Inches — 6'0\" is 72" },
  { key: "weightLb", label: "Weight", kind: "number", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, required: true,
    min: 50, max: 500, unit: "lb" },
  { key: "hand", label: "Throws", kind: "select", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, options: ["R", "L"] },
  { key: "bats", label: "Bats", kind: "select", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, options: BATS },
  { key: "positions", label: "Positions", kind: "text", section: "physical",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 60 },

  // school
  { key: "school", label: "School", kind: "text", section: "school",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 120 },
  { key: "hsGradYear", label: "HS grad year", kind: "number", section: "school",
    athleteCanSee: true, athleteCanEdit: true, min: 1900, max: 2100 },
  { key: "collegeGradYear", label: "College grad year", kind: "number", section: "school",
    athleteCanSee: true, athleteCanEdit: true, min: 1900, max: 2100 },

  // contact
  { key: "phone", label: "Phone", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, required: true, maxLength: 40 },
  { key: "guardianName", label: "Parent / guardian", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, requiredIfMinor: true, maxLength: 120 },
  { key: "guardianPhone", label: "Parent / guardian phone", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, requiredIfMinor: true, maxLength: 40 },
  { key: "emergencyContact", label: "Emergency contact", kind: "text", section: "contact",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 200 },

  // health
  { key: "injuryNotes", label: "Injury history", kind: "textarea", section: "health",
    athleteCanSee: true, athleteCanEdit: true, maxLength: 2000,
    help: "Anything that has kept you off the mound, and anything limiting you now" },
  // The coach's own notes. Never leaves the server for an athlete.
  { key: "coachNotes", label: "Coach notes", kind: "textarea", section: "health",
    athleteCanSee: false, athleteCanEdit: false, maxLength: 2000,
    help: "Only you can see this" },
];

/**
 * Split on the LAST space. "Mary Jo Smith" is far more likely to be
 * Mary Jo / Smith than Mary / Jo Smith; a compound surname like
 * "Juan de la Cruz" comes out wrong and gets fixed on the roster.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** The ONLY way `name` is ever built. */
export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

/**
 * Drop fields this viewer may not see. Deletes the key rather than
 * blanking it — a null `coachNotes` in a payload still tells an athlete
 * the field exists.
 */
export function visibleProfile<T extends Record<string, unknown>>(
  athlete: T,
  isCoach: boolean,
): Partial<T> {
  if (isCoach) return { ...athlete };
  const hidden = new Set(
    PROFILE_FIELDS.filter((f) => !f.athleteCanSee).map((f) => f.key),
  );
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(athlete))
    if (!hidden.has(k)) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Keys this role may write. The API's allowlist, not a UI hint. */
export function editableKeys(isCoach: boolean): string[] {
  return PROFILE_FIELDS.filter((f) => isCoach || f.athleteCanEdit).map((f) => f.key);
}

const isBlank = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "");

/** Whole years old today, or null when there is no birth date. */
function ageToday(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - by;
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/**
 * Which required fields are still blank. Only the ones a coach actually
 * chases count — marking every row for a missing "positions" would be
 * the same as marking none of them.
 */
export function missingProfileFields(a: {
  [k: string]: unknown;
  birthDate?: string | null;
}): string[] {
  const age = ageToday(a.birthDate as string | null | undefined);
  const isMinor = age != null && age < 18;
  return PROFILE_FIELDS.filter(
    (f) => (f.required || (f.requiredIfMinor && isMinor)) && isBlank(a[f.key]),
  ).map((f) => f.key);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: all pass (8 new tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/profile.ts lib/profile.test.ts
git commit -m "Add the athlete profile field config

One array drives the form, the API's write allowlist and validation,
the role filter and the roster's completeness count, so they cannot
disagree about which fields exist or who may see them.

visibleProfile deletes a hidden key rather than blanking it — a null
coachNotes in a payload still tells an athlete the field is there."
```

---

### Task 2: Schema v14 and the data layer

**Files:**
- Modify: `lib/schema.ts` (bump to 14, add columns, backfill names)
- Modify: `lib/types.ts` (`Athlete` gains the profile fields)
- Modify: `lib/data.ts` (`toAthlete`, `createAthlete`, `updateAthlete`)
- Modify: `db/schema.sql` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: `splitName`, `joinName` from Task 1.
- Produces: `updateAthlete(id, patch)` where every profile key accepts `undefined` (unchanged) or a value or `null` (cleared); `Athlete` carries every profile field.

- [ ] **Step 1: Add the columns and backfill names**

In `lib/schema.ts`, set `SCHEMA_VERSION = 14` and add after the existing `ALTER TABLE athletes` block:

```sql
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS height_in int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_lb numeric(5,1);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_source text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_at date;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS bats text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS positions text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS school text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS hs_grad_year int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS college_grad_year int;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS guardian_name text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS guardian_phone text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS emergency_contact text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS injury_notes text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS coach_notes text;

-- Backfill first/last from the existing single name, splitting on the LAST
-- space. Runs once: only rows that have never been split are touched, so a
-- coach's later correction is never overwritten by a re-run of setup.
UPDATE athletes
   SET first_name = CASE
         WHEN position(' ' in btrim(name)) = 0 THEN btrim(name)
         ELSE btrim(substring(btrim(name) from 1 for length(btrim(name)) - position(' ' in reverse(btrim(name)))))
       END,
       last_name = CASE
         WHEN position(' ' in btrim(name)) = 0 THEN ''
         ELSE substring(btrim(name) from length(btrim(name)) - position(' ' in reverse(btrim(name))) + 2)
       END
 WHERE first_name IS NULL AND name IS NOT NULL;
```

- [ ] **Step 2: Extend the Athlete type**

In `lib/types.ts`, add to `interface Athlete`:

```ts
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  heightIn: number | null;
  weightLb: number | null;
  /** "checkin" | "entered" — where weightLb came from */
  weightSource: string | null;
  weightAt: string | null;
  bats: string | null;
  positions: string | null;
  school: string | null;
  hsGradYear: number | null;
  collegeGradYear: number | null;
  status: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  emergencyContact: string | null;
  injuryNotes: string | null;
  /** coach only — stripped from an athlete's response by visibleProfile */
  coachNotes: string | null;
```

- [ ] **Step 3: Read the columns**

In `lib/data.ts`, add to `toAthlete`:

```ts
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    heightIn: r.height_in == null ? null : Number(r.height_in),
    weightLb: r.weight_lb == null ? null : Number(r.weight_lb),
    weightSource: (r.weight_source as string | null) ?? null,
    weightAt: r.weight_at ? isoDate(r.weight_at) : null,
    bats: (r.bats as string | null) ?? null,
    positions: (r.positions as string | null) ?? null,
    school: (r.school as string | null) ?? null,
    hsGradYear: r.hs_grad_year == null ? null : Number(r.hs_grad_year),
    collegeGradYear: r.college_grad_year == null ? null : Number(r.college_grad_year),
    status: (r.status as string | null) ?? null,
    guardianName: (r.guardian_name as string | null) ?? null,
    guardianPhone: (r.guardian_phone as string | null) ?? null,
    emergencyContact: (r.emergency_contact as string | null) ?? null,
    injuryNotes: (r.injury_notes as string | null) ?? null,
    coachNotes: (r.coach_notes as string | null) ?? null,
```

- [ ] **Step 4: Write them, with `name` always derived**

Rewrite `updateAthlete`'s patch resolution in `lib/data.ts`. Replace the existing per-field `??` chain with a generic one, since seventeen hand-written ternaries is where a field gets forgotten:

```ts
import { joinName, splitName } from "./profile";

/** Column for each camelCase profile key. */
const PROFILE_COLUMNS: Record<string, string> = {
  firstName: "first_name", lastName: "last_name", phone: "phone",
  heightIn: "height_in", weightLb: "weight_lb",
  weightSource: "weight_source", weightAt: "weight_at",
  bats: "bats", positions: "positions", school: "school",
  hsGradYear: "hs_grad_year", collegeGradYear: "college_grad_year",
  status: "status", guardianName: "guardian_name",
  guardianPhone: "guardian_phone", emergencyContact: "emergency_contact",
  injuryNotes: "injury_notes", coachNotes: "coach_notes",
  level: "level", birthDate: "birth_date", hand: "hand",
  inviteEmail: "invite_email",
};
```

`updateAthlete`'s patch type becomes `Partial<Record<keyof typeof PROFILE_COLUMNS, string | number | null>> & { archived?: boolean; password?: string; cnsThresholdPct?: number | null }`.

Resolution rule, applied to every profile key: **`undefined` leaves the stored value alone; anything else is written, including `null`.** Build the SET list from only the keys actually present in the patch.

Two behaviours must survive this rewrite, or existing screens break:

**`name` stays an accepted input.** The roster's inline rename PATCHes `name` directly.
Accept it, split it, and let the derivation below rebuild it — otherwise renaming an
athlete silently stops working:

```ts
  if (patch.name !== undefined && patch.firstName === undefined && patch.lastName === undefined) {
    const s = splitName(String(patch.name ?? ""));
    patch.firstName = s.first;
    patch.lastName = s.last;
  }
```

**`invite_email` keeps its normalisation.** Logins are matched on
`lower(invite_email)`, so a raw write of "Bob@Example.COM " locks that athlete out:

```ts
  if (patch.inviteEmail !== undefined)
    patch.inviteEmail = String(patch.inviteEmail ?? "").trim().toLowerCase() || null;
```

Then derive `name` whenever either half changes:

```ts
  /*
   * `name` is a display string, never independently authored. Deriving it
   * here — the single write path — is what stops it drifting from the
   * first/last columns the profile edits.
   */
  const first = patch.firstName !== undefined ? String(patch.firstName ?? "") : (cur.firstName ?? splitName(cur.name).first);
  const last = patch.lastName !== undefined ? String(patch.lastName ?? "") : (cur.lastName ?? splitName(cur.name).last);
  const name = joinName(first, last) || cur.name;
```

`createAthlete` splits the supplied `name` into `first_name`/`last_name` on insert so a new athlete is never created unsplit.

- [ ] **Step 5: Verify against a real database**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
pkill -f "next dev"; rm -rf .pglite-data
npm run dev > /tmp/velo-dev.log 2>&1 &
sleep 9
curl -s "http://localhost:3000/api/setup?key=dev-setup-key&seed=1"
```

Expected: `"schemaVersion":14`, `"missing":[]`. Then confirm the seeded athlete backfilled — `GET /api/athletes/seed-md` with a coach cookie should show `"firstName":"Martin","lastName":"Duff"`. Run setup a second time and confirm the backfill does not re-run over an edited name.

- [ ] **Step 6: Regenerate the checked-in schema**

```bash
npx tsx -e 'import {SCHEMA_SQL,SCHEMA_VERSION} from "./lib/schema"; import {writeFileSync} from "fs";
writeFileSync("db/schema.sql", `-- Generated from lib/schema.ts (SCHEMA_VERSION ${SCHEMA_VERSION}). Do not edit by hand.\n-- Applied by GET /api/setup?key=SETUP_KEY\n${SCHEMA_SQL}`);'
```

- [ ] **Step 7: Check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`

```bash
git add lib/schema.ts lib/types.ts lib/data.ts db/schema.sql
git commit -m "Schema v14: athlete profile columns and the name split

first/last backfill from the existing name by splitting on the last
space, once — only rows never split are touched, so a coach's later
correction survives a re-run of setup.

name stays the display string every existing view uses, but is now
derived from first+last on the single write path, so nothing else can
author it and the two cannot drift."
```

---

### Task 3: The API — role filter, allowlist, and the birth-date fix

**Files:**
- Modify: `app/api/athletes/[id]/route.ts` (GET filter, PATCH rewrite)
- Create: `lib/profileInput.ts`
- Test: `lib/profileInput.test.ts`

**Interfaces:**
- Consumes: `PROFILE_FIELDS`, `editableKeys`, `visibleProfile` (Task 1); `updateAthlete` (Task 2).
- Produces:
  ```ts
  export type Parsed =
    | { ok: true; patch: Record<string, string | number | null> }
    | { ok: false; error: string };
  export function parseProfilePatch(body: Record<string, unknown>, isCoach: boolean): Parsed
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/profileInput.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/profileInput'`

- [ ] **Step 3: Write the implementation**

Create `lib/profileInput.ts`:

```ts
import { PROFILE_FIELDS, editableKeys, type ProfileField } from "./profile";
import { isValidBirthDate } from "./leaderboard";

export type Parsed =
  | { ok: true; patch: Record<string, string | number | null> }
  | { ok: false; error: string };

function parseOne(f: ProfileField, raw: unknown): { value: string | number | null } | { error: string } {
  if (raw === null) return { value: null }; // an explicit, deliberate clear

  if (f.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `${f.label} must be a number` };
    if (f.min != null && n < f.min) return { error: `${f.label} must be at least ${f.min}` };
    if (f.max != null && n > f.max) return { error: `${f.label} must be at most ${f.max}` };
    return { value: n };
  }

  if (f.kind === "date") {
    if (typeof raw !== "string" || !isValidBirthDate(raw))
      return { error: `${f.label} must be a real date, and not in the future` };
    return { value: raw };
  }

  if (typeof raw !== "string") return { error: `${f.label} must be text` };
  if (f.options && !f.options.includes(raw))
    return { error: `${f.label} must be one of: ${f.options.join(", ")}` };
  if (f.maxLength && raw.length > f.maxLength)
    return { error: `${f.label} must be ${f.maxLength} characters or fewer` };
  return { value: raw };
}

/**
 * Turn a request body into a patch, or refuse it.
 *
 * Three states per field, and an invalid value is none of them: absent
 * leaves the stored value alone, an explicit null clears it, a valid value
 * sets it. A malformed value is a 400 that writes NOTHING — the old
 * behaviour mapped a bad birth date to null and cleared it, which quietly
 * dropped that athlete off his age board with nothing to announce it.
 */
export function parseProfilePatch(
  body: Record<string, unknown>,
  isCoach: boolean,
): Parsed {
  const allowed = new Set(editableKeys(isCoach));
  const patch: Record<string, string | number | null> = {};

  for (const [key, raw] of Object.entries(body)) {
    const f = PROFILE_FIELDS.find((x) => x.key === key);
    if (!f) continue; // not a profile field — password/archived are handled elsewhere
    if (raw === undefined) continue;
    if (!allowed.has(key))
      return { ok: false, error: `You can't change ${f.label.toLowerCase()} — ask your coach` };

    const r = parseOne(f, raw);
    if ("error" in r) return { ok: false, error: r.error };
    patch[key] = r.value;
  }

  return { ok: true, patch };
}
```

- [ ] **Step 4: Wire it into the route**

In `app/api/athletes/[id]/route.ts`:

`GET` filters by role — this is the line that keeps `coachNotes` off an athlete's wire:

```ts
  return json(visibleProfile(athlete, scope.role === "coach"));
```

`PATCH` uses one path for both roles, replacing the two hand-written branches:

```ts
  const isCoach = scope.role === "coach";
  if (!isCoach && !scope.athleteIds.includes(id)) return forbidden();

  const parsed = parseProfilePatch(body, isCoach);
  if (!parsed.ok) return badRequest(parsed.error);

  // Coach-only controls that are not profile fields, carried over unchanged
  // from the branch this replaces.
  const extra: { cnsThresholdPct?: number | null } = {};
  if (isCoach && body.cnsThresholdPct !== undefined) {
    const raw = body.cnsThresholdPct;
    if (raw === null || raw === "") extra.cnsThresholdPct = null;
    else {
      const n = Number(raw);
      if (!(n > 0 && n <= 50))
        return badRequest("CNS band must be between 0 and 50 percent");
      extra.cnsThresholdPct = n;
    }
  }

  // Weight entered here is authored, not observed — record that, so the
  // profile can say where the number came from. A later check-in overwrites
  // both (Task 4).
  const stamped =
    parsed.patch.weightLb !== undefined
      ? { weightSource: "entered", weightAt: new Date().toISOString().slice(0, 10) }
      : {};

  const updated = await updateAthlete(id, {
    ...parsed.patch, ...stamped, ...extra, password,
  });
  return json(visibleProfile(updated!, isCoach));
```

Keep the existing password rule (min 6 characters, either role, own account).

- [ ] **Step 5: Verify against the running app**

With the dev server seeded, confirm as an **athlete**: `GET /api/athletes/<own id>` has no `coachNotes` key at all; `PATCH {"coachNotes":"x"}` is refused; `PATCH {"level":"Pro"}` is refused; `PATCH {"phone":"555-0100"}` succeeds. As **coach**: `PATCH {"birthDate":"2009-13-45"}` returns 400 **and the stored date is unchanged** — this is the regression the fix exists for.

- [ ] **Step 6: Check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`

```bash
git add lib/profileInput.ts lib/profileInput.test.ts "app/api/athletes/[id]/route.ts"
git commit -m "Validate profile writes, and stop a bad value clearing a good one

Three states per field: absent leaves it alone, an explicit null clears
it, a valid value sets it. A malformed value is a 400 that writes
nothing — previously a mistyped birth date was mapped to null and
stored, dropping that athlete off his age board with nothing to say so.

GET now strips coach-only fields by role. Hiding coachNotes in the UI
would have left it one fetch away."
```

---

### Task 4: A check-in keeps the profile weight current

**Files:**
- Modify: `lib/data.ts` (`upsertRecovery`)

**Interfaces:**
- Consumes: the `weight_lb` / `weight_source` / `weight_at` columns (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Update the profile weight after a check-in**

In `upsertRecovery`, after the check-in row is written:

```ts
  /*
   * The profile weight follows the most recent reading rather than
   * competing with it. A kid who checks in keeps it current without ever
   * opening his profile; a kid who never checks in keeps the number he
   * gave at signup. One value, one meaning, and the card shows which.
   *
   * Guarded on the date so back-filling an old check-in cannot overwrite
   * a newer weight with a staler one.
   */
  if (input.bodyWeight != null)
    await sql`
      UPDATE athletes
         SET weight_lb = ${input.bodyWeight},
             weight_source = 'checkin',
             weight_at = ${input.date}
       WHERE id = ${athleteId}
         AND (weight_at IS NULL OR weight_at <= ${input.date})
    `;
```

Where a coach or athlete sets the weight from the profile form, `weight_source` is `'entered'` and `weight_at` is today — set that in the route (Task 3) when `weightLb` is present in the patch.

- [ ] **Step 2: Verify the provenance flips**

With the dev server running: set an athlete's weight from the profile (expect `weightSource: "entered"`), then POST a check-in dated today with a different `bodyWeight`, and confirm the athlete's `weightLb` now matches the check-in with `weightSource: "checkin"`. Then POST a check-in dated a week **earlier** with a third value and confirm the weight does **not** move.

- [ ] **Step 3: Check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`

```bash
git add lib/data.ts
git commit -m "Feed the profile weight from check-ins

The profile weight follows the most recent reading rather than
competing with it, so it neither goes stale nor becomes a second answer
to what an athlete weighs. Guarded on the date, so back-filling an old
check-in cannot overwrite a newer weight with a staler one."
```

---

### Task 5: The profile form

**Files:**
- Create: `components/ProfileForm.tsx`
- Create: `app/profile/page.tsx`
- Modify: `components/AppHeader.tsx` (nav entry)
- Modify: `components/AthleteProfile.tsx` (coach's section)
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `PROFILE_FIELDS`, `PROFILE_SECTIONS` (Task 1); `GET`/`PATCH /api/athletes/[id]` (Task 3); `fetcher`, `api`, `ApiError` from `lib/fetcher.ts`.
- Produces: nothing downstream.

- [ ] **Step 1: Build the form**

Create `components/ProfileForm.tsx`. Everything renders from the config, so nothing
about which fields exist or who may edit them is written twice:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { fmtDate } from "@/lib/velo";
import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  type ProfileField,
} from "@/lib/profile";

type Row = Record<string, unknown>;

export default function ProfileForm({
  athleteId,
  isCoach,
  welcome = false,
}: {
  athleteId: string;
  isCoach: boolean;
  /*
   * Passed in rather than read from the URL here. This component renders in
   * two places, and useSearchParams would drag a Suspense requirement onto
   * the coach's athlete page — a build error, not a runtime one.
   */
  welcome?: boolean;
}) {
  const { data, mutate, isLoading } = useSWR<Row>(
    `/api/athletes/${athleteId}`,
    fetcher,
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (isLoading) return <p className="widget-empty">Loading…</p>;
  if (!data) return <p className="widget-empty">Couldn&apos;t load this profile.</p>;

  const shown = (f: ProfileField) => f.key in data;
  const editable = (f: ProfileField) => isCoach || f.athleteCanEdit;
  const value = (f: ProfileField) =>
    edits[f.key] ?? (data[f.key] == null ? "" : String(data[f.key]));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      /*
       * Send only what changed, and send "" as null — an emptied box is a
       * deliberate clear, which the API treats differently from a field
       * that was never mentioned.
       */
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(edits)) patch[k] = v === "" ? null : v;
      await api(`/api/athletes/${athleteId}`, "PATCH", patch);
      setEdits({});
      setSaved(true);
      await mutate();
      setTimeout(() => setSaved(false), 2600);
    } catch (e) {
      // The API returns one specific message per bad field, and that message
      // is the whole point of refusing the write instead of clearing it.
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
    }
    setBusy(false);
  }

  return (
    <section className="card pad pf">
      <div className="sec-h">
        <h3>{isCoach ? "Profile" : "My profile"}</h3>
        {Object.keys(edits).length > 0 && <span className="sub">unsaved changes</span>}
      </div>

      {welcome && (
        <p className="insight">
          Finish setting up your profile — your coach needs a few details, and it
          only takes a minute.
        </p>
      )}

      {PROFILE_SECTIONS.map((section) => {
        const fields = PROFILE_FIELDS.filter(
          (f) => f.section === section.id && shown(f),
        );
        if (!fields.length) return null;

        return (
          <div className="pf-section" key={section.id}>
            <div className="eyebrow">{section.title}</div>

            {fields.map((f) => (
              <div className="ci-row pf-row" key={f.key}>
                <div className="ci-label">
                  <b>{f.label}</b>
                  {f.help && <span className="wl-help">{f.help}</span>}
                </div>

                {!editable(f) ? (
                  <div className="pf-locked">
                    {value(f) || "—"}
                    <span>your coach sets this</span>
                  </div>
                ) : f.kind === "select" ? (
                  <select
                    aria-label={f.label}
                    value={value(f)}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : f.kind === "textarea" ? (
                  <textarea
                    aria-label={f.label}
                    value={value(f)}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    aria-label={f.label}
                    type={f.kind === "date" ? "date" : "text"}
                    inputMode={f.kind === "number" ? "numeric" : undefined}
                    value={value(f)}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  />
                )}

                {f.unit && editable(f) && <span className="pf-unit">{f.unit}</span>}

                {f.key === "weightLb" && data.weightAt != null && (
                  <p className="pf-prov">
                    {data.weightSource === "checkin"
                      ? `from check-in, ${fmtDate(String(data.weightAt))}`
                      : `entered ${fmtDate(String(data.weightAt))}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn primary"
          disabled={busy || !Object.keys(edits).length}
          onClick={save}
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="cz-note">Saved</span>}
      </div>
    </section>
  );
}
```

Two things this leans on rather than reimplementing: a field the viewer may not see is
simply **absent from the response**, so `shown()` needs no role logic of its own; and
an emptied box sends `null`, which the API reads as a deliberate clear rather than a
missing field.

- [ ] **Step 2: Add the page and nav**

Create `app/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getScope } from "@/lib/scope";
import ProfileForm from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const scope = await getScope();
  if (!scope) redirect("/login");
  // A coach has no profile of their own; send them to the roster.
  if (scope.role !== "athlete" || !scope.athleteIds.length) redirect("/athletes");
  const { welcome } = await searchParams;
  return (
    <ProfileForm
      athleteId={scope.athleteIds[0]}
      isCoach={false}
      welcome={welcome === "1"}
    />
  );
}
```

In `components/AppHeader.tsx`, add `{ href: "/profile", label: "My profile" }` to the **athlete** list only — a coach reaches profiles through the roster.

- [ ] **Step 3: Add the coach's section**

In `components/AthleteProfile.tsx`, render `<ProfileForm athleteId={athleteId} isCoach />` inside the existing coach-only block (the `canManage` conditional around line 313), so a coach edits the profile on the page they already open.

- [ ] **Step 4: Style it**

Append to `app/globals.css`, tokens only so both themes follow:

```css
.pf { max-width: 720px; }
.pf-section {
  border-top: 1px solid var(--line-soft);
  padding-top: 14px;
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.pf-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pf-row .ci-label { width: 170px; flex: 0 0 auto; }
.pf-row input,
.pf-row select,
.pf-row textarea {
  flex: 1 1 220px;
  min-width: 0;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13.5px;
  color: var(--ink);
  font-family: inherit;
}
.pf-row textarea { min-height: 74px; resize: vertical; }
.pf-locked {
  flex: 1 1 220px;
  font-size: 13.5px;
  color: var(--ink-dim);
  padding: 8px 0;
}
.pf-locked span { color: var(--ink-faint); font-size: 12px; margin-left: 8px; }
.pf-unit { font-size: 12.5px; color: var(--ink-faint); }
.pf-prov { font-size: 12.5px; color: var(--ink-faint); margin-top: 2px; }
```

- [ ] **Step 5: Verify in a browser**

As a **coach**: open an athlete, fill every section, save, reload, confirm it persisted. Enter an out-of-range height and confirm the error appears in the form and nothing was written.

As that **athlete**: open My profile. Email, level and training status render read-only. Injury history is editable. **Coach notes are absent from the page entirely** — confirm in the network tab that the key is not in the response, not merely hidden.

- [ ] **Step 6: Check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`

```bash
git add components/ProfileForm.tsx app/profile components/AppHeader.tsx components/AthleteProfile.tsx app/globals.css
git commit -m "Add the athlete profile form

One component behind two doors — My profile for the athlete, a section
of the athlete page for the coach — so the coach view is never the
neglected one. Fields render from the config, including whether they
are editable, so the form cannot drift from what the API accepts."
```

---

### Task 6: Roster completeness and the signup landing

**Files:**
- Modify: `components/AthletesTable.tsx` (missing marker)
- Modify: `components/JoinForm.tsx` (redirect to the profile)
- Modify: `app/api/athletes/overview/route.ts` (carry the count)

**Interfaces:**
- Consumes: `missingProfileFields` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Carry the count to the roster**

`AthleteOverview` in `lib/types.ts` gains `missing: number`. In
`app/api/athletes/overview/route.ts`, map it onto each row as it is built:

```ts
import { missingProfileFields } from "@/lib/profile";

// …where the overview rows are returned:
return json(
  rows.map((a) => ({ ...a, missing: missingProfileFields(a).length })),
);
```

Computing it server-side keeps the required-field rule in one place instead of
duplicating the list in the table component.

- [ ] **Step 2: Show it**

In `components/AthletesTable.tsx`, in the name cell, render a marker when `a.missing > 0`:

```tsx
{a.missing > 0 && (
  <span className="pf-missing" title="Profile fields still blank">
    {a.missing} missing
  </span>
)}
```

with:

```css
.pf-missing {
  font-family: var(--font-mono), monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: 8px;
  white-space: nowrap;
}
```

- [ ] **Step 3: Land a new athlete on their profile**

In `components/JoinForm.tsx`, change the post-signin redirect from
`window.location.href = "/"` to `window.location.href = "/profile?welcome=1"`.

That is the whole change. **Do not add a banner** — Task 5's `ProfileForm` already
renders one from its `welcome` prop, and `app/profile/page.tsx` already reads the query
param and passes it down.

- [ ] **Step 4: Verify**

Create an athlete with only a name and email, and confirm the roster shows a missing count. Fill the profile and confirm the count drops. Redeem an invite and confirm the athlete lands on the profile with the banner.

- [ ] **Step 5: Check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`

```bash
git add components/AthletesTable.tsx components/JoinForm.tsx app/api/athletes/overview/route.ts app/globals.css
git commit -m "Show who still owes details, and land new athletes on their profile

Chasing detail is the job this feature removes, so the roster shows who
needs a nudge without opening anyone. The count is computed server-side
so the required-field rule lives in one place."
```

---

### Task 7: Documentation

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Document it**

Add a `## Athlete profile` section covering: the config array as the single source for form, validation, role filter and completeness; the name split with `name` derived by one writer and the compound-surname caveat; the three-state write rule and why (a bad value must never clear a good one); `coachNotes` stripped server-side; weight fed by check-ins with provenance and the date guard; and the required-field list behind "N missing".

Add the new columns to the data-model block, and `/profile` plus the profile fields to the routes table.

- [ ] **Step 2: Commit**

```bash
git add HANDOFF.md
git commit -m "Document the athlete profile"
```

---

## Notes for the executor

- **Never run `/api/setup` against production.** Cole runs it himself and needs to see `"schemaVersion":14` with `"missing":[]`.
- **`npm test` covers `lib/` only.** Route and UI verification is by the browser and curl steps written into each task.
- **Lint has 8 pre-existing errors** in `components/*.tsx`. Not yours to fix; confirm the count does not grow.
- The seeded coach is `coach@test.com` / `coachpass123`; setup key for local dev is `dev-setup-key`.
