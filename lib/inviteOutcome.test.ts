import { test } from "node:test";
import assert from "node:assert/strict";
import { emailInviteOutcome } from "@/lib/inviteOutcome";

const URL = "https://velo.test/join/tok";

test("a sent email is reported with the address and no link to copy", () => {
  const o = emailInviteOutcome({ url: URL, email: { sent: true, to: "kid@school.org" } });
  assert.equal(o.message, "Invite emailed to kid@school.org");
  assert.equal(o.copyLink, false);
});

test("a failed send says why and falls back to the link", () => {
  const o = emailInviteOutcome({
    url: URL,
    email: { sent: false, reason: "send_failed", detail: "The domain is not verified." },
  });
  assert.match(o.message, /couldn't email/i);
  assert.match(o.message, /domain is not verified/);
  assert.equal(o.copyLink, true);
});

test("email not set up falls back to the link without blaming anyone", () => {
  const o = emailInviteOutcome({ url: URL, email: { sent: false, reason: "not_configured" } });
  assert.equal(o.copyLink, true);
  assert.match(o.message, /isn't set up/i);
});

test("an athlete with no usable address is told to add one", () => {
  const o = emailInviteOutcome({ url: URL, email: { sent: false, reason: "bad_address" } });
  assert.equal(o.copyLink, true);
  assert.match(o.message, /login email/i);
});

test("no email result at all means the link is the whole story", () => {
  const o = emailInviteOutcome({ url: URL, email: null });
  assert.equal(o.copyLink, true);
});
