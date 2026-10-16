import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config";

/* ------------------------------------------------------------------ *
 * The reset page carries a live token in its URL. A <meta> tag is a hint the
 * browser may honour; a response header is the real thing, so the config
 * sets Referrer-Policy and Cache-Control on that path, and only that path.
 * ------------------------------------------------------------------ */

const RESET_SOURCE = "/reset-password/:token*";

async function rules() {
  assert.equal(typeof nextConfig.headers, "function", "next.config must define headers()");
  return await nextConfig.headers!();
}
const find = (list: { key: string; value: string }[], key: string) =>
  list.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

test("the reset page gets Referrer-Policy: no-referrer and Cache-Control: no-store", async () => {
  const rule = (await rules()).find((r) => r.source === RESET_SOURCE);
  assert.ok(rule, `no headers rule for ${RESET_SOURCE}`);
  assert.equal(find(rule.headers, "Referrer-Policy"), "no-referrer");
  assert.equal(find(rule.headers, "Cache-Control"), "no-store");
});

test("no other source gets those headers", async () => {
  for (const r of await rules()) {
    if (r.source === RESET_SOURCE) continue;
    assert.equal(find(r.headers, "Referrer-Policy"), undefined, `${r.source} sets Referrer-Policy`);
    assert.equal(find(r.headers, "Cache-Control"), undefined, `${r.source} sets Cache-Control`);
  }
});
