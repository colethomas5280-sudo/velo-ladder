import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION, schemaFile } from "@/lib/schema";

/* ------------------------------------------------------------------ *
 * db/schema.sql says what lib/schema.ts says
 *
 * The file calls itself generated and tells the reader not to edit it, which
 * is exactly the kind of claim that stops being true quietly. It had been
 * stale for three schema versions — anyone opening it to see what the
 * database looks like would have found no movement_screens table at all and
 * reasonably concluded the screen wasn't stored.
 *
 * Regenerate it with:  npx tsx scripts/schema-sql.ts
 * ------------------------------------------------------------------ */

test("the checked-in schema.sql matches the schema the app actually applies", () => {
  const onDisk = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  assert.equal(
    onDisk,
    schemaFile(),
    "db/schema.sql is out of date — run `npx tsx scripts/schema-sql.ts`",
  );
});

test("and it names the version it was generated from", () => {
  const onDisk = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  assert.match(onDisk, new RegExp(`SCHEMA_VERSION ${SCHEMA_VERSION}\\b`));
});
