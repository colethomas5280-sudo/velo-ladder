import { execScript, assertDbConfigured, sql } from "@/lib/db";
import {
  SCHEMA_SQL,
  SEED_SQL,
  SCHEMA_VERSION,
  schemaTables,
  seedFingerprint,
} from "@/lib/schema";
import { missingSeedLifts, seedLifts } from "@/lib/strength";
import { ALL_SEED_RECIPES, missingSeedRecipes } from "@/lib/recipes";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One-time database initialisation. Guarded by SETUP_KEY so strangers can't
 * trigger it. Idempotent — safe to hit more than once.
 *
 *   GET /api/setup?key=YOUR_SETUP_KEY            → schema only
 *   GET /api/setup?key=YOUR_SETUP_KEY&seed=1     → schema + import the one real session
 */
/**
 * Tables the app cannot run without. Checked after the script runs, because
 * "every statement returned without error" is not the same claim as "the
 * tables are there" — and when those two came apart, the endpoint reporting
 * success was actively misleading.
 *
 * Read out of the schema rather than typed beside it. The typed list went a
 * whole version without `lift_sessions`, which meant this endpoint would have
 * reported a clean setup on a database that never got the table.
 */
const EXPECTED_TABLES = schemaTables();

/** Recipes this deploy ships, so an unsorted one means the backfill failed. */
const SEEDED_IDS = new Set(ALL_SEED_RECIPES.map((r) => r.id));

