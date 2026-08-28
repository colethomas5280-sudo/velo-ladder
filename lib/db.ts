import { Pool, types } from "pg";

/**
 * One query interface over two backends:
 *
 *  - Production / any real Postgres (Supabase, Vercel Postgres, Neon, …):
 *    node-postgres, driven by DATABASE_URL.
 *  - Local dev with zero setup: set USE_PGLITE=1 and an in-process WASM
 *    Postgres (PGlite) is used instead, persisted to ./.pglite-data.
 *
 * `sql`        — tagged-template query (always parameterized) → returns rows
 * `pgPool`     — node-postgres-shaped { query }; the Auth.js adapter needs it
 * `execScript` — runs a multi-statement SQL string (schema / seed)
 */

const USE_PGLITE = process.env.USE_PGLITE === "1";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

export function assertDbConfigured() {
  if (!USE_PGLITE && !connectionString) {
    throw new Error(
      "No database connection string. Set DATABASE_URL, or USE_PGLITE=1 for local dev.",
    );
  }
}

export type SqlTag = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

export interface PgPool {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

/* ---------------- PGlite backend (local dev) ---------------- */

type PGliteModule = typeof import("@electric-sql/pglite");
let pglitePromise: Promise<InstanceType<PGliteModule["PGlite"]>> | null = null;
function getPglite() {
  if (!pglitePromise) {
    pglitePromise = import("@electric-sql/pglite").then(
      ({ PGlite }) => new PGlite(process.env.PGLITE_DIR || "./.pglite-data"),
    );
  }
  return pglitePromise;
}

const pglitePool: PgPool = {
  async query(text, params) {
    const db = await getPglite();
    const res = await db.query(text, params);
    const rows = res.rows as Record<string, unknown>[];
    return {
      rows,
      rowCount:
        rows.length ||
        (typeof res.affectedRows === "number" ? res.affectedRows : 0),
    };
  },
};

/* ---------------- node-postgres backend (production) ---------------- */

const isLocal = /localhost|127\.0\.0\.1|::1/.test(connectionString);
const nodePool = new Pool({
  connectionString: connectionString || undefined,
  ssl: isLocal || !connectionString ? undefined : { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 20_000,
});
const nodePgPool: PgPool = {
  async query(text, params) {
    const r = await nodePool.query(text, params);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 };
  },
};

/* ---------------- exports ---------------- */

export const pgPool: PgPool = USE_PGLITE ? pglitePool : nodePgPool;

export const sql: SqlTag = async (strings, ...values) => {
  const text = strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
  const res = await pgPool.query(text, values as unknown[]);
  return res.rows as never;
};

export async function execScript(script: string): Promise<void> {
  if (USE_PGLITE) {
    const db = await getPglite();
    await db.exec(script);
    return;
  }
  // Run statements one at a time (safe with connection poolers). The schema
  // has no ';' inside any statement; strip comment lines from each chunk.
  const statements = script
    .split(";")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  for (const stmt of statements) {
    await nodePool.query(stmt);
  }
}
