import { neon, Pool } from "@neondatabase/serverless";

/**
 * Two backends behind one interface:
 *
 *  - Production / real Postgres: the Neon serverless driver (Vercel Postgres
 *    injects DATABASE_URL automatically).
 *  - Local dev with zero setup: set USE_PGLITE=1 and an in-process WASM
 *    Postgres (PGlite) is used instead, persisted to ./.pglite-data.
 *
 * `sql` is a tagged-template query function (always parameterized).
 * `pgPool` is a node-postgres-shaped { query } — the Auth.js adapter needs it.
 * `execScript` runs a multi-statement SQL string (schema / seed).
 */

const USE_PGLITE = process.env.USE_PGLITE === "1";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

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

/* ---------------- PGlite backend ---------------- */

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

const pgliteSql: SqlTag = async (strings, ...values) => {
  const text = strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
  const db = await getPglite();
  const res = await db.query(text, values as unknown[]);
  return res.rows as never;
};

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

/* ---------------- Neon backend ---------------- */

const neonSql = neon(
  connectionString || "postgresql://invalid:invalid@localhost:5432/invalid",
);
const neonPoolInstance = new Pool({ connectionString });
const neonPool: PgPool = {
  async query(text, params) {
    const r = await neonPoolInstance.query(text, params);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 };
  },
};

/* ---------------- exports ---------------- */

export const sql: SqlTag = USE_PGLITE ? pgliteSql : (neonSql as unknown as SqlTag);
export const pgPool: PgPool = USE_PGLITE ? pglitePool : neonPool;

export async function execScript(script: string): Promise<void> {
  if (USE_PGLITE) {
    const db = await getPglite();
    await db.exec(script);
    return;
  }
  // Neon: run statements one at a time (the driver won't batch multiple in
  // one query). The schema has no ';' inside any statement.
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
    await neonPoolInstance.query(stmt);
  }
}
