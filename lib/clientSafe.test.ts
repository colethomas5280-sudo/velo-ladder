import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

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
    // velo_ranges/velo_sources are coach-only: lib/veloSeed.ts holds all 25
    // rows in a module-scope constant, and a client component pulling a value
    // out of it would ship every row to every browser regardless of whether
    // veloSeed itself ever touches the database. It is a root in its own
    // right, not just another node the "db" walk happens to reach.
    if (/@\/lib\/veloSeed|from ["']\.\/veloSeed["']/.test(src)) deps.push("veloSeed");
    // lib/veloPlacement.ts carries the coach's coaching wording word for word
    // (the disclosures, the classification labels). The coach's rule is that
    // none of it may be in code the browser downloads, and a value import into
    // a client component is exactly how it would get there. So it is a root
    // too. A type-only import is erased and is not an offender; the component
    // check below already skips those.
    if (/@\/lib\/veloPlacement|from ["']\.\/veloPlacement["']/.test(src)) deps.push("veloPlacement");
    // lib/veloConfig.ts holds the classifier's thresholds. It is not wording,
    // but the coach's rule is that the classifier stays on the server, and the
    // component was deliberately moved off this import. Nothing enforced that
    // until it was a root: a future edit could put the import back and every
    // other test would stay green.
    if (/@\/lib\/veloConfig|from ["']\.\/veloConfig["']/.test(src)) deps.push("veloConfig");
    imports.set(name, deps);
  }
  const tainted = new Set<string>(["db", "veloSeed", "veloPlacement", "veloConfig"]);
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

/**
 * Every component file that ships to the browser.
 *
 * Starts from the files that say `"use client"`, then adds any component
 * file they import by relative path (`./X`, `../X`), and so on down. A shared
 * component with no directive of its own is bundled into the browser all the
 * same because a client component imports it, and selecting by the directive
 * alone skipped it: components/VeloSources.tsx had no directive, and a value
 * import of a server-only module into it would have passed this whole test.
 * A `type`-only import is erased, so it does not pull anything in.
 */
function clientFiles(): string[] {
  const files = walk(join(process.cwd(), "components"), (f) => f.endsWith(".tsx")).filter(
    (f) => !f.includes(".test."),
  );
  const known = new Set(files);
  const client = new Set(files.filter((f) => readFileSync(f, "utf8").includes('"use client"')));
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of [...client]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
        const target = resolve(dirname(f), m[1]) + ".tsx";
        if (known.has(target) && !client.has(target)) {
          client.add(target);
          grew = true;
        }
      }
    }
  }
  return [...client];
}

test("no client component takes a value from a module that reaches the database", () => {
  const tainted = serverOnly();
  assert.ok(tainted.has("db") && tainted.has("data"), "the taint walk found nothing");

  const offenders: string[] = [];
  for (const file of clientFiles()) {
    const src = readFileSync(file, "utf8");
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
  assert.equal(tainted.has("veloPlacement"), true, "veloPlacement holds the coach's wording");
  assert.equal(tainted.has("veloConfig"), true, "veloConfig holds the classifier's thresholds");
  assert.equal(tainted.has("velo"), false, "velo is pure");
  assert.equal(tainted.has("screen"), false, "and so is screen");
  assert.equal(tainted.has("types"), false, "which is why the constants moved there");
});
