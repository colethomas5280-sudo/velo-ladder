import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* ------------------------------------------------------------------ *
 * The stylesheet and the markup agree
 *
 * Two ways they drift, both quiet in their own way. A class a component asks
 * for that the stylesheet doesn't define renders unstyled — loud when you
 * look at the page, invisible in CI. A rule nothing references is dead weight
 * that reads as live: `.mast-actions` outlived the two-button masthead it was
 * written for by three commits, and anyone reading the file would reasonably
 * have assumed the masthead still had two.
 * ------------------------------------------------------------------ */

function walk(dir: string, ok: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ok));
    else if (ok(e.name)) out.push(p);
  }
  return out;
}

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const DEFINED = new Set([...CSS.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const SOURCES = [
  ...walk(join(process.cwd(), "components"), (f) => f.endsWith(".tsx") && !f.includes(".test.")),
  ...walk(join(process.cwd(), "app"), (f) => f.endsWith(".tsx") && !f.includes(".test.")),
];

const SOURCE = SOURCES.map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * Prefixes a component completes with a value: `` `sc-trend t-${trend}` ``
 * can produce any `t-*`, so the whole family counts as referenced.
 */
const PREFIXES = [...SOURCE.matchAll(/([\w-]+)\$\{/g)].map((m) => m[1]);

/**
 * Deliberately loose, and loose in the safe direction. A class counts as used
 * if its name appears ANYWHERE in the source — not only inside a `className`
 * — because it may travel through a lookup table or a helper before it gets
 * there. Erring towards keeping a live rule beats reporting one dead and
 * having someone delete it.
 */
function isUsed(cls: string): boolean {
  if (new RegExp(`\\b${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(SOURCE))
    return true;
  return PREFIXES.some((p) => cls.startsWith(p));
}

test("every class a component asks for is defined in the stylesheet", () => {
  const missing: string[] = [];
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/className="([^"$]*)"/g))
      for (const c of m[1].split(/\s+/))
        if (c && !DEFINED.has(c))
          missing.push(`${relative(process.cwd(), file).split(sep).join("/")}: .${c}`);
  }
  assert.deepEqual(missing, []);
});

/*
 * Not a style rule but a record: this is the list as swept. A new name here
 * means a rule outlived its markup, which is the thing worth catching early.
 */
test("no rule in the stylesheet is unreachable", () => {
  const dead = [...DEFINED].filter((c) => !isUsed(c)).sort();
  assert.deepEqual(dead, []);
});

test("the check can actually fail", () => {
  assert.equal(isUsed("sc-row"), true, "a plain class is seen");
  assert.equal(isUsed("t-overdue"), true, "and one built from a template hole");
  assert.equal(isUsed("high"), true, "and one a lib helper returns");
  assert.equal(isUsed("nothing-uses-this"), false);
  assert.ok(DEFINED.size > 200, `only ${DEFINED.size} classes parsed — is the read right?`);
});
