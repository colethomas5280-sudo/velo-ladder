import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_FIELDS, visibleProfile } from "@/lib/profile";

/* ------------------------------------------------------------------ *
 * finding 1 — coachNotes must never reach the athlete it is about.
 *
 * Task 3 added the `visibleProfile` role filter to GET /api/athletes/[id]
 * but not to the list route, which serves an athlete their own row. This
 * guards both halves: the filter itself drops every hidden key, and no
 * athlete-reachable route hands a raw athlete row to `json()`.
 * ------------------------------------------------------------------ */

const HIDDEN = PROFILE_FIELDS.filter((f) => !f.athleteCanSee).map((f) => f.key);

test("visibleProfile strips every athleteCanSee:false key for an athlete", () => {
  assert.ok(HIDDEN.includes("coachNotes"), "coachNotes is the key that matters");

  // A row with every column populated, hidden fields included.
  const row: Record<string, unknown> = { id: "a1", name: "Martin Duff", archived: false };
  for (const f of PROFILE_FIELDS) row[f.key] = `value-of-${f.key}`;
  row.coachNotes = "shoulder concern — do not show the kid";

  const seen = visibleProfile(row, false);
  for (const key of HIDDEN)
    assert.equal(key in seen, false, `${key} must be deleted, not blanked`);
  assert.equal(
    JSON.stringify(seen).includes("shoulder concern"),
    false,
    "the note's text is gone from the payload too",
  );

  // The coach still gets everything.
  assert.equal(visibleProfile(row, true).coachNotes, row.coachNotes);
});

/** Every `route.ts` under app/api, recursively. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

test("no athlete-reachable route hands a raw athlete row to json()", () => {
  const apiDir = join(process.cwd(), "app", "api");
  for (const file of routeFiles(apiDir)) {
    const src = readFileSync(file, "utf8");

    // Identifiers bound to a full athlete row.
    const bound = new Set<string>();
    for (const m of src.matchAll(
      /(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*[^\n;]*?await\s+(?:getAthlete|listAthletes)\s*\(/g,
    ))
      bound.add(m[1]);

    // Any of those reaching a json(...) response — the file must run it
    // through visibleProfile somewhere.
    for (const id of bound) {
      if (!new RegExp(`json\\(\\s*${id}[.\\s)]`).test(src)) continue;
      assert.ok(
        /visibleProfile/.test(src),
        `${file}: json(${id}) ships an athlete row but the file never calls visibleProfile`,
      );
    }

    // The old bug shape: json(await listAthletes()) with no filter at all.
    assert.equal(
      /json\(\s*await\s+(?:getAthlete|listAthletes)\s*\(/.test(src),
      false,
      `${file}: a raw getAthlete/listAthletes result goes straight to json()`,
    );
  }
});
