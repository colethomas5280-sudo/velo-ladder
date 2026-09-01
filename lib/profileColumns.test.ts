import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILE_FIELDS } from "@/lib/profile";
import { PROFILE_COLUMNS } from "@/lib/data";

/**
 * `PROFILE_FIELDS` is not quite the single source of truth the docs claim:
 * the write in `updateAthlete` is driven off a *second* list, `PROFILE_COLUMNS`
 * in `lib/data.ts`. A field present in one but not the other validates,
 * reaches the patch, and is then silently skipped by the write loop — a 200
 * that writes nothing, the exact failure this branch exists to eliminate.
 */
test("every PROFILE_FIELDS key maps to a column in lib/data.ts", () => {
  for (const f of PROFILE_FIELDS)
    assert.ok(
      f.key in PROFILE_COLUMNS,
      `${f.key} has no PROFILE_COLUMNS entry — its writes would be dropped silently`,
    );
});
