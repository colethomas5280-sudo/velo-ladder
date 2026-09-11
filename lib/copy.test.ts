import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* ------------------------------------------------------------------ *
 * No em dashes in anything an athlete reads
 *
 * Cole, on the recovery reference: "get rid of the em dashes and the use of
 * fortnight is very 19th century, not language a teenager in the 2020s use."
 *
 * A style note is the easiest kind of rule to lose. It is invisible in review,
 * nothing breaks when it slips, and the next person writing a sentence has no
 * way of knowing. So it is a test.
 *
 * Two things are deliberately allowed:
 *
 *   "—" standing alone is the placeholder for an empty cell, not prose. It is
 *   a glyph doing the job of "nothing here", and reads as one.
 *
 *   SQL `--` comment lines inside SCHEMA_SQL never reach a screen. They are
 *   comments that happen to live in a string.
 * ------------------------------------------------------------------ */

const EM = "—";

function walk(dir: string, ok: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ok));
    else if (ok(e.name)) out.push(p);
  }
  return out;
}

/** Everything that renders. Test files write for us, not for athletes. */
const SOURCES = [
  ...walk(join(process.cwd(), "components"), (f) => f.endsWith(".tsx")),
  ...walk(join(process.cwd(), "lib"), (f) => f.endsWith(".ts")),
  ...walk(join(process.cwd(), "app"), (f) => f.endsWith(".tsx")),
].filter((f) => !f.includes(".test."));

/**
 * What is left of a file once everything an athlete cannot see is removed.
 * Block comments keep their newlines so a reported line number is the real one.
 */
export function readableText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "") // SQL comments inside SCHEMA_SQL
    .replace(/"—"/g, ""); // the empty-cell placeholder
}

test("no em dash reaches an athlete", () => {
  const found: string[] = [];
  for (const file of SOURCES) {
    const lines = readableText(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (line.includes(EM))
        found.push(
          `${relative(process.cwd(), file).split(sep).join("/")}:${i + 1}: ${line.trim()}`,
        );
    });
  }
  assert.deepEqual(found, []);
});

/*
 * The check is only worth having if it can fail, and only worth trusting if
 * it lets the two exceptions through. All three cases asserted, because a
 * rule that quietly matches nothing is the failure mode of a style test.
 */
test("the check catches prose, and leaves the placeholder and SQL alone", () => {
  assert.ok(
    readableText(`const s = "watch over weeks ${EM} one bad morning";`).includes(EM),
    "prose has to be caught",
  );
  assert.equal(
    readableText(`{value(f) || "${EM}"}`).includes(EM),
    false,
    "a bare placeholder is a glyph, not writing",
  );
  assert.equal(
    readableText(`  -- a note ${EM} inside SCHEMA_SQL\n`).includes(EM),
    false,
    "SQL comments never render",
  );
  assert.equal(
    readableText(`/* a comment ${EM} for whoever maintains this */`).includes(EM),
    false,
    "and neither do ours",
  );
});

test("it is reading a real amount of source", () => {
  assert.ok(SOURCES.length > 40, `only ${SOURCES.length} files — is the walk right?`);
});
