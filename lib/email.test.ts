import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  emailConfigured,
  isEmailAddress,
  inviteEmailContent,
  sendInviteEmail,
  resetEmailContent,
  sendResetEmail,
} from "@/lib/email";

/* ------------------------------------------------------------------ *
 * Resend is stubbed at fetch, so these run the real request-building
 * code and only fake the network. Env is reset around every test.
 * ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;
const KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "COACH_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: () => Response = () =>
  new Response(JSON.stringify({ id: "re_test" }), { status: 200 });

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_secret_key";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  process.env.COACH_EMAILS = "cole@fastcolorado.com, second@coach.test";
  calls = [];
  respond = () => new Response(JSON.stringify({ id: "re_test" }), { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("emailConfigured needs both the key and the sender", () => {
  assert.equal(emailConfigured(), true);
  delete process.env.RESEND_API_KEY;
  assert.equal(emailConfigured(), false, "no key");
  process.env.RESEND_API_KEY = "re_secret_key";
  delete process.env.EMAIL_FROM;
  assert.equal(emailConfigured(), false, "no sender");
  process.env.EMAIL_FROM = "   ";
  assert.equal(emailConfigured(), false, "a blank sender is not a sender");
});

test("isEmailAddress accepts ordinary addresses and rejects the rest", () => {
  for (const ok of ["kid@school.org", "first.last+velo@mail.example.com"])
    assert.ok(isEmailAddress(ok), ok);
  for (const bad of ["", "no-at-sign", "a@b", "two@@x.com", "sp ace@x.com", "a@b.c\nBcc: x@y.z"])
    assert.ok(!isEmailAddress(bad), JSON.stringify(bad));
});

test("the invite email carries the link, the first name and the expiry", () => {
  const url = "https://velo.test/join/abc123";
  const c = inviteEmailContent("Jake Bell", url);
  assert.equal(c.subject, "Set up your Velo Ladder login");
  for (const part of [c.text, c.html]) {
    assert.ok(part.includes(url), "link present");
    assert.ok(part.includes("Jake"), "first name");
    assert.ok(part.includes("14 days"), "expiry");
  }
  assert.ok(!c.text.includes("Bell"), "first name only");
});

test("the invite email says who it is from and why they are getting it", () => {
  const c = inviteEmailContent("Jake Bell", "https://velo.test/join/abc123");
  for (const part of [c.text, c.html]) {
    assert.ok(part.includes("FAST Performance"), "names the facility");
    assert.match(part, /Coach Cole/, "signed by the coach");
    assert.match(part, /velocity and recovery/i, "says what the app is for");
  }
});

test("the email ends with a signature in both parts", () => {
  const c = inviteEmailContent("Jake", "https://velo.test/join/abc123");
  assert.ok(c.text.endsWith("Coach Cole\nFAST Performance, Denver"), "plain text sign-off");
  assert.ok(c.html.endsWith("Coach Cole<br>FAST Performance, Denver</p>"), "html sign-off");
});

test("it tells a surprised recipient they can ignore it", () => {
  const c = inviteEmailContent("Jake", "https://velo.test/join/abc123");
  for (const part of [c.text, c.html])
    assert.match(part, /weren.{1,8}t expecting this/i);
  assert.match(c.text, /ignore this email/i);
});

test("the link appears exactly once, so the email is not link-stuffed", () => {
  const url = "https://velo.test/join/abc123";
  const c = inviteEmailContent("Jake", url);
  assert.equal(c.text.split(url).length - 1, 1, "once in the text part");
  // Once as the href and once as the visible text of the same anchor.
  assert.equal(c.html.split(url).length - 1, 2, "one anchor in the html part");
});

test("the invite email copes with an empty name", () => {
  assert.ok(inviteEmailContent("   ", "https://x.test/j").text.startsWith("Hi there,"));
});

test("a name cannot inject markup into the HTML part", () => {
  const c = inviteEmailContent('<script>alert(1)</script> "Bobby"', "https://x.test/j?a=1&b=2");
  assert.ok(!c.html.includes("<script>"), "tags escaped");
  assert.ok(c.html.includes("&lt;script&gt;"));
  assert.ok(c.html.includes("a=1&amp;b=2"), "ampersand in the link escaped for HTML");
});

test("sending posts the invite to Resend with the key and the configured sender", async () => {
  const r = await sendInviteEmail("kid@school.org", "Jake Bell", "https://velo.test/join/t0k");
  assert.deepEqual(r, { sent: true, to: "kid@school.org" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].headers.Authorization, "Bearer re_secret_key");
  assert.equal(calls[0].body.from, "Velo Ladder <invites@powerpitcherpathway.com>");
  assert.deepEqual(calls[0].body.to, ["kid@school.org"]);
  assert.equal(calls[0].body.subject, "Set up your Velo Ladder login");
  assert.ok(String(calls[0].body.text).includes("https://velo.test/join/t0k"));
  assert.ok(String(calls[0].body.html).includes("https://velo.test/join/t0k"));
});

test("replies go to the first coach address", async () => {
  await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.equal(calls[0].body.reply_to, "cole@fastcolorado.com");
});

test("with no coach address configured there is simply no reply-to", async () => {
  delete process.env.COACH_EMAILS;
  await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.ok(!("reply_to" in calls[0].body));
});

test("not configured is a value, and nothing leaves the building", async () => {
  delete process.env.RESEND_API_KEY;
  const r = await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.deepEqual(r, { sent: false, reason: "not_configured" });
  assert.equal(calls.length, 0);
});

test("a bad address is refused before any request", async () => {
  const r = await sendInviteEmail("not-an-email", "Jake", "https://velo.test/join/t");
  assert.deepEqual(r, { sent: false, reason: "bad_address" });
  assert.equal(calls.length, 0);
});

test("Resend rejecting the send comes back with Resend's own wording", async () => {
  respond = () =>
    new Response(
      JSON.stringify({ name: "validation_error", message: "The powerpitcherpathway.com domain is not verified." }),
      { status: 403 },
    );
  const r = await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.equal(r.sent, false);
  assert.ok(!r.sent && r.reason === "send_failed");
  assert.match(!r.sent ? (r.detail ?? "") : "", /domain is not verified/);
});

test("an unreadable error body still yields a status-code detail", async () => {
  respond = () => new Response("<html>bad gateway</html>", { status: 502 });
  const r = await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.ok(!r.sent && r.reason === "send_failed");
  assert.match(!r.sent ? (r.detail ?? "") : "", /502/);
});

test("a network failure is a value, never a throw", async () => {
  globalThis.fetch = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;
  const r = await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.ok(!r.sent && r.reason === "send_failed");
  assert.match(!r.sent ? (r.detail ?? "") : "", /socket hang up/);
});

test("the API key never appears in anything returned", async () => {
  respond = () => new Response(JSON.stringify({ message: "nope" }), { status: 401 });
  const r = await sendInviteEmail("kid@school.org", "Jake", "https://velo.test/join/t");
  assert.ok(!JSON.stringify(r).includes("re_secret_key"));
});

test("the reset email names the coach, says it expires in an hour, and is safe to ignore", () => {
  const url = "https://velo.test/reset-password/tok";
  const r = resetEmailContent("Jake Bell", url);
  assert.equal(r.subject, "Reset your Velo Ladder password");
  for (const part of [r.text, r.html]) {
    assert.ok(part.includes("Jake"), "first name");
    assert.ok(part.includes("1 hour"), "expiry");
    assert.match(part, /ignore this email/i);
    assert.match(part, /password hasn.{1,8}t changed/i);
    assert.match(part, /FAST Performance/);
  }
  assert.ok(!r.text.includes("Bell"), "first name only");
  assert.equal(r.text.split(url).length - 1, 1, "link once in the text");
  assert.equal(r.html.split(url).length - 1, 2, "one anchor in the html");
  assert.ok(r.text.endsWith("Coach Cole\nFAST Performance, Denver"));
  assert.ok(!/[—–]/.test(r.text + r.html), "no em or en dashes");
});

test("a name cannot inject markup into the reset email", () => {
  const r = resetEmailContent('<script>alert(1)</script>', "https://x.test/r?a=1&b=2");
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes("a=1&amp;b=2"));
});

test("sendResetEmail posts the reset to Resend at the address it was given", async () => {
  const r = await sendResetEmail("kid@school.org", "Jake Bell", "https://velo.test/reset-password/t0k");
  assert.deepEqual(r, { sent: true, to: "kid@school.org" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].body.subject, "Reset your Velo Ladder password");
  assert.deepEqual(calls[0].body.to, ["kid@school.org"]);
  assert.equal(calls[0].body.reply_to, "cole@fastcolorado.com");
  assert.ok(String(calls[0].body.text).includes("https://velo.test/reset-password/t0k"));
});

test("sendResetEmail is a value when not configured, refuses a bad address, and reports Resend's reason", async () => {
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendResetEmail("kid@school.org", "J", "https://x.test/r"), {
    sent: false,
    reason: "not_configured",
  });
  process.env.RESEND_API_KEY = "re_secret_key";
  assert.deepEqual(await sendResetEmail("nope", "J", "https://x.test/r"), {
    sent: false,
    reason: "bad_address",
  });
  respond = () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
  const r = await sendResetEmail("kid@school.org", "J", "https://x.test/r");
  assert.ok(!r.sent && r.reason === "send_failed");
  assert.match(!r.sent ? (r.detail ?? "") : "", /domain is not verified/);
});
