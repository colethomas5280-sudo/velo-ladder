import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeliveryInput } from "@/lib/deliveryInput";

/* ------------------------------------------------------------------ *
 * Validating a delivery assessment
 *
 * All-or-nothing, like the screen write path: a request with one bad value is
 * refused with a message naming it, rather than being partly applied.
 *
 * The difference from a screen: an EMPTY assessment is valid here. A row IS
 * the statement that Cole watched the delivery, so saving with nothing ticked
 * means "I looked and found nothing" — which is a result, and the reason the
 * old delivery_assessed column is not needed any more.
 * ------------------------------------------------------------------ */

test("an assessment with nothing marked is valid, because the row is the assessment", () => {
  const got = parseDeliveryInput({ date: "2026-01-01" }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("marked flaws are kept", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { sway: true, "high-hand": true } },
    "2026-06-01",
  );
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, { sway: true, "high-hand": true });
});

test("a flaw key nobody recognises is refused by name", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { "sway-ish": true } },
    "2026-06-01",
  );
  assert.equal(got.ok, false);
  assert.match(got.error!, /sway-ish/);
});

test("an unticked flaw is dropped rather than stored as false", () => {
  const got = parseDeliveryInput(
    { date: "2026-01-01", flaws: { sway: false } },
    "2026-06-01",
  );
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("a date that is not a real day is refused", () => {
  const got = parseDeliveryInput({ date: "2026-02-31" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /date/i);
});

test("a date in the future is refused", () => {
  const got = parseDeliveryInput({ date: "2026-07-01" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /future/i);
});

test("flaws must be an object, and the error says so", () => {
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: "sway" }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /flaws must be an object/);
});

test("an array is not an object, and does not report a bogus flaw key", () => {
  /*
   * Object.entries(["sway"]) yields key "0", so without an array guard the
   * error names a flaw that was never in the request.
   */
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: ["sway"] }, "2026-06-01");
  assert.equal(got.ok, false);
  assert.match(got.error!, /flaws must be an object/);
});

test("notes default to empty rather than undefined", () => {
  const got = parseDeliveryInput({ date: "2026-01-01" }, "2026-06-01");
  assert.equal(got.value!.notes, "");
});

test("a non-string notes becomes empty rather than a coerced string", () => {
  /*
   * String(b.notes ?? "") would turn a stray object or number into
   * "[object Object]" or "123" and store it. Matching the screen path's
   * typeof guard instead means a malformed value is dropped, not stored.
   */
  const got = parseDeliveryInput({ date: "2026-01-01", notes: { rogue: true } }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.equal(got.value!.notes, "");
});

test("notes longer than 2000 characters are truncated, not refused", () => {
  const long = "x".repeat(2500);
  const got = parseDeliveryInput({ date: "2026-01-01", notes: long }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.equal(got.value!.notes.length, 2000);
});
