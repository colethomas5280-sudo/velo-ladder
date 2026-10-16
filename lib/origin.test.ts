import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appOrigin } from "@/lib/origin";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.AUTH_URL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = saved;
});

test("AUTH_URL wins, with any trailing slash removed", () => {
  process.env.AUTH_URL = "https://velo.test/";
  assert.equal(appOrigin(new Request("http://other.host/x")), "https://velo.test");
});

test("without AUTH_URL the request's own origin is used", () => {
  delete process.env.AUTH_URL;
  assert.equal(appOrigin(new Request("http://localhost:3000/api/x")), "http://localhost:3000");
});
