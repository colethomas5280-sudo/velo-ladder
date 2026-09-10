/**
 * Rewrite db/schema.sql from lib/schema.ts.
 *
 *   npx tsx scripts/schema-sql.ts
 *
 * The file is a human-readable copy for anyone who wants to see the shape of
 * the database without reading TypeScript. `lib/schemaFile.test.ts` fails
 * until it is back in step, so this is a step in any schema change, not an
 * optional tidy-up.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { schemaFile } from "../lib/schema";

writeFileSync(join(process.cwd(), "db", "schema.sql"), schemaFile());
console.log("db/schema.sql rewritten");
