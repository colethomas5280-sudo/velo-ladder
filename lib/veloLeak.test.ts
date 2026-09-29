import "../components/testDom";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { withSwr } from "../components/testSwr";

/* ------------------------------------------------------------------ *
 * The benchmarks never reach an athlete
 *
 * This is the requirement the velo ladder exists under, and it cannot be
 * checked by looking at a screen: the numbers can be absent from every page an
 * athlete sees and still be sitting in the JavaScript their browser downloaded.
 * Hidden is not the same as not sent.
 *
 * Four things keep that true, and each is swept here:
 *
 *   1. Nothing a browser downloads imports the coach-only modules. The import
 *      graph itself is walked by lib/clientSafe.test.ts, which this file does
 *      not repeat; it pins that walk's roots so removing one is a failure, and
 *      it covers the one place that walk does not look (client files in app/).
 *   2. The BUILT client bundle, .next/static, holds none of the sentinel
 *      strings. This is the check that would catch a leak the import walk
 *      misses, because it reads what actually shipped.
 *   3. Every route under app/api/velo refuses a signed-out caller (401) and a
 *      signed-in non-coach (403), whatever method it exports. Routes are found
 *      on disk, so one added later is covered without anyone remembering.
 *   4. The athlete nav has no velo entry. (The scoring guide page, whose
 *      athlete case is a different mechanism, is covered by
 *      lib/guidePage.test.ts and is not repeated here.)
 *
 * Every "found nothing" below is paired with a control that proves the search
 * could have found something. A sweep that looks in an empty place and reports
 * a clean bill of health is the failure this file exists to avoid.
 * ------------------------------------------------------------------ */

const ROOT = process.cwd();

