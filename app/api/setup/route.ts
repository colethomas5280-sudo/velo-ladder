import { execScript, assertDbConfigured } from "@/lib/db";
import { SCHEMA_SQL, SEED_SQL } from "@/lib/schema";
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
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const expected = process.env.SETUP_KEY;

  if (!expected) return json({ error: "SETUP_KEY is not configured" }, 500);
  if (key !== expected) return json({ error: "Bad or missing key" }, 403);

  try {
    assertDbConfigured();
    await execScript(SCHEMA_SQL);
    const seed = url.searchParams.get("seed") === "1";
    if (seed) await execScript(SEED_SQL);
    return json({ ok: true, schema: "applied", seed });
  } catch (err) {
    return json(
      {
        error: "setup failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
}
