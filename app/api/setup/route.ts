import { execScript, assertDbConfigured, sql } from "@/lib/db";
import { SCHEMA_SQL, SEED_SQL, SCHEMA_VERSION } from "@/lib/schema";
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
 */
const EXPECTED_TABLES = [
  "athletes",
  "training_sessions",
  "recovery_entries",
  "setbacks",
  "resources",
] as const;

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
  return {
    ...meta,
    tables: Object.fromEntries(
      EXPECTED_TABLES.map((t) => [t, present.has(t)]),
    ) as Record<string, boolean>,
    missing: EXPECTED_TABLES.filter((t) => !present.has(t)),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const expected = process.env.SETUP_KEY;

  if (!expected) return json({ error: "SETUP_KEY is not configured" }, 500);

  /*
   * Compare trimmed. A SETUP_KEY pasted into the dashboard with a trailing
   * newline never matches anything typed by hand, and the resulting "Bad or
   * missing key" reads as a wrong key rather than a malformed stored one —
   * which is how this database went unmigrated without anyone noticing.
   * Surrounding whitespace is a paste artifact, not part of the secret.
   */
  if (key?.trim() !== expected.trim())
    return json(
      {
        error: "Bad or missing key",
        hint:
          "Copy SETUP_KEY from Vercel → Settings → Environment Variables. " +
          "If it contains + & # % or a space, URL-encode it — a raw + in a " +
          "query string is read as a space.",
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
      // Bumped whenever the schema changes, so a stale deployment is obvious
      // from the response rather than looking like a fresh failure.
      schemaVersion: SCHEMA_VERSION,
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
