import "./testDom";
import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const signInCalls: unknown[][] = [];
let signInResult: { error: string | null } = { error: null };
let signInThrows = false;
mock.module("next-auth/react", {
  exports: {
    signIn: async (...args: unknown[]) => {
      signInCalls.push(args);
      if (signInThrows) throw new Error("network dropped");
      return signInResult;
    },
  },
} as Parameters<typeof mock.module>[1]);

let ResetPasswordForm: typeof import("./ResetPasswordForm").default;
before(async () => {
  ResetPasswordForm = (await import("./ResetPasswordForm")).default;
});

const real = globalThis.fetch;
let posted: { url: string; body: Record<string, unknown> }[] = [];
let reply: { status: number; body: unknown };
const redirects: string[] = [];

beforeEach(() => {
  cleanup();
  posted = [];
  redirects.length = 0;
  signInCalls.length = 0;
  signInResult = { error: null };
  signInThrows = false;
  reply = { status: 200, body: { email: "jake@school.org" } };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
    }
    return real(input as string, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

const open = () => render(<ResetPasswordForm token="tok-123" redirect={(to) => redirects.push(to)} />);
const fill = (a: string, b: string) => {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: a } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: b } });
};
const button = () => screen.getByRole("button", { name: /set new password/i }) as HTMLButtonElement;

test("the button waits for six characters that match", () => {
  open();
  assert.equal(button().disabled, true);
  fill("short", "short");
  assert.equal(button().disabled, true, "five characters is too short");
  fill("longenough", "different1");
  assert.equal(button().disabled, true, "a mismatch is not enough");
  assert.ok(screen.getByText(/don.t match/i));
  fill("longenough", "longenough");
  assert.equal(button().disabled, false);
});

test("success posts the token and password, signs in with the returned email, and goes home", async () => {
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => assert.deepEqual(redirects, ["/"]));
  assert.equal(posted[0].url, "/api/password-reset/confirm");
  assert.deepEqual(posted[0].body, { token: "tok-123", password: "longenough" });
  assert.equal(signInCalls.length, 1);
  assert.equal(signInCalls[0][0], "credentials");
  assert.deepEqual(signInCalls[0][1], { email: "jake@school.org", password: "longenough", redirect: false });
});

test("an expired link shows the server's message and does not sign in or redirect", async () => {
  reply = { status: 404, body: { error: "This reset link has expired or was already used" } };
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => screen.getByRole("alert"));
  assert.match(screen.getByRole("alert").textContent!, /expired or was already used/);
  assert.equal(signInCalls.length, 0);
  assert.deepEqual(redirects, []);
});

test("if the password was set but sign-in fails, they are sent to the login page", async () => {
  signInResult = { error: "CredentialsSignin" };
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => assert.deepEqual(redirects, ["/login"]));
});

test("if sign-in throws after the password was set, they go to the login page with no error", async () => {
  signInThrows = true;
  open();
  fill("longenough", "longenough");
  fireEvent.click(button());
  await waitFor(() => assert.deepEqual(redirects, ["/login"]));
  assert.equal(posted.length, 1, "the password was set once");
  assert.ok(screen.queryByRole("alert") === null, "a sign-in failure must not read as a failed reset");
});

test("submitting the form with a too-short password posts nothing", async () => {
  const { container } = open();
  fill("short", "short");
  const form = container.querySelector("form")!;
  fireEvent.submit(form);
  fireEvent.keyDown(screen.getByLabelText(/confirm/i), { key: "Enter" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posted.length, 0);
  assert.deepEqual(redirects, []);
});

test("submitting the form with a valid password posts it once", async () => {
  const { container } = open();
  fill("longenough", "longenough");
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => assert.deepEqual(redirects, ["/"]));
  assert.equal(posted.length, 1);
});
