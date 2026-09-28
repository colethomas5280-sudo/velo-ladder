import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * The scoring guide page never hands the guide to a non-coach
 *
 * The guide reaches the browser as a prop from a server component, and a
 * prop is serialized into the payload. So the role has to be decided before
 * the file is read; hiding the text client-side would still ship all of it.
 *
 * This calls the real page with the real getScope against a real PGlite
 * database, then serializes what the page returned. The element tree is
 * JSON-stringified because that is the honest stand-in for the payload: every
 * prop, at any depth, ends up in the string. The coach case is asserted to
 * contain the guide's text, which is what proves the athlete case is not
 * passing simply because the guide was never available to leak.
 * ------------------------------------------------------------------ */

const COACH = "coach@velo.test";
const ATHLETE = "kid@velo.test";
const STRANGER = "nobody@velo.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-ladder-guide-"));
process.env.PGLITE_DIR = DB_DIR;
process.env.COACH_EMAILS = COACH;
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

let signedInAs: string | null = null;
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

type Page = typeof import("../app/velo/guide/page");
let page: Page;

before(async () => {
  const db = await import("@/lib/db");
  await db.execScript((await import("@/lib/schema")).SCHEMA_SQL);
  await db.sql`
    INSERT INTO athletes (id, name, invite_email)
    VALUES ('guide-kid', 'Guide Kid', ${ATHLETE})
  `;
  page = await import("../app/velo/guide/page");
});

/** Phrases lifted from the guide file itself, so an edit that drops one is loud. */
const GUIDE_TEXT = readFileSync("content/evaluation-scoring-guide.md", "utf8");
const PHRASES = [
  "Limitation to disclose every time",
  "Outlier tiers",
  "Never let the placement read more certain than the row backing it",
];

async function serialized(): Promise<string> {
  return JSON.stringify(await page.default());
}

test("the phrases this file asserts on are really in the guide", () => {
  for (const p of PHRASES) assert.ok(GUIDE_TEXT.includes(p), p);
});

test("a coach's page carries the guide", async () => {
  signedInAs = COACH;
  const out = await serialized();
  for (const p of PHRASES) assert.ok(out.includes(p), `coach page is missing: ${p}`);
});

test("an athlete's page carries none of the guide", async () => {
  signedInAs = ATHLETE;
  const out = await serialized();
  for (const p of PHRASES)
    assert.ok(!out.includes(p), `athlete page leaked: ${p}`);
  assert.ok(out.includes("coaches only"), "the athlete is told why");
});

test("a signed-in user with no athlete record gets none of the guide either", async () => {
  signedInAs = STRANGER;
  const out = await serialized();
  for (const p of PHRASES) assert.ok(!out.includes(p), `page leaked: ${p}`);
});

test("a signed-out request is redirected before the guide is read", async () => {
  signedInAs = null;
  await assert.rejects(() => page.default(), (e: unknown) => {
    const digest = (e as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT") && digest.includes("/login");
  });
});
