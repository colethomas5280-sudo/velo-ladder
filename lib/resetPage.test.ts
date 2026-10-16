import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
// The page is only imported here, never rendered, so no database is opened;
// pointing at a scratch dir guarantees ./.pglite-data can never be touched.
process.env.PGLITE_DIR = `${tmpdir()}/velo-reset-page-test-${process.pid}`;

/* The reset URL carries a secret, so the page must not leak it through the
 * Referer header to anything it links to. */
test("the reset page asks browsers not to send a referrer", async () => {
  const mod = await import("../app/reset-password/[token]/page");
  assert.equal((mod.metadata as { referrer?: string }).referrer, "no-referrer");
  assert.equal(mod.dynamic, "force-dynamic", "never cached or prerendered");
});