/** What actually exists, and where — the answer to "but setup said it worked". */
async function verify() {
  const [meta] = (await sql`
    SELECT current_database() AS db,
           current_schema()   AS pg_schema,
           current_setting('search_path') AS search_path
  `) as { db: string; pg_schema: string; search_path: string }[];

  const rows = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema()
  `) as { table_name: string }[];

  const present = new Set(rows.map((r) => r.table_name));
  const tablesMissing = EXPECTED_TABLES.filter((t) => !present.has(t));

  /*
   * Whether the SEED landed, which "tables" cannot answer.
   *
   * The lift menu grows by INSERT ... ON CONFLICT (key) DO NOTHING on every
   * run, and that reports nothing either way — so a deploy adding three lifts
   * looked identical to one adding none, on the response Cole reads after
   * every deploy. Deletes are soft (archived), so a seeded key never leaves
   * this table: anything named here genuinely failed to insert.
   */
  const menu = present.has("lifts")
    ? ((await sql`SELECT key, archived FROM lifts`) as {
        key: string;
        archived: boolean;
      }[])
    : [];
  const library = present.has("recipes")
    ? ((await sql`SELECT id, archived, meals FROM recipes`) as {
        id: string;
        archived: boolean;
        meals: unknown;
      }[])
    : [];

  return {
    ...meta,
    tables: Object.fromEntries(
      EXPECTED_TABLES.map((t) => [t, present.has(t)]),
    ) as Record<string, boolean>,
    missing: tablesMissing,
    lifts: {
      live: menu.filter((r) => !r.archived).length,
      archived: menu.filter((r) => r.archived).length,
      missingSeed: missingSeedLifts(menu.map((r) => r.key)),
    },
    recipes: {
      live: library.filter((r) => !r.archived).length,
      archived: library.filter((r) => r.archived).length,
      missingSeed: missingSeedRecipes(library.map((r) => r.id)),
      /*
       * SEEDED recipes that belong to no meal. "live: 51" was true and useless
       * when the question was whether the backfill had run: a stale deployment
       * has no `meals` column at all, every recipe reads as unsorted, and the
       * breakfast, lunch and dinner filters silently find nothing.
       *
       * Scoped to seeded ids on purpose. A recipe Cole adds and leaves
       * unsorted is his business, and counting it here would turn a real
       * signal into an alarm he learns to ignore.
       */
      unsorted: library.filter(
        (r) =>
          !r.archived &&
          SEEDED_IDS.has(r.id) &&
          !(Array.isArray(r.meals) && r.meals.length),
      ).length,
    },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  /*
   * The key may arrive in the query string or as a header. The header exists
   * because a query string silently mangles secrets: a raw & truncates it, #
   * never leaves the browser, + becomes a space. Those failures are
   * indistinguishable from a wrong key, so offer a channel where the value
   * cannot be reinterpreted at all.
   */
  const provided = (
    url.searchParams.get("key") ??
    request.headers.get("x-setup-key") ??
    ""
  ).trim();
  /*
   * Compare trimmed. A SETUP_KEY pasted into the dashboard with a trailing
   * newline never matches anything typed by hand, and the resulting "Bad or
   * missing key" reads as a wrong key rather than a malformed stored one —
   * which is how this database went unmigrated without anyone noticing.
   * Surrounding whitespace is a paste artifact, not part of the secret.
   */
  const expected = (process.env.SETUP_KEY ?? "").trim();

  if (!expected) return json({ error: "SETUP_KEY is not configured" }, 500);

  if (provided !== expected)
    return json(
      {
        error: "Bad or missing key",
        /*
         * Lengths only, never content. Telling the two apart is the whole
         * problem: 0 means the key never arrived, short means the query string
         * truncated it, equal-but-wrong means the value is stale or the
         * deployment predates the last env change. A length is a negligible
         * leak next to being unable to diagnose this at all.
         */
        received: provided.length,
        expected: expected.length,
        schemaVersion: SCHEMA_VERSION,
        hint:
          "Lengths differing means the key was cut off in transit — send it as " +
          "a header instead: curl -H 'x-setup-key: VALUE' <url>/api/setup. " +
          "Equal lengths that still mismatch means the running deployment has " +
          "an older value; redeploy after changing it in Vercel.",
      },
      403,
    );

  try {
    assertDbConfigured();
    await execScript(SCHEMA_SQL);

    // Confirm the tables are really there before claiming success.
    const state = await verify();
    if (state.missing.length)
      return json(
        {
          error: "setup ran but tables are missing",
          detail:
            `Applied the schema without error, yet ${state.missing.join(", ")} ` +
            `${state.missing.length === 1 ? "is" : "are"} not in schema ` +
            `"${state.pg_schema}" of database "${state.db}". That usually means ` +
            `this deployment is writing to a different database than the one ` +
            `it reads from.`,
          schemaVersion: SCHEMA_VERSION,
          ...state,
        },
        500,
      );

    const seed = url.searchParams.get("seed") === "1";
    if (seed) await execScript(SEED_SQL);
    return json({
      ok: true,
      schema: "applied",
      seed,
      // Named rather than left in the numbers: a lift that failed to insert
      // is a lift athletes cannot log, and a standard with nothing to bind to.
      ...(state.lifts.missingSeed.length || state.recipes.missingSeed.length
        ? {
            warning: [
              state.lifts.missingSeed.length &&
                `${state.lifts.missingSeed.length} seed lift(s) are not in the menu: ` +
                  `${state.lifts.missingSeed.join(", ")}. Athletes cannot log them.`,
              state.recipes.missingSeed.length &&
                `${state.recipes.missingSeed.length} seed recipe(s) are missing: ` +
                  `${state.recipes.missingSeed.join(", ")}.`,
              state.recipes.unsorted &&
                `${state.recipes.unsorted} recipe(s) belong to no meal, so the ` +
                  `breakfast, lunch and dinner filters will find nothing. ` +
                  `Usually an old deployment: check schemaVersion.`,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
      // Bumped whenever the schema changes, so a stale deployment is obvious
      // from the response rather than looking like a fresh failure.
      schemaVersion: SCHEMA_VERSION,
      /*
       * And what this deploy seeds, which the version number does not cover.
       * A corrected recipe changes no table and no version; twice the response
       * looked the same whether the fix had landed or not.
       */
      seedHash: seedFingerprint(),
      ...state,
    });
  } catch (err) {
    return json(
      {
        error: "setup failed",
        detail: err instanceof Error ? err.message : String(err),
        schemaVersion: SCHEMA_VERSION,
      },
      500,
    );
  }
}
