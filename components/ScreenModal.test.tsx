import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SCREEN_TESTS } from "@/lib/screen";
import { BIG_12 } from "@/lib/big12";
import type { MovementScreen } from "@/lib/types";
import { withSwr } from "./testSwr";
import ScreenModal from "./ScreenModal";
import { todayISO } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * The coach's form
 *
 * The properties that make it safe to use: nothing is answered for the coach,
 * a branch appears only once the answer above it opens one, and the surface
 * of a push-off is never guessed by marking a test normal.
 * ------------------------------------------------------------------ */

const ID = "a1";
const form = (
  opts: {
    sessions?: unknown[];
    isCoach?: boolean;
    initial?: MovementScreen | null;
  } = {},
) =>
  render(
    withSwr(
      { [`/api/athletes/${ID}/sessions`]: opts.sessions ?? [] },
      <ScreenModal
        athleteId={ID}
        athleteName="Test Athlete"
        initial={opts.initial ?? null}
        takenDates={[]}
        isCoach={opts.isCoach ?? true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    ),
  );

/**
 * Stubs the network call `save()` makes, so a test can inspect exactly what
 * left the browser without a real server. Must be restored after use, or the
 * next test's fetch silently hits this stub instead of the "no fixture"
 * tripwire `withSwr` relies on.
 */
function mockApi() {
  const calls: Record<string, unknown>[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST" && typeof init.body === "string") {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return real(input as string, init);
  }) as typeof fetch;
  return {
    submitted: () => calls[calls.length - 1],
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const open = (label: RegExp) => {
  const head = [...document.querySelectorAll(".ms-test-toggle")].find((h) =>
    label.test(h.textContent ?? ""),
  )!;
  fireEvent.click(head);
};
const options = (aria: RegExp) => {
  const sel = [...document.querySelectorAll<HTMLSelectElement>(".ms-select")].find((s) =>
    aria.test(s.getAttribute("aria-label") ?? ""),
  )!;
  return { sel, texts: [...sel.options].map((o) => o.text) };
};

beforeEach(cleanup);

test("it opens with every test collapsed and nothing answered", () => {
  form();
  assert.equal(document.querySelectorAll(".ms-test").length, SCREEN_TESTS.length);
  assert.equal(document.querySelectorAll(".ms-test.open").length, 0);
  assert.match(document.body.textContent!, /0 of \d+/);
});

test("a branch is absent until the answer above it opens one", () => {
  form();
  open(/Toe Tap/);
  assert.equal(
    [...document.querySelectorAll(".ms-select")].some((s) =>
      /pelvis held/i.test(s.getAttribute("aria-label") ?? ""),
    ),
    false,
    "nothing has come up short yet",
  );

  const { sel } = options(/Hip internal rotation · Left/i);
  fireEvent.change(sel, { target: { value: "short" } });

  assert.equal(
    [...document.querySelectorAll(".ms-select")].some((s) =>
      /pelvis held · Left/i.test(s.getAttribute("aria-label") ?? ""),
    ),
    true,
    "the left leg came up short, so ask about the left",
  );
  assert.equal(
    [...document.querySelectorAll(".ms-select")].some((s) =>
      /pelvis held · Right/i.test(s.getAttribute("aria-label") ?? ""),
    ),
    false,
    "the right leg reached it, so ask nothing",
  );
});

/* Pain is a movement finding. "Where was this tested?" has no painful answer. */
test("a diagnostic question is offered neither pain nor not-tested", () => {
  form();
  open(/Push-Off/);
  assert.deepEqual(options(/Where was this tested/i).texts, [
    "Not recorded",
    "On the mound",
    "On flat ground",
  ]);
});

test("a graded question is offered both", () => {
  form();
  open(/Push-Off/);
  const { texts } = options(/back foot planted/i);
  assert.ok(texts.includes("Painful"));
  assert.ok(texts.includes("Not tested"));
});

/* Nothing is answered for the coach — "All normal" is a button they press. */
test("marking a test normal fills it, but never guesses the surface", () => {
  form();
  open(/Push-Off/);
  fireEvent.click(screen.getByText("All normal"));
  assert.equal(options(/back foot planted/i).sel.value, "gt-6");
  assert.equal(options(/Where was this tested/i).sel.value, "", "nothing knows where he threw");
});

test("the footer offers to fill only what it can actually fill", () => {
  form();
  const btn = screen.getByText(/mark \d+ remaining tests? normal/i);
  assert.match(btn.textContent!, new RegExp(`${SCREEN_TESTS.length} remaining`));
  fireEvent.click(btn);
  assert.equal(
    screen.queryByText(/mark \d+ remaining tests? normal/i),
    null,
    "nothing left it could fill",
  );
});

/* Screen fresh, not post-throwing. */
test("a date the athlete threw on is flagged, not blocked", () => {
  // The form opens dated today, so the session has to be dated today too.
  form({
    sessions: [{ id: "s1", athleteId: ID, type: "mound", date: todayISO(), notes: "", throws: {} }],
  });
  assert.match(document.body.textContent!, /threw on this date/i);
  assert.ok(screen.getByText(/save screen/i), "still recordable");
});

test("a quiet date is not flagged", () => {
  form({
    sessions: [{ id: "s1", athleteId: ID, type: "mound", date: "2020-01-01", notes: "", throws: {} }],
  });
  assert.doesNotMatch(document.body.textContent!, /threw on this date/i);
});

/* ------------------------------------------------------------------ *
 * Recording the Big 12
 * ------------------------------------------------------------------ */

test("the twelve are offered in Cole's order, behind the assessed checkbox", () => {
  form();
  const assessed = document.querySelector('input[name="deliveryAssessed"]');
  assert.ok(assessed, "no delivery-assessed checkbox");
  for (const flaw of BIG_12)
    assert.ok(
      document.querySelector(`input[name="flaw:${flaw.key}"]`),
      `${flaw.label} is not offered`,
    );
});

/*
 * Welded once already, in a different component (recipe cards), and called
 * out for it twice. The description and the how-to-spot procedure are
 * different kinds of copy and must render as distinct blocks, never
 * concatenated into one string a coach has to read all the way through to
 * find where the procedure starts.
 */
test("a flaw's description and how-to-spot render as separate blocks, not one string", () => {
  form();
  const flaw = BIG_12[0];
  const card = document
    .querySelector(`input[name="flaw:${flaw.key}"]`)!
    .closest(".ms-flaw-card")!;
  fireEvent.click(card.querySelector(".ms-test-toggle")!);

  const body = card.querySelector(".ms-test-body")!;
  const blocks = [...body.querySelectorAll(".ms-help")];
  assert.equal(blocks.length, 2, "description and how-to-spot must be separate elements");
  assert.equal(blocks[0].textContent, flaw.description);
  assert.equal(blocks[1].textContent, flaw.howToSpot);
  assert.ok(
    !body.textContent!.includes(`${flaw.description} ${flaw.howToSpot}`),
    "must not be welded into one run-on string",
  );
  assert.match(body.textContent!, /how to spot it/i);
});

test("ticking a flaw marks the delivery as assessed", async () => {
  /*
   * The server refuses a record where these disagree. The UI must not be
   * able to build one, or a coach loses a screen he thought he had saved.
   */
  const { submitted, restore } = mockApi();
  try {
    form();
    fireEvent.click(
      document.querySelector<HTMLInputElement>('input[name="flaw:sway"]')!,
    );
    assert.equal(
      document.querySelector<HTMLInputElement>('input[name="deliveryAssessed"]')!
        .checked,
      true,
    );
    fireEvent.click(screen.getByText(/save screen/i));
    await waitFor(() => assert.ok(submitted()));
    assert.equal(submitted().deliveryAssessed, true);
    assert.deepEqual(submitted().flaws, { sway: true });
  } finally {
    restore();
  }
});

/*
 * The fix for the wipe hole: unticking "assessed" while a flaw is marked
 * used to silently clear every ticked flaw. That destroyed a coach's work on
 * one mis-click, with no confirm and no undo. The UI must refuse instead —
 * disable the box and explain why, the same way delete already protects
 * against a stray click rather than acting on it.
 */
test("the assessed checkbox cannot be unticked while a flaw is marked", () => {
  form();
  fireEvent.click(
    document.querySelector<HTMLInputElement>('input[name="flaw:sway"]')!,
  );
  const assessed = document.querySelector<HTMLInputElement>(
    'input[name="deliveryAssessed"]',
  )!;
  assert.equal(assessed.checked, true);
  assert.equal(assessed.disabled, true, "must refuse, not wipe, while a flaw is marked");

  fireEvent.click(assessed);
  assert.equal(assessed.checked, true, "a disabled checkbox must not toggle off");
  assert.equal(
    document.querySelector<HTMLInputElement>('input[name="flaw:sway"]')!.checked,
    true,
    "the flaw survives the attempted uncheck",
  );
});

test("an athlete never sees the recording controls", () => {
  form({ isCoach: false });
  assert.equal(document.querySelector('input[name="flaw:sway"]'), null);
  assert.equal(document.querySelector('input[name="deliveryAssessed"]'), null);
});

/*
 * The carried finding: `upsertScreen` writes EXCLUDED.flaws on conflict, so a
 * submit that omits `flaws` wipes out whatever was already recorded. A coach
 * who opens a screen with a flaw already marked, edits something unrelated,
 * and saves again must not silently erase his own assessment.
 */
test("editing an already-assessed screen keeps sending its flaws", async () => {
  const { submitted, restore } = mockApi();
  try {
    const existing: MovementScreen = {
      id: "scr1",
      athleteId: ID,
      date: "2020-01-01",
      results: {},
      notes: "old note",
      flaws: { sway: true },
      deliveryAssessed: true,
    };
    form({ initial: existing });

    // Change something unrelated to the Big 12 section entirely.
    fireEvent.change(screen.getByPlaceholderText(/guarding on the left/i), {
      target: { value: "new note" },
    });

    fireEvent.click(screen.getByText(/update screen/i));
    await waitFor(() => assert.ok(submitted()));
    assert.deepEqual(submitted().flaws, { sway: true });
    assert.equal(submitted().deliveryAssessed, true);
  } finally {
    restore();
  }
});
