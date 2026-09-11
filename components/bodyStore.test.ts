import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BLANK_BODY, BODY_KEY, readBody, writeBody } from "./bodyStore";

/* ------------------------------------------------------------------ *
 * The height and weight, shared between two pages
 *
 * The standards calculator asks for both. The nutrition page only knows
 * about the weight. If writing one dropped the other, an athlete would enter
 * his weight to see what to eat, go back to check his lift targets, and find
 * his height gone.
 * ------------------------------------------------------------------ */

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* nothing to clear */
  }
});

test("nothing saved reads as blank rather than throwing", () => {
  assert.deepEqual(readBody(), BLANK_BODY);
});

test("what is written comes back", () => {
  writeBody({ ft: "6", inch: "1", lb: "186" });
  assert.deepEqual(readBody(), { ft: "6", inch: "1", lb: "186" });
});

/* The whole reason this is one module and not two copies of a key. */
test("writing the weight alone keeps the height", () => {
  writeBody({ ft: "6", inch: "1", lb: "186" });
  writeBody({ lb: "192" });
  assert.deepEqual(readBody(), { ft: "6", inch: "1", lb: "192" });
});

test("clearing the weight keeps the height too", () => {
  writeBody({ ft: "6", inch: "1", lb: "186" });
  writeBody({ lb: "" });
  const v = readBody();
  assert.equal(v.lb, "");
  assert.equal(v.ft, "6", "he did not get shorter");
});

test("a corrupted value reads as blank instead of breaking the page", () => {
  window.localStorage.setItem(BODY_KEY, "{not json");
  assert.deepEqual(readBody(), BLANK_BODY);
});

test("a partial saved value fills the rest in blank", () => {
  window.localStorage.setItem(BODY_KEY, JSON.stringify({ lb: "186" }));
  assert.deepEqual(readBody(), { ft: "", inch: "", lb: "186" });
});
