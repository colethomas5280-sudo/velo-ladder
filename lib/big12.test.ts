import { test } from "node:test";
import assert from "node:assert/strict";
import { BIG_12, flawByKey } from "@/lib/big12";
import { SCREEN_TESTS } from "@/lib/screen";

/* ------------------------------------------------------------------ *
 * The twelve
 *
 * The mapping is Cole's, derived from his OnBaseU entries one flaw at a
 * time. These tests do not check that a mapping is RIGHT, which is his call.
 * They check it points at things that exist, because a cause naming a test
 * key that does not exist explains nothing, silently, for good.
 * ------------------------------------------------------------------ */

test("Cole's twelve, in his order, with keys that can reach the database", () => {
  assert.equal(BIG_12.length, 12);
  const keys = BIG_12.map((f) => f.key);
  assert.equal(new Set(keys).size, 12, "two flaws share a key");
  for (const k of keys)
    assert.match(k, /^[a-z0-9-]+$/, `${k} is not a safe key`);
});

test("every cause names screen tests that exist", () => {
  const real = new Set(SCREEN_TESTS.map((t) => t.key));
  for (const flaw of BIG_12)
    for (const cause of flaw.causes)
      for (const key of cause.tests)
        assert.ok(real.has(key), `${flaw.key} names '${key}', which is not a screen test`);
});

test("every flaw-to-flaw link names a real flaw, and none names itself", () => {
  const keys = new Set(BIG_12.map((f) => f.key));
  for (const flaw of BIG_12)
    for (const other of flaw.causedBy ?? []) {
      assert.ok(keys.has(other), `${flaw.key} names '${other}', which is not a flaw`);
      assert.notEqual(other, flaw.key, `${flaw.key} lists itself as its own cause`);
    }
});

test("a cause with no tests is kept, because that is a finding about the screen", () => {
  const unmapped = BIG_12.flatMap((f) => f.causes.filter((c) => c.tests.length === 0));
  assert.ok(unmapped.length > 0, "the unmappable causes were dropped rather than recorded");
});

test("every flaw carries copy a coach can grade from", () => {
  for (const f of BIG_12) {
    assert.ok(f.label.length > 0, `${f.key} has no label`);
    assert.ok(f.description.length > 40, `${f.key} has no real description`);
    assert.ok(f.howToSpot.length > 40, `${f.key} does not say how to spot it`);
  }
});

test("no em dashes in anything a coach or athlete reads", () => {
  for (const f of BIG_12) {
    const copy = [f.label, f.description, f.howToSpot, ...f.causes.map((c) => c.label)];
    for (const s of copy)
      assert.ok(!s.includes("—"), `${f.key} has an em dash in "${s.slice(0, 40)}"`);
  }
});

test("flawByKey finds a flaw and returns undefined for anything else", () => {
  assert.equal(flawByKey("sway")?.label, "Sway");
  assert.equal(flawByKey("not-a-flaw"), undefined);
});
