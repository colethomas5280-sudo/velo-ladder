import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * Emailing an invite, run for real against the route handler and a real
 * (PGlite) database, with only Resend stubbed.
 *
 * What is worth pinning: the destination is ALWAYS the athlete's stored
 * login email, whatever the request says; a failed send never costs the
 * coach the link; and nobody but a coach can trigger a send.
 * ------------------------------------------------------------------ */

const COACH = "coach@email.test";
const KID = "kid@email.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-email-"));
process.env.PGLITE_DIR = DB_DIR;
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});
process.env.COACH_EMAILS = COACH;
process.env.AUTH_URL = "https://velo.test";

let signedInAs: string | null = COACH;
mock.module("@/lib/auth", {
  exports: {
    auth: async () => (signedInAs ? { user: { email: signedInAs } } : null),
  },
} as Parameters<typeof mock.module>[1]);

type Sent = { to: string[]; subject: string; text: string; html: string };
let sent: Sent[] = [];
let resendOk = true;
const realFetch = globalThis.fetch;

let athleteId = "";
let noEmailId = "";
let route: typeof import("../app/api/athletes/[id]/invite/route");

before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  athleteId = (await data.createAthlete({ name: "Jake Bell", inviteEmail: KID })).id;
  noEmailId = (await data.createAthlete({ name: "Pat Nomail", inviteEmail: null })).id;

  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("api.resend.com")) return realFetch(input, init);
    if (!resendOk)
      return new Response(
        JSON.stringify({ message: "The powerpitcherpathway.com domain is not verified." }),
        { status: 403 },
      );
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  }) as typeof fetch;

  route = await import("../app/api/athletes/[id]/invite/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  route.POST(
    new Request("https://velo.test/api", { method: "POST", body: JSON.stringify(body) }),
    ctx(id),
  );

type Reply = {
  url: string;
  email: { sent: boolean; to?: string; reason?: string; detail?: string } | null;
  emailConfigured: boolean;
};

test("emailing sends the real link to the athlete's stored login email", async () => {
  signedInAs = COACH;
  sent = [];
  const res = await post(athleteId, { channel: "email" });
  const body = (await res.json()) as Reply;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [KID]);
  assert.ok(sent[0].text.includes(body.url), "the email carries the real link");
  assert.ok(body.url.startsWith("https://velo.test/join/"));
  assert.ok(sent[0].text.startsWith("Hi Jake,"));
  assert.deepEqual(body.email, { sent: true, to: KID });
  assert.equal(body.emailConfigured, true);
});

test("an address in the request is ignored; only the stored one is ever used", async () => {
  sent = [];
  const res = await post(athleteId, {
    channel: "email",
    email: "attacker@evil.test",
    toEmail: "attacker@evil.test",
    inviteEmail: "attacker@evil.test",
  });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [KID], "no request field can redirect the mail");
});

test("without a channel the route mints a link and sends no email", async () => {
  sent = [];
  const res = await post(athleteId, {});
  const body = (await res.json()) as Reply;
  assert.equal(res.status, 200);
  assert.ok(body.url.includes("/join/"));
  assert.equal(body.email, null);
  assert.equal(sent.length, 0);
});

test("a failed send still returns the link, and names Resend's reason", async () => {
  resendOk = false;
  const res = await post(athleteId, { channel: "email" });
  resendOk = true;
  assert.equal(res.status, 200, "a failed email must not fail the invite");
  const body = (await res.json()) as Reply;
  assert.ok(body.url.startsWith("https://velo.test/join/"), "link still issued");
  assert.equal(body.email?.sent, false);
  assert.match(body.email?.detail ?? "", /domain is not verified/);
});

test("when email is not configured the link still comes back and nothing is sent", async () => {
  const key = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  sent = [];
  const res = await post(athleteId, { channel: "email" });
  process.env.RESEND_API_KEY = key;
  const body = (await res.json()) as Reply;
  assert.equal(res.status, 200);
  assert.ok(body.url.includes("/join/"));
  assert.equal(body.email?.sent, false);
  assert.equal(body.email?.reason, "not_configured");
  assert.equal(body.emailConfigured, false);
  assert.equal(sent.length, 0);
});

test("an athlete with no login email gets a link and no send", async () => {
  sent = [];
  const res = await post(noEmailId, { channel: "email" });
  const body = (await res.json()) as Reply;
  assert.equal(res.status, 200);
  assert.ok(body.url.includes("/join/"));
  assert.equal(body.email?.sent, false);
  assert.equal(body.email?.reason, "bad_address");
  assert.equal(sent.length, 0);
});

test("each email mints a fresh link, so an old one stops working", async () => {
  const a = (await (await post(athleteId, { channel: "email" })).json()) as Reply;
  const b = (await (await post(athleteId, { channel: "email" })).json()) as Reply;
  assert.notEqual(a.url, b.url);
});

test("an athlete cannot email themselves an invite", async () => {
  signedInAs = KID;
  sent = [];
  const res = await post(athleteId, { channel: "email" });
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
  signedInAs = COACH;
});

test("a signed-out caller sends nothing", async () => {
  signedInAs = null;
  sent = [];
  const res = await post(athleteId, { channel: "email" });
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
  signedInAs = COACH;
});
