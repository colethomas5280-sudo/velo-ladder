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
  // Run statements one at a time (safe with connection poolers). On failure,
  // say which statement blew up — a bare Postgres message is not enough to
  // find it in a multi-statement script.
  const statements = splitStatements(script);
  for (let i = 0; i < statements.length; i++) {
    try {
      await nodePool.query(statements[i]);
    } catch (e) {
      const first = statements[i].split("\n")[0].slice(0, 120);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `statement ${i + 1}/${statements.length} failed [${first}]: ${msg}`,
      );
    }
  }
}

/**
 * Split a SQL script on top-level semicolons.
 *
 * Only semicolons that actually end a statement count, so the scanner has to
 * know the three places one can hide:
 *
 *   $$ ... $$   a dollar-quoted block, whose DO body has its own semicolons
 *   '...'       a string literal ('' escapes a quote inside one)
 *   -- ...      a line comment, whose text is prose and is dropped entirely
 *
 * The comment case is not hypothetical. A retirement note in the schema read
 * "...keep the same shape; nothing reads it." — that semicolon split the
 * statement, and the orphaned half of the sentence was handed to Postgres as
 * SQL. It failed only in production, because local dev hands the whole script
 * to PGlite and never splits it at all.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let buf = "";
  let tag: string | null = null;
  let i = 0;

  while (i < script.length) {
    // Inside a dollar-quoted block: copy verbatim until the closing tag.
    if (tag) {
      if (script.startsWith(tag, i)) {
        buf += tag;
        i += tag.length;
        tag = null;
      } else {
        buf += script[i++];
      }
      continue;
    }

    // Line comment: skip its text, keep the newline so lines stay separate.
    if (script.startsWith("--", i)) {
      const nl = script.indexOf("\n", i);
      i = nl === -1 ? script.length : nl;
      continue;
    }

    // String literal: copy it whole, so nothing inside is read as syntax.
    if (script[i] === "'") {
      buf += script[i++];
      while (i < script.length) {
        if (script[i] === "'" && script[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        if (script[i] === "'") {
          buf += script[i++];
          break;
        }
        buf += script[i++];
      }
      continue;
    }

    const open = /^\$[A-Za-z_]*\$/.exec(script.slice(i));
    if (open) {
      tag = open[0];
      buf += tag;
      i += tag.length;
      continue;
    }

    if (script[i] === ";") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }

    buf += script[i++];
  }

  out.push(buf);
  return out.map((chunk) => chunk.trim()).filter(Boolean);
}
