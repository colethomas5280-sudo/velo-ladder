import "./testDom";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

mock.module("next-auth/react", { exports: { signIn: async () => ({ error: null }) } } as Parameters<typeof mock.module>[1]);
mock.module("next/navigation", {
  exports: { useRouter: () => ({ push() {}, refresh() {} }) },
} as Parameters<typeof mock.module>[1]);

let LoginForm: typeof import("./LoginForm").default;
before(async () => {
  LoginForm = (await import("./LoginForm")).default;
});
beforeEach(cleanup);

test("the login form links to the reset page", () => {
  render(<LoginForm />);
  const link = screen.getByRole("link", { name: /forgot password/i });
  assert.equal(link.getAttribute("href"), "/forgot-password");
});
