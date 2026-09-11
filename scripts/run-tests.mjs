#!/usr/bin/env node
/**
 * Run the test suite, and refuse to call a short run green.
 *
 * The suite used to run under `--test-force-exit`, which exits as soon as the
 * runner thinks it is done. Measured at 2 runs in 12, it fired while the two
 * slowest files were still going — dropping 32 of 658 tests, reporting
 * `fail 0`, and exiting 0. `npm run verify` went green having never run part
 * of the suite, which is the same shape as the build check that reported
 * "Compiled successfully" for two commits while the build was broken.
 *
 * The cause was ours: a PGlite instance is a live WASM database that holds
 * the event loop open, and no test ever closed one, so the run never ended on
 * its own. They close themselves now and the flag is gone.
 *
 * This floor stays as the backstop. Adding tests never trips it; a run that
 * silently loses a file always does. When you deliberately remove tests,
 * lower MIN_TESTS in the same commit.
 */
import { spawn } from "node:child_process";

/** The suite has never legitimately been smaller than this. */
const MIN_TESTS = 670;

const args = [
  "--import",
  "tsx",
  "--test",
  "--experimental-test-module-mocks",
  "lib/**/*.test.ts",
  "components/**/*.test.tsx",
];

const child = spawn(process.execPath, args, { stdio: ["inherit", "pipe", "inherit"] });

let out = "";
child.stdout.on("data", (chunk) => {
  out += chunk;
  process.stdout.write(chunk);
});

child.on("close", (code) => {
  const read = (label) => {
    const m = new RegExp(`^ℹ ${label} (\\d+)$`, "m").exec(out);
    return m ? Number(m[1]) : null;
  };
  const tests = read("tests");
  const failed = read("fail");

  if (code !== 0 || (failed ?? 1) > 0) process.exit(code || 1);

  if (tests === null) {
    console.error("\n✖ could not read a test count from the run — treating as a failure");
    process.exit(1);
  }
  if (tests < MIN_TESTS) {
    console.error(
      `\n✖ only ${tests} tests ran; at least ${MIN_TESTS} were expected.\n` +
        `  Nothing FAILED — a file did not report at all. Usually that means a\n` +
        `  test file left something open and the run was cut short. If the count\n` +
        `  is genuinely lower because tests were removed, lower MIN_TESTS in\n` +
        `  scripts/run-tests.mjs.`,
    );
    process.exit(1);
  }
  process.exit(0);
});
