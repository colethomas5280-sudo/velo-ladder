import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* ------------------------------------------------------------------ *
 * Every URL the client asks for is a route that exists
 *
 * A mistyped SWR key does not throw. `useSWR("/api/mee")` returns undefined
 * forever and the component sits on its loading branch, which looks exactly
 * like a slow network. Nothing in the app notices, and no other test would:
 * the leak sweep calls handlers directly and never sees a URL a component
 * typed.
 * ------------------------------------------------------------------ */

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, match));
    else if (match(e.name)) out.push(p);
  }
  return out;
}

/** Route paths on disk, e.g. `/api/athletes/[id]/screens`. */
function routes(): string[] {
  const base = join(process.cwd(), "app");
  return walk(join(base, "api"), (f) => f === "route.ts").map(
    (p) => "/" + relative(base, p).split(sep).slice(0, -1).join("/"),
  );
}

/** Every `/api/...` string a component or lib module asks for. */
function referenced(): { path: string; from: string }[] {
  const files = [
    ...walk(join(process.cwd(), "components"), (f) => f.endsWith(".tsx") && !f.includes(".test.")),
    ...walk(join(process.cwd(), "lib"), (f) => f.endsWith(".ts") && !f.includes(".test.")),
  ];
  const out: { path: string; from: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["`](\/api\/[^"`\s]*)["`]/g))
      out.push({ path: m[1], from: relative(process.cwd(), file) });
  }
  return out;
}

/** Does a referenced URL land on a route? Template holes fill one segment. */
function resolves(url: string, all: string[]): boolean {
  const wanted = url
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, "*")
    .split("/")
    .filter(Boolean);
  return all.some((r) => {
    const parts = r.split("/").filter(Boolean);
    if (parts.length !== wanted.length) return false;
    return parts.every(
      (p, i) => p === wanted[i] || p.startsWith("[") || wanted[i] === "*",
    );
  });
}

test("every /api path the client asks for has a route behind it", () => {
  const all = routes();
  assert.ok(all.length > 10, `only found ${all.length} routes — is the walk right?`);

  const missing = referenced()
    .filter((r) => !resolves(r.path, all))
    .map((r) => `${r.from}: ${r.path}`);
  assert.deepEqual(missing, []);
});

/*
 * The check above is only worth having if it can fail. A path that resolves
 * by accident — because every segment happens to be a dynamic one — would
 * make it decorative.
 */
test("the check refuses a path with no route", () => {
  const all = routes();
  assert.equal(resolves("/api/me", all), true);
  assert.equal(resolves("/api/athletes/${id}/screens", all), true);
  assert.equal(resolves("/api/mee", all), false, "a typo must not resolve");
  assert.equal(resolves("/api/athletes/${id}/screenz", all), false);
  assert.equal(resolves("/api/athletes/${id}/screens/extra", all), false, "too deep");
});
