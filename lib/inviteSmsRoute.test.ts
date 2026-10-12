import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * Texting an invite, run for real against the route handler.
 *
 * The thing worth pinning down is the destination check. The endpoint sends
 * attacker-controlled-ish text on the facility's own Twilio account, and the
 * only thing in front of it is a single shared coach password — so "to" must
 * be one of THIS athlete's numbers and nothing else. Everything below drives
 * the real handler against a real (PGlite) database with Twilio stubbed.
 * ------------------------------------------------------------------ */

const COACH = "coach@sms.test";
const KID = "kid@sms.test";

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-sms-"));
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

/** Every Twilio call this suite would have made. */
let sent: { to: string; body: string }[] = [];
let twilioOk = true;
const realFetch = globalThis.fetch;

let athleteId = "";
let route: typeof import("../app/api/athletes/[id]/invite/route");

before(async () => {
  const { execScript } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  const a = await data.createAthlete({
    name: "Jake Bell",
    inviteEmail: KID,
    phone: "+15551112222",
  });
  athleteId = a.id;
  await data.updateAthlete(athleteId, { guardianPhone: "555-333-4444" });

  // Credentials present, so the send path is exercised rather than skipped.
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token_test";
  process.env.TWILIO_FROM = "+15550000000";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("api.twilio.com")) return realFetch(input, init);
    const form = new URLSearchParams(init?.body as string);
    if (!twilioOk)
      return new Response(
        JSON.stringify({ message: "Unregistered 10DLC campaign", code: 30034 }),
        { status: 400 },
      );
    sent.push({ to: form.get("To") ?? "", body: form.get("Body") ?? "" });
    return new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 });
  }) as typeof fetch;

  route = await import("../app/api/athletes/[id]/invite/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  route.POST(
    new Request("https://velo.test/api", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

type Reply = {
  url: string;
  sms: { sent: boolean; to?: string; reason?: string; detail?: string } | null;
};

test("texting the athlete's own number sends the link", async () => {
  signedInAs = COACH;
  sent = [];
  const res = await post(athleteId, { to: "(555) 111-2222" });
  // Read once: consuming the body for an assertion message leaves nothing to parse.
  const body = (await res.json()) as Reply;
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+15551112222", "normalised before sending");
  assert.ok(sent[0].body.includes(body.url), "the text carries the real link");
  assert.ok(sent[0].body.startsWith("Hi Jake,"));
  assert.equal(body.sms?.sent, true);
});

test("the guardian's number is an accepted destination too", async () => {
  sent = [];
  const res = await post(athleteId, { to: "+15553334444" });
  assert.equal(res.status, 200);
  assert.equal(sent[0].to, "+15553334444");
});

test("a number that is not on the profile is refused, and nothing is sent", async () => {
  sent = [];
  const res = await post(athleteId, { to: "+15559998888" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /isn't on this athlete's profile/);
  assert.equal(sent.length, 0, "no text may leave for an unlisted number");
});

test("a malformed number is refused before any send", async () => {
  sent = [];
  const res = await post(athleteId, { to: "555-1234" });
  assert.equal(res.status, 400);
  assert.equal(sent.length, 0);
});

test("a failed send still returns the link, and names the carrier reason", async () => {
  twilioOk = false;
  const res = await post(athleteId, { to: "5551112222" });
  twilioOk = true;
  assert.equal(res.status, 200, "a failed text must not fail the invite");
  const body = (await res.json()) as Reply;
  assert.ok(body.url.startsWith("https://velo.test/join/"), "link still issued");
  assert.equal(body.sms?.sent, false);
  assert.match(body.sms?.detail ?? "", /10DLC/, "Twilio's own wording reaches the coach");
});

test("omitting `to` mints a link and sends nothing", async () => {
  sent = [];
  const res = await post(athleteId, {});
  assert.equal(res.status, 200);
  const body = (await res.json()) as Reply;
  assert.ok(body.url.includes("/join/"));
  assert.equal(body.sms, null);
  assert.equal(sent.length, 0);
});

test("an athlete cannot text themselves an invite", async () => {
  signedInAs = KID;
  sent = [];
  const res = await post(athleteId, { to: "5551112222" });
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
  signedInAs = COACH;
});

test("a signed-out caller gets nothing", async () => {
  signedInAs = null;
  const res = await post(athleteId, { to: "5551112222" });
  assert.equal(res.status, 401);
  signedInAs = COACH;
});