function walk(dir: string, ok: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ok));
    else if (ok(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

/* ================================================================== *
 * 1. The import walk's roots, and client files it does not look at
 * ================================================================== */

/**
 * The modules that must be roots of the taint walk in lib/clientSafe.test.ts.
 * veloData is deliberately absent: it reaches the database, so the walk taints
 * it through "db" without it being named. The other three are roots in their
 * own right because none of them touches the database yet each carries
 * coach-only content (all 25 rows, the coaching wording, the classifier).
 */
const REQUIRED_ROOTS = ["veloSeed", "veloPlacement", "veloConfig"];

/**
 * Source with its comments removed. The roots below are pinned by reading
 * clientSafe.test.ts as TEXT, and text matching treats a commented-out line as
 * present: `// if (...) deps.push("veloSeed");` satisfies a search for
 * `deps.push("veloSeed")` while doing nothing at all. Strip first, then match.
 * Only a `//` at the start of a line or after whitespace counts, so a URL
 * inside a string is left alone.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** The taint walk's root set, and the modules it has a rule marking as imported. */
function walkRoots(clientSafeSrc: string): { found: boolean; roots: string[]; pushed: string[] } {
  const src = withoutComments(clientSafeSrc);
  const m = /^[ \t]*const tainted = new Set<string>\(\[([^\]]*)\]\)/m.exec(src);
  return {
    found: m !== null,
    roots: m ? [...m[1].matchAll(/["']([\w-]+)["']/g)].map((x) => x[1]) : [],
    pushed: [...src.matchAll(/^[ \t]*(?:if\b[^\n]*)?\bdeps\.push\(["']([\w-]+)["']\)/gm)].map((x) => x[1]),
  };
}

test("commented-out roots do not count as roots", () => {
  const live = [
    'const tainted = new Set<string>(["db", "veloSeed"]);',
    '  if (/x/.test(src)) deps.push("veloSeed");',
  ].join("\n");
  assert.deepEqual(walkRoots(live), { found: true, roots: ["db", "veloSeed"], pushed: ["veloSeed"] });

  // The whole set line, the push rule, one root inside the set: each commented.
  const setOut = live.replace(/^const tainted/, "// const tainted");
  assert.equal(walkRoots(setOut).found, false);
  const pushOut = live.replace(/^  if/m, "  // if");
  assert.deepEqual(walkRoots(pushOut).pushed, []);
  const rootOut = 'const tainted = new Set<string>(["db", /* "veloSeed" */ "x"]);';
  assert.deepEqual(walkRoots(rootOut).roots, ["db", "x"]);
  const trailing = 'const tainted = new Set<string>(["db"]); // "veloSeed"';
  assert.deepEqual(walkRoots(trailing).roots, ["db"]);
});

test("lib/clientSafe.test.ts still names the velo modules as roots of its walk", () => {
  const src = readFileSync(join(ROOT, "lib", "clientSafe.test.ts"), "utf8");

  // The set the walk starts from.
  const { found, roots, pushed } = walkRoots(src);
  assert.ok(
    found,
    "could not find the walk's root set in lib/clientSafe.test.ts (or it is commented out). If it was " +
      "restructured, update this test to read the new shape; do not delete it.",
  );
  assert.ok(roots.includes("db"), "db is the root that taints veloData");
  for (const root of REQUIRED_ROOTS) {
    assert.ok(roots.includes(root), `${root} was removed from the walk's roots in lib/clientSafe.test.ts`);
    // A root in the set does nothing unless something pushes it into the
    // graph when a file imports it.
    assert.ok(
      pushed.includes(root),
      `nothing in lib/clientSafe.test.ts marks a file that imports ${root}`,
    );
    assert.ok(
      statSync(join(ROOT, "lib", `${root}.ts`)).isFile(),
      `lib/${root}.ts is gone; a root naming a missing module guards nothing`,
    );
  }

  // veloData is covered by inheritance, so pin the inheritance: it must still
  // import the database, or nothing taints it any more.
  const veloData = readFileSync(join(ROOT, "lib", "veloData.ts"), "utf8");
  assert.ok(
    /from ["']@\/lib\/db["']|from ["']\.\/db["']/.test(veloData),
    "lib/veloData.ts no longer imports the database, so the walk no longer taints it",
  );
});

/** Modules no browser code may take a value from. */
const COACH_ONLY_MODULES = ["veloSeed", "veloData", "veloPlacement", "veloConfig", "db", "data"];

/**
 * Value imports of a coach-only module in one file's source. A `type` import
 * (whole statement, or every specifier) is erased by the compiler and does not
 * count. Written as a function so the controls below can prove it bites.
 */
function coachOnlyValueImports(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(/^import\s+(?!type\s)([^;]*?)from\s+["']([^"']+)["']/gm)) {
    const mod = /(?:^|\/)lib\/([\w-]+)$|^\.\/([\w-]+)$/.exec(m[2]);
    const name = mod?.[1] ?? mod?.[2];
    if (!name || !COACH_ONLY_MODULES.includes(name)) continue;
    // `import { type X }` erases too, leaving nothing behind.
    const named = m[1].replace(/\{[^}]*\}/, (b) => b.replace(/\btype\s+\w+\s*,?/g, ""));
    if (!/\w/.test(named.replace(/[{},\s]/g, ""))) continue;
    hits.push(name);
  }
  return hits;
}

test("the value-import detector flags what it should and ignores what is erased", () => {
  assert.deepEqual(coachOnlyValueImports('import { veloSeedData } from "@/lib/veloSeed";'), ["veloSeed"]);
  assert.deepEqual(coachOnlyValueImports('import { listVeloRanges } from "@/lib/veloData";'), ["veloData"]);
  assert.deepEqual(coachOnlyValueImports('import { evaluate } from "../../lib/veloPlacement";'), ["veloPlacement"]);
  assert.deepEqual(coachOnlyValueImports('import { sql } from "@/lib/db";'), ["db"]);
  assert.deepEqual(coachOnlyValueImports('import type { VeloRange } from "@/lib/veloTypes";'), []);
  assert.deepEqual(coachOnlyValueImports('import type { Hand } from "@/lib/veloPlacement";'), []);
  assert.deepEqual(coachOnlyValueImports('import { type Hand } from "@/lib/veloPlacement";'), []);
  assert.deepEqual(coachOnlyValueImports('import { fetcher } from "@/lib/fetcher";'), []);
});

/**
 * Every file that ships to the browser, given path -> source for the
 * candidates: the files that say "use client", plus anything they import by
 * relative path, and so on down. A shared component with no directive of its
 * own is bundled into the browser all the same, and selecting by the
 * directive alone skipped it (components/VeloSources.tsx had none). A
 * `type`-only import is erased and pulls nothing in.
 */
function clientClosure(sources: Map<string, string>): string[] {
  const client = new Set(
    [...sources].filter(([, src]) => /^\s*["']use client["']/m.test(src)).map(([f]) => f),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of [...client]) {
      const src = sources.get(f)!;
      for (const m of src.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
        const base = resolve(dirname(f), m[1]);
        const target = [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].find((t) =>
          sources.has(t),
        );
        if (target && !client.has(target)) {
          client.add(target);
          grew = true;
        }
      }
    }
  }
  return [...client];
}

test("the client closure follows relative imports, so a file with no directive cannot hide", () => {
  const dir = join(ROOT, "components");
  const at = (n: string) => join(dir, n);
  const sources = new Map([
    [at("A.tsx"), '"use client";\nimport S from "./S";\nimport type { T } from "./TypeOnly";\nimport { z } from "./sub/Deep";'],
    [at("S.tsx"), 'import D from "./Deeper";\nexport default 1;'], // no directive
    [at("Deeper.tsx"), "export default 2;"], // reached only through S
    [at("TypeOnly.tsx"), "export type T = 1;"], // erased, must not count
    [at("sub/Deep.ts"), "export const z = 1;"],
    [at("Server.tsx"), "export default 3;"], // imported by nobody
  ]);
  assert.deepEqual(
    clientClosure(sources).map((f) => relative(dir, f)).sort(),
    ["A.tsx", "Deeper.tsx", "S.tsx", "sub/Deep.ts"],
  );
});

test("no client file under app/ or components/ takes a value from a coach-only module", () => {
  /*
   * lib/clientSafe.test.ts walks components/ only. A "use client" file under
   * app/ would ship to the browser just the same and is not looked at there,
   * so this covers it. (A server page under app/ may import lib/veloSeed: it
   * runs on the server, and app/velo/page.tsx does exactly that.)
   */
  const sources = new Map<string, string>();
  for (const dir of ["components", "app"])
    for (const f of walk(join(ROOT, dir), (n) => /\.tsx?$/.test(n) && !n.includes(".test.")))
      sources.set(f, readFileSync(f, "utf8"));
  const client = clientClosure(sources);

  // Control: the search has to actually be looking at client components.
  assert.ok(
    client.some((f) => rel(f) === "components/VeloLadder.tsx"),
    "components/VeloLadder.tsx was not seen as a client file, so this sweep is not reading what it thinks it is",
  );
  assert.ok(client.length >= 10, `only ${client.length} client files found; the sweep is not reaching them`);

  const offenders: string[] = [];
  for (const f of client)
    for (const name of coachOnlyValueImports(readFileSync(f, "utf8"))) offenders.push(`${rel(f)} -> ${name}`);
  assert.deepEqual(offenders, []);
});

/* ================================================================== *
 * 2. The built client bundle
 * ================================================================== */

/** What an athlete's browser can fetch. `.next/server` is deliberately not it. */
const STATIC_DIR = join(ROOT, ".next", "static");
const BUILD_ID = join(ROOT, ".next", "BUILD_ID");

/** The spec's four strings. Matched case-insensitively, which is stricter than the spec. */
const SENTINELS = ["Elite Trajectory", "Velocity Ranges", "velo_ranges", "Eisenmann"];

/**
 * Strings that MUST be in the client bundle, or a clean result means nothing.
 * "Elite Ref" is the ladder's column header; the route path is the calculator's
 * fetch target. Both are text the browser genuinely needs, and neither is one
 * of the sentinels.
 */
const MUST_BE_PRESENT = ["Elite Ref", "api/velo/evaluate"];

const BUILD_HINT =
  "Run `npm run build` first, then run the tests again. This test reads the " +
  "built client bundle, and it fails rather than skips when there is none: a " +
  "skipped test reads as a pass, which is exactly the false comfort it exists to remove.";

/** Non-test source that ends up in a build. Tests and their helpers never do. */
function newestSource(): { file: string; mtimeMs: number } {
  const isSource = (n: string) =>
    /\.(tsx?|css|md|json)$/.test(n) && !/\.test\.[tj]sx?$/.test(n) && !/^test[A-Z]\w*\.tsx?$/.test(n);
  let best = { file: "", mtimeMs: 0 };
  for (const dir of ["app", "components", "lib", "content", "db"])
    for (const f of walk(join(ROOT, dir), isSource)) {
      const t = statSync(f).mtimeMs;
      if (t > best.mtimeMs) best = { file: rel(f), mtimeMs: t };
    }
  return best;
}

test("the built client bundle contains none of the sentinel strings", () => {
  let files: string[] = [];
  try {
    files = walk(STATIC_DIR, () => true);
  } catch {
    /* handled below, with the same message as an empty directory */
  }
  assert.ok(files.length > 0, `.next/static is missing or empty. ${BUILD_HINT}`);

  /*
   * A bundle built before the last edit says nothing about the code that is
   * there now. `npm run verify` runs the tests BEFORE its own build, so this is
   * the situation it is in after any edit: the previous build is still on disk.
   * Failing here, loudly, is the alternative to passing on stale evidence.
   */
  let builtAt: number;
  try {
    builtAt = statSync(BUILD_ID).mtimeMs;
  } catch {
    assert.fail(`.next/BUILD_ID is missing, so the age of the build is unknown. ${BUILD_HINT}`);
  }
  const src = newestSource();
  assert.ok(
    src.mtimeMs <= builtAt,
    `${src.file} was changed after the last build, so .next/static does not describe the code as it is now. ${BUILD_HINT}`,
  );

  const texts = files.map((f) => ({ file: rel(f), text: readFileSync(f).toString("latin1") }));

  /*
   * Positive control. If these are not found, then either the directory is not
   * the client bundle, or the scan cannot read it, and "found no sentinels" is
   * empty. Checked before the sentinels so the failure says which it is.
   */
  for (const known of MUST_BE_PRESENT)
    assert.ok(
      texts.some((t) => t.text.includes(known)),
      `positive control failed: "${known}" must be in the client bundle but was not found in ` +
        `${files.length} files under .next/static, so a clean sentinel scan would prove nothing. ` +
        `Either this is not a build of the current app, or the text was deliberately changed: ` +
        `in the second case update MUST_BE_PRESENT in lib/veloLeak.test.ts, otherwise run \`npm run build\`.`,
    );

  const hits: string[] = [];
  for (const s of SENTINELS) {
    const needle = s.toLowerCase();
    for (const t of texts) if (t.text.toLowerCase().includes(needle)) hits.push(`"${s}" found in ${t.file}`);
  }
  assert.deepEqual(hits, [], "a coach-only string is in the code an athlete's browser downloads");
});

/* ================================================================== *
 * 3. Every velo route refuses a non-coach
 * ================================================================== */

const COACH = "coach@leak.test";
const ATHLETE = "kid@leak.test";
const STRANGER = "nobody@leak.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-ladder-leak-"));
process.env.PGLITE_DIR = DB_DIR;
process.env.COACH_EMAILS = COACH;
after(async () => {
  // A live PGlite holds the event loop open.
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

let signedInAs: string | null = null;
/*
 * `exports` is the current option name; @types/node 20 still describes the
 * `namedExports` spelling this runtime deprecates, so the cast is the types
 * lagging rather than a shape being smuggled past them.
 */
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

before(async () => {
  const db = await import("@/lib/db");
  await db.execScript((await import("@/lib/schema")).SCHEMA_SQL);
  // A real athlete row: this is the scope a signed-in non-coach with an
  // account has. STRANGER has none and resolves to role "none".
  await db.sql`
    INSERT INTO athletes (id, name, invite_email)
    VALUES ('leak-kid', 'Leak Kid', ${ATHLETE})
  `;
});

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * A body that would be ACCEPTED from the coach, keyed by the route's path
 * under app/api/velo. It has to be valid, not merely present: a 403 for a
 * request that would also have been a 400 proves nothing about the gate.
 *
 * A route that exports a body-carrying method and is not listed throws, so
 * whoever adds one has to say what a good request looks like.
 */
const VALID_BODIES: Record<string, unknown> = {
  evaluate: { slug: "16u-hs-jv-soph", hand: "R", floor: 74, sitting: 79, peak: 83 },
};
const BODY_METHODS: Method[] = ["POST", "PUT", "PATCH"];

interface VeloRoute {
  name: string; // path under app/api/velo, e.g. "ranges"
  file: string;
  handlers: { method: Method; fn: Handler }[];
}

/** Any route module Next would serve, not only the `route.ts` spelling. */
const ROUTE_FILE = /^route\.[jt]sx?$/;

test("route discovery accepts every spelling of a route file and nothing else", () => {
  for (const n of ["route.ts", "route.tsx", "route.js", "route.jsx"]) assert.ok(ROUTE_FILE.test(n), n);
  for (const n of ["route.test.ts", "routes.ts", "route.d.ts", "myroute.ts", "route.tsx.bak"])
    assert.equal(ROUTE_FILE.test(n), false, n);
});

async function veloRoutes(): Promise<VeloRoute[]> {
  const base = join(ROOT, "app", "api", "velo");
  const out: VeloRoute[] = [];
  for (const file of walk(base, (n) => ROUTE_FILE.test(n)).sort()) {
    const name = relative(base, file).split(sep).slice(0, -1).join("/");
    if (name.includes("[")) {
      throw new Error(
        `${rel(file)}: a dynamic segment under app/api/velo. Decide what to pass for it in this sweep.`,
      );
    }
    const mod = (await import(file)) as Partial<Record<Method, Handler>>;
    const handlers = METHODS.filter((m) => typeof mod[m] === "function").map((m) => ({
      method: m,
      fn: mod[m] as Handler,
    }));
    assert.ok(handlers.length > 0, `${rel(file)} exports no HTTP method handler`);
    out.push({ name, file, handlers });
  }
  return out;
}

function requestFor(route: VeloRoute, method: Method): Request {
  const url = `http://leak.test/api/velo/${route.name}`;
  if (!BODY_METHODS.includes(method)) return new Request(url, { method });
  if (!(route.name in VALID_BODIES))
    throw new Error(
      `${route.file}: exports ${method} but VALID_BODIES has no entry for '${route.name}'. ` +
        `Add a body the coach would be allowed to send, so a 403 here proves the gate.`,
    );
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(VALID_BODIES[route.name]),
  });
}

const call = (route: VeloRoute, h: { method: Method; fn: Handler }) =>
  h.fn(requestFor(route, h.method), { params: Promise.resolve({}) });

/** An error body says nothing but that the caller was refused. */
function assertBareRefusal(text: string, what: string) {
  for (const s of SENTINELS)
    assert.equal(text.toLowerCase().includes(s.toLowerCase()), false, `${what}: body contains "${s}"`);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ["error"], `${what}: a refusal carries only an error message`);
}

test("the sweep finds every velo route on disk, including the three that exist today", async () => {
  const routes = await veloRoutes();
  const names = routes.map((r) => r.name);
  for (const expected of ["evaluate", "ranges", "sources"])
    assert.ok(names.includes(expected), `${expected} was not discovered under app/api/velo (found: ${names.join(", ")})`);
  const evaluate = routes.find((r) => r.name === "evaluate")!;
  assert.deepEqual(
    evaluate.handlers.map((h) => h.method),
    ["POST"],
    "evaluate exports POST and the sweep must call the method the route really has",
  );
  const ranges = routes.find((r) => r.name === "ranges")!;
  assert.deepEqual(ranges.handlers.map((h) => h.method), ["GET"]);
});

test("the coach is served by every velo route, so the refusals below are about the gate", async () => {
  signedInAs = COACH;
  for (const route of await veloRoutes())
    for (const h of route.handlers) {
      const res = await call(route, h);
      const text = await res.text();
      assert.equal(res.status, 200, `${h.method} /api/velo/${route.name} as the coach: ${text}`);
      assert.ok(text.length > 20, `${h.method} /api/velo/${route.name} answered the coach with an empty body`);
    }
});

test("every velo route refuses a signed-out request with 401", async () => {
  signedInAs = null;
  for (const route of await veloRoutes())
    for (const h of route.handlers) {
      const what = `${h.method} /api/velo/${route.name} signed out`;
      const res = await call(route, h);
      const text = await res.text();
      assert.equal(res.status, 401, `${what}: ${text}`);
      assertBareRefusal(text, what);
    }
});

test("every velo route refuses a signed-in athlete with 403", async () => {
  signedInAs = ATHLETE;
  for (const route of await veloRoutes())
    for (const h of route.handlers) {
      const what = `${h.method} /api/velo/${route.name} as an athlete`;
      const res = await call(route, h);
      const text = await res.text();
      assert.equal(res.status, 403, `${what}: ${text}`);
      assertBareRefusal(text, what);
    }
});

test("every velo route refuses a signed-in user with no athlete record with 403", async () => {
  signedInAs = STRANGER;
  for (const route of await veloRoutes())
    for (const h of route.handlers) {
      const what = `${h.method} /api/velo/${route.name} as a non-coach with no athlete`;
      const res = await call(route, h);
      const text = await res.text();
      assert.equal(res.status, 403, `${what}: ${text}`);
      assertBareRefusal(text, what);
    }
});

/* ================================================================== *
 * 4. The athlete nav
 * ================================================================== */

test("the athlete nav has no velo entry, and the coach nav does", async () => {
  const { default: AppHeader } = await import("../components/AppHeader");
  const links = (role: "coach" | "athlete") => {
    const me = { role, email: "x@leak.test", athleteId: role === "athlete" ? "leak-kid" : null };
    const { container } = render(withSwr({ "/api/me": me }, createElement(AppHeader, { email: me.email })));
    // The brand mark is also a link named "Velo Ladder"; only the nav counts.
    const items = [...container.querySelectorAll(".topnav a")];
    const hrefs = items.map((a) => a.getAttribute("href") ?? "");
    const labels = items.map((a) => a.textContent ?? "");
    cleanup();
    return { hrefs, labels };
  };

  const coach = links("coach");
  // Control: the coach's nav is where the entry lives, so it has to be seen.
  assert.ok(coach.hrefs.includes("/velo"), `the coach nav lost its velo entry: ${coach.hrefs.join(" ")}`);
  assert.ok(coach.hrefs.includes("/velo/guide"), "the coach nav lost the scoring guide entry");
  assert.ok(coach.labels.includes("Velo Ladder"), "the coach nav's ladder entry is not labelled as this test expects");

  const athlete = links("athlete");
  assert.ok(athlete.hrefs.includes("/leaderboard"), `the athlete nav did not render: ${athlete.hrefs.join(" ")}`);
  assert.deepEqual(
    athlete.hrefs.filter((h) => h.startsWith("/velo")),
    [],
    "an athlete's nav links to a velo page",
  );
  assert.deepEqual(
    athlete.labels.filter((l) => /velo ladder|scoring guide/i.test(l)),
    [],
    "an athlete's nav names the ladder or the guide",
  );
});
