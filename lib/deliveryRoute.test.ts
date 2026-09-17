import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeliveryInput } from "@/lib/deliveryInput";

/* ------------------------------------------------------------------ *
 * The delivery write path
 *
 * The route's authorization mirrors the screen's: an athlete reads their own,
 * only a coach records or removes one. The rules that are this route's own
 * live in the validator, and these pin the ones a coach would notice.
 * ------------------------------------------------------------------ */

test("a coach can record an assessment with nothing found", () => {
  const got = parseDeliveryInput({ date: "2026-01-01", flaws: {} }, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value!.flaws, {});
});

test("the payload the modal sends round-trips", () => {
  const body = { date: "2026-01-01", flaws: { sway: true }, notes: "side view" };
  const got = parseDeliveryInput(body, "2026-06-01");
  assert.equal(got.ok, true);
  assert.deepEqual(got.value, body);
});
