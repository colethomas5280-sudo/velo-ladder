import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import InviteAthleteModal from "./InviteAthleteModal";

/* ------------------------------------------------------------------ *
 * Adding an athlete and getting them their invite in one step.
 *
 * Email is the default delivery. With it configured the server sends the
 * invite and the form says so; with it not configured the form behaves as it
 * always did and the coach copies the link. A failed send never loses the
 * link. The network is stubbed per URL so each test can see exactly what left
 * the browser, in order.
 * ------------------------------------------------------------------ */

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let inviteReply: Record<string, unknown> = {};
const real = globalThis.fetch;
const URL_OUT = "https://velo.test/join/tok123";

function stub() {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
      const out = url.endsWith("/invite")
        ? inviteReply
        : { id: "a9", name: "Jake Bell" };
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return real(input as string, init);
  }) as typeof fetch;
}

beforeEach(() => {
  cleanup();
  stub();
});
afterEach(() => {
  globalThis.fetch = real;
});

const open = (emailConfigured: boolean) =>
  render(
    <InviteAthleteModal
      emailConfigured={emailConfigured}
      onClose={() => {}}
      onCreated={() => {}}
    />,
  );

function fill(name = "Jake Bell", email = "jake@school.org") {
  fireEvent.change(screen.getByLabelText(/athlete name/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/login email/i), { target: { value: email } });
}

test("with email set up, the button says it will email the invite", () => {
  open(true);
  assert.ok(screen.getByRole("button", { name: "Create & email the invite" }));
});

test("with email not set up, the button still says it will copy the link", () => {
  open(false);
  assert.ok(screen.getByRole("button", { name: "Create & copy invite link" }));
});

test("there is no phone field any more", () => {
  open(true);
  // A boolean, not the element: a failing equal() on a DOM node diffs all of jsdom.
  assert.ok(screen.queryByLabelText(/mobile/i) === null, "phone field must be gone");
});

test("the button waits for both a name and an email", () => {
  open(true);
  const btn = screen.getByRole("button", { name: "Create & email the invite" }) as HTMLButtonElement;
  assert.equal(btn.disabled, true);
  fireEvent.change(screen.getByLabelText(/athlete name/i), { target: { value: "Jake" } });
  assert.equal(btn.disabled, true, "name alone is not enough");
  fireEvent.change(screen.getByLabelText(/login email/i), { target: { value: "jake@school.org" } });
  assert.equal(btn.disabled, false);
});

test("emailing creates the athlete, then asks the server to email the invite", async () => {
  inviteReply = {
    url: URL_OUT,
    email: { sent: true, to: "jake@school.org" },
    emailConfigured: true,
  };
  open(true);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Create & email the invite" }));

  await waitFor(() => screen.getByText(/Emailed to/));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/athletes");
  assert.deepEqual(calls[0].body, { name: "Jake Bell", inviteEmail: "jake@school.org" });
  assert.equal(calls[1].url, "/api/athletes/a9/invite");
  assert.deepEqual(calls[1].body, { channel: "email" });
  assert.ok(screen.getByText("jake@school.org"), "says where it went");
});

test("a failed send says why and still shows the link to hand over", async () => {
  inviteReply = {
    url: URL_OUT,
    email: { sent: false, reason: "send_failed", detail: "The powerpitcherpathway.com domain is not verified." },
    emailConfigured: true,
  };
  open(true);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Create & email the invite" }));

  await waitFor(() => screen.getByRole("alert"));
  assert.match(screen.getByRole("alert").textContent!, /domain is not verified/);
  const link = document.querySelector<HTMLInputElement>("input.invite-link")!;
  assert.equal(link.value, URL_OUT, "the link survives a failed send");
  assert.ok(screen.queryByText(/Emailed to/) === null, "must not claim it was sent");
});

test("without email set up, it creates the athlete and shows the link, sending no channel", async () => {
  inviteReply = { url: URL_OUT, email: null, emailConfigured: false };
  open(false);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Create & copy invite link" }));

  await waitFor(() => assert.ok(document.querySelector("input.invite-link"), "link shown"));
  assert.deepEqual(calls[1].body, {}, "no channel, so the server sends nothing");
  assert.equal(document.querySelector<HTMLInputElement>("input.invite-link")!.value, URL_OUT);
});
