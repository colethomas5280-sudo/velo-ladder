import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone, formatPhone, samePhone, inviteMessage, smsHref, defaultRecipient,
} from "@/lib/sms";

test("normalizePhone accepts the ways a coach actually types a number", () => {
  for (const raw of ["5551234567", "555-123-4567", "(555) 123-4567", "555.123.4567", " 555 123 4567 "])
    assert.equal(normalizePhone(raw), "+15551234567", raw);
  assert.equal(normalizePhone("15551234567"), "+15551234567");
  assert.equal(normalizePhone("+15551234567"), "+15551234567");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958", "keeps a given country code");
});

test("normalizePhone rejects what it cannot make sense of", () => {
  for (const raw of ["", null, undefined, "555-1234", "abc", "12345678901234567890"])
    assert.equal(normalizePhone(raw as string), null, String(raw));
});

test("samePhone compares lines, not spellings", () => {
  assert.ok(samePhone("(555) 123-4567", "+15551234567"));
  assert.ok(!samePhone("5551234567", "5559999999"));
  assert.ok(!samePhone(null, null), "two unusable numbers are not a match");
});

test("formatPhone is readable for US and untouched otherwise", () => {
  assert.equal(formatPhone("+15551234567"), "(555) 123-4567");
  assert.equal(formatPhone("+442079460958"), "+442079460958");
  assert.equal(formatPhone(null), "");
});

test("inviteMessage stays in GSM-7 so it bills as one segment", () => {
  const body = inviteMessage("Jake Bell", "https://velo-ladder.vercel.app/join/abc123");
  assert.ok(body.startsWith("Hi Jake,"), "first name only");
  assert.ok(body.includes("https://velo-ladder.vercel.app/join/abc123"));
  // The characters that silently halve the segment size.
  for (const ch of ["—", "’", "“", "”", "…"])
    assert.ok(!body.includes(ch), `must not contain ${JSON.stringify(ch)}`);
});

test("inviteMessage copes with a one-word or empty name", () => {
  assert.ok(inviteMessage("Cooper", "u").startsWith("Hi Cooper,"));
  assert.ok(inviteMessage("   ", "u").startsWith("Hi there,"));
});

test("smsHref uses the ?& spelling both phone platforms accept", () => {
  const href = smsHref("+15551234567", "hi there & welcome");
  assert.ok(href.startsWith("sms:+15551234567?&body="));
  assert.ok(href.includes("%26"), "ampersand in the body must be encoded");
  assert.ok(!href.includes(" "), "spaces encoded");
});

test("defaultRecipient sends a youth invite to the parent when there is one", () => {
  const youth = { phone: "5551112222", guardianPhone: "5553334444", level: "Youth" };
  assert.equal(defaultRecipient(youth), "guardian");
  assert.equal(defaultRecipient({ ...youth, level: "High School" }), "athlete");
  assert.equal(defaultRecipient({ ...youth, guardianPhone: null }), "athlete",
    "a youth with no guardian on file still gets their own number");
});

test("defaultRecipient falls back to whichever number exists", () => {
  assert.equal(defaultRecipient({ phone: null, guardianPhone: "5553334444", level: "College" }), "guardian");
  assert.equal(defaultRecipient({ phone: null, guardianPhone: null, level: "Pro" }), null);
  assert.equal(defaultRecipient({ phone: "nonsense", guardianPhone: null, level: null }), null,
    "an unusable number is not a recipient");
});
