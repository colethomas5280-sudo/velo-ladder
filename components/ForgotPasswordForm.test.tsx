import "./testDom";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ForgotPasswordForm from "./ForgotPasswordForm";

const CONFIRM = "If that email is on a Velo Ladder account, we've sent a reset link. It works for 1 hour.";
const real = globalThis.fetch;
let posted: { url: string; body: Record<string, unknown> }[] = [];
let respond: () => Response | Promise<Response>;

beforeEach(() => {
  cleanup();
  posted = [];
  respond = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return respond();
    }
    return real(input as string, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

const submit = (email = "jake@school.org") => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
};

test("the send button waits for an email", () => {
  render(<ForgotPasswordForm available />);
  const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
  assert.equal(btn.disabled, true);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
  assert.equal(btn.disabled, false);
});

test("submitting posts the trimmed email and shows the fixed confirmation", async () => {
  render(<ForgotPasswordForm available />);
  submit("  jake@school.org ");
  await waitFor(() => screen.getByText(CONFIRM));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "/api/password-reset/request");
  assert.deepEqual(posted[0].body, { email: "jake@school.org" });
  assert.ok(screen.getByRole("link", { name: /back to sign in/i }));
});

test("the confirmation is the same whatever the email was", async () => {
  render(<ForgotPasswordForm available />);
  submit("nobody-at-all@nowhere.test");
  await waitFor(() => screen.getByText(CONFIRM));
});

test("a failed request says so instead of pretending it worked", async () => {
  respond = () => {
    throw new Error("network down");
  };
  render(<ForgotPasswordForm available />);
  submit();
  await waitFor(() => screen.getByRole("alert"));
  assert.match(screen.getByRole("alert").textContent!, /try again/i);
  assert.ok(screen.queryByText(CONFIRM) === null, "must not claim a link was sent");
});

test("when email is not set up the page says so and offers no form", () => {
  render(<ForgotPasswordForm available={false} />);
  assert.ok(screen.getByText(/ask your coach for a new invite/i));
  assert.ok(screen.queryByRole("button", { name: /send reset link/i }) === null);
  assert.ok(screen.getByRole("link", { name: /back to sign in/i }));
});
