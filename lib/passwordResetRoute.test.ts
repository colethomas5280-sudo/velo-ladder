import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * POST /api/password-reset/request, run for real against the handler and a
 * real (PGlite) database, with only Resend stubbed.
 *
 * Pinned: every kind of request gets the identical answer (so the form cannot
 * be used to learn who is on the roster), the work happens AFTER the response,
 * the email goes only to the stored address, and no log line carries a token.
 * ------------------------------------------------------------------ */

process.env.USE_PGLITE = "1";
process.env.DATABASE_URL = "";
const DB_DIR = mkdtempSync(join(tmpdir(), "velo-reset-route-"));
process.env.PGLITE_DIR = DB_DIR;
process.env.AUTH_URL = "https://velo.test";
process.env.COACH_EMAILS = "coach@reset.test";
after(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  rmSync(DB_DIR, { recursive: true, force: true });
});

/*
 * after() throws outside a real request, so stand in for it: collect what the
 * route defers and run it on demand. That also lets a test prove the response
 * came back BEFORE the work was done.
 */
let deferred: Array<() => unknown> = [];
mock.module("next/server", {
  exports: {
    after: (fn: () => unknown) => {
      deferred.push(fn);
    },
  },
} as Parameters<typeof mock.module>[1]);
async function flush() {
  const run = deferred;
  deferred = [];
  for (const fn of run) await fn();
}

type Sent = { to: string[]; subject: string; text: string; html: string };
let sent: Sent[] = [];
let resendOk = true;
const realFetch = globalThis.fetch;

let route: typeof import("../app/api/password-reset/request/route");
let pr: typeof import("@/lib/passwordReset");
let sql: typeof import("@/lib/db").sql;
const kid = { id: "", email: "kid@reset.test" };
const archivedEmail = "gone@reset.test";

before(async () => {
  const db = await import("@/lib/db");
  sql = db.sql;
  const { SCHEMA_SQL } = await import("@/lib/schema");
  await db.execScript(SCHEMA_SQL);
  const data = await import("@/lib/data");
  kid.id = (await data.createAthlete({ name: "Jake Bell", inviteEmail: kid.email })).id;
  const gone = await data.createAthlete({ name: "Gone Guy", inviteEmail: archivedEmail });
  await sql`UPDATE athletes SET archived = true WHERE id = ${gone.id}`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("api.resend.com")) return realFetch(input, init);
    if (!resendOk)
      return new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  }) as typeof fetch;

  pr = await import("@/lib/passwordReset");
  route = await import("../app/api/password-reset/request/route");
});

beforeEach(async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Velo Ladder <invites@powerpitcherpathway.com>";
  sent = [];
  deferred = [];
  resendOk = true;
  await sql`DELETE FROM password_reset_sends`;
  await sql`UPDATE athletes SET reset_token_hash = NULL, reset_expires = NULL, reset_requested_at = NULL`;
});

const post = (body: unknown) =>
  route.POST(
    new Request("https://velo.test/api/password-reset/request", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), cache: res.headers.get("cache-control") };
}

test("every kind of request gets the identical answer", async () => {
  const cases: unknown[] = [
    { email: kid.email },
    { email: "nobody@reset.test" },
    { email: archivedEmail },
    { email: "coach@reset.test" },
    { email: "" },
    { email: 42 },
    {},
    "this is not json",
  ];
  const answers = [];
  for (const c of cases) answers.push(await snapshot(await post(c)));
  for (const a of answers) assert.deepEqual(a, answers[0]);
  assert.equal(answers[0].status, 200);
  assert.equal(answers[0].body, '{"ok":true}');
  assert.equal(answers[0].cache, "no-store");
});

test("the work is deferred: nothing is sent until after the response", async () => {
  await post({ email: kid.email });
  assert.equal(sent.length, 0, "the response must not wait for the email");
  await flush();
  assert.equal(sent.length, 1);
});

test("the email goes to the stored address and carries a link whose token matches the stored hash", async () => {
  await post({ email: "  KID@Reset.TEST " });
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [kid.email]);
  assert.equal(sent[0].subject, "Reset your Velo Ladder password");
  const m = sent[0].text.match(/https:\/\/velo\.test\/reset-password\/([A-Za-z0-9_-]{43})/);
  assert.ok(m, "the email carries a reset link");
  const [r] = (await sql`SELECT reset_token_hash FROM athletes WHERE id = ${kid.id}`) as { reset_token_hash: string }[];
  assert.equal(r.reset_token_hash, pr.hashResetToken(m[1]));
});

