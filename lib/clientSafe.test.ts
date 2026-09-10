import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* ------------------------------------------------------------------ *
 * No client component reaches a server-only module
 *
 * A client component importing a value out of `lib/dashboard` pulled `pg`
 * into the browser bundle and broke `next build` — the browser has no `dns`
 * module for a Postgres driver to require. TypeScript is happy with it, every
 * test passed, and the dev server answered 500 on every page.
 *
 * The reason it shipped is worse than the bug: the build check that had been
 * reporting green was grepping for "Compiled", which `next build` prints
 * before the stage that failed. Two commits went out on that.
 *
 * A `type`-only import is fine — it is erased. This looks for value imports.
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

const LIB = join(process.cwd(), "lib");

/** Modules that reach the database, directly or through another module. */
function serverOnly(): Set<string> {
  const files = walk(LIB, (f) => f.endsWith(".ts") && !f.includes(".test."));
  const imports = new Map<string, string[]>();
  for (const f of files) {
    const name = f.split(sep).pop()!.replace(/\.ts$/, "");
    const src = readFileSync(f, "utf8");
    const deps: string[] = [];
    for (const m of src.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["'](?:@\/lib\/|\.\/)([\w-]+)["']/gm))
      deps.push(m[1]);
    if (/from ["']pg["']|@\/lib\/db|from ["']\.\/db["']/.test(src)) deps.push("db");
    imports.set(name, deps);
  }
  const tainted = new Set<string>(["db"]);
  for (let pass = 0; pass < files.length; pass++) {
    let grew = false;
    for (const [name, deps] of imports)
      if (!tainted.has(name) && deps.some((d) => tainted.has(d))) {
        tainted.add(name);
        grew = true;
      }
    if (!grew) break;
  }
  return tainted;
}

test("no client component takes a value from a module that reaches the database", () => {
  const tainted = serverOnly();
  assert.ok(tainted.has("db") && tainted.has("data"), "the taint walk found nothing");

  const offenders: string[] = [];
  for (const file of walk(join(process.cwd(), "components"), (f) => f.endsWith(".tsx"))) {
    if (file.includes(".test.")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;
    for (const m of src.matchAll(/^import\s+(?!type\s)([^;]*?)from\s+["']@\/lib\/([\w-]+)["']/gm)) {
      // `import { type X }` inside the braces is erased too.
      const named = m[1].replace(/\{[^}]*\}/, (b) =>
        b.replace(/\btype\s+\w+\s*,?/g, ""),
      );
      if (!/\w/.test(named.replace(/[{},\s]/g, ""))) continue;
      if (tainted.has(m[2]))
        offenders.push(`${relative(process.cwd(), file).split(sep).join("/")} → lib/${m[2]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the taint walk reaches through a chain, not just direct imports", () => {
  const tainted = serverOnly();
  assert.equal(tainted.has("dashboard"), true, "dashboard imports db");
  assert.equal(tainted.has("scope"), true, "scope imports db");
  assert.equal(tainted.has("velo"), false, "velo is pure");
  assert.equal(tainted.has("screen"), false, "and so is screen");
  assert.equal(tainted.has("types"), false, "which is why the constants moved there");
});