test("an unknown, archived or coach address sends nothing and writes nothing", async () => {
  for (const email of ["nobody@reset.test", archivedEmail, "coach@reset.test", ""]) {
    await post({ email });
  }
  await flush();
  assert.equal(sent.length, 0);
  const [c] = (await sql`SELECT count(*)::int AS n FROM password_reset_sends`) as { n: number }[];
  assert.equal(c.n, 0);
});

test("a second request inside the cooldown sends nothing more, and the first link still works", async () => {
  await post({ email: kid.email });
  await flush();
  await post({ email: kid.email });
  await flush();
  assert.equal(sent.length, 1);
  const token = sent[0].text.match(/reset-password\/([A-Za-z0-9_-]{43})/)![1];
  assert.ok(await pr.getResetTarget(token));
});

test("when the daily cap is reached nothing is sent and the answer is unchanged", async () => {
  for (let i = 0; i < pr.RESET_DAILY_CAP; i++) await sql`INSERT INTO password_reset_sends DEFAULT VALUES`;
  const a = await snapshot(await post({ email: kid.email }));
  await flush();
  assert.equal(sent.length, 0);
  assert.equal(a.body, '{"ok":true}');
});

test("when email is not configured nothing is claimed, so no cooldown is burned", async () => {
  delete process.env.RESEND_API_KEY;
  await post({ email: kid.email });
  await flush();
  assert.equal(sent.length, 0);
  const [r] = (await sql`SELECT reset_requested_at FROM athletes WHERE id = ${kid.id}`) as { reset_requested_at: unknown }[];
  assert.equal(r.reset_requested_at, null);
});

test("a failed send never throws out of the deferred work and never logs the token", async () => {
  resendOk = false;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await post({ email: kid.email });
    await flush(); // must resolve, not reject
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((l) => /domain is not verified/.test(l)), "the reason is logged");
  const [r] = (await sql`SELECT reset_token_hash FROM athletes WHERE id = ${kid.id}`) as { reset_token_hash: string }[];
  assert.ok(r.reset_token_hash);
  assert.ok(
    logged.every((l) => !/[A-Za-z0-9_-]{43}/.test(l) && !l.includes(r.reset_token_hash)),
    "no log line may contain a token or its hash",
  );
});

test("requesting a reset leaves a pending invite alone", async () => {
  const data = await import("@/lib/data");
  const invite = await data.createInvite(kid.id);
  await post({ email: kid.email });
  await flush();
  const [r] = (await sql`SELECT invite_token FROM athletes WHERE id = ${kid.id}`) as { invite_token: string }[];
  assert.equal(r.invite_token, invite);
});

test("an error inside the deferred work is caught and logged, never thrown", async () => {
  // Break the send log so requestReset itself throws, then put it back.
  await sql`ALTER TABLE password_reset_sends RENAME TO password_reset_sends_off`;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await post({ email: kid.email });
    await flush(); // must resolve, not reject
  } finally {
    console.error = realError;
    await sql`ALTER TABLE password_reset_sends_off RENAME TO password_reset_sends`;
  }
  assert.ok(logged.some((l) => l.startsWith("[password-reset] failed:")), "the failure is logged");
  assert.equal(sent.length, 0);
  assert.ok(logged.every((l) => !/[A-Za-z0-9_-]{43}/.test(l)), "no log line may contain a token");
});

test("in production with no AUTH_URL nothing is claimed or sent, and the answer is unchanged", async () => {
  const env = process.env as Record<string, string | undefined>;
  const savedNodeEnv = env.NODE_ENV;
  const savedAuthUrl = env.AUTH_URL;
  try {
    const normal = await snapshot(await post({ email: kid.email }));
    deferred = [];
    await sql`UPDATE athletes SET reset_token_hash = NULL, reset_expires = NULL, reset_requested_at = NULL`;

    env.NODE_ENV = "production";
    delete env.AUTH_URL;
    const res = await post({ email: kid.email });
    await flush();
    assert.deepEqual(await snapshot(res), normal, "the answer must not reveal the misconfiguration");
    assert.equal(sent.length, 0, "no email may be built from the request's Host header");
    const [r] = (await sql`
      SELECT reset_token_hash, reset_requested_at FROM athletes WHERE id = ${kid.id}
    `) as { reset_token_hash: string | null; reset_requested_at: unknown }[];
    assert.equal(r.reset_requested_at, null, "no claim, so no cooldown burned");
    assert.equal(r.reset_token_hash, null);
  } finally {
    if (savedNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = savedNodeEnv;
    if (savedAuthUrl === undefined) delete env.AUTH_URL;
    else env.AUTH_URL = savedAuthUrl;
  }
});
