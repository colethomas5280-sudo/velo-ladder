import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SCREEN_TESTS } from "@/lib/screen";
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

/*
 * The Big 12 moved to its own modal (see DeliveryModal.test.tsx) along with
 * every assertion this file used to carry about it: the offered order, the
 * description/how-to-spot split, ticking a flaw into the saved payload, and
 * flaws surviving an edit. The delivery-assessed flag itself did not move —
 * a saved delivery row is the assessment now, so that mechanism is gone
 * outright rather than moved anywhere.
 */

/*
 * The carried finding: `upsertScreen` writes EXCLUDED.notes on conflict, so a
 * submit that omits `notes` wipes out whatever was already recorded. A coach
 * who opens a screen, edits something unrelated, and saves again must not
 * silently erase his own note.
 */
test("editing an existing screen keeps sending its notes", async () => {
  const { submitted, restore } = mockApi();
  try {
    const existing: MovementScreen = {
      id: "scr1",
      athleteId: ID,
      date: "2020-01-01",
      results: {},
      notes: "old note",
      flaws: {},
      deliveryAssessed: false,
    };
    form({ initial: existing });

    fireEvent.click(screen.getByText(/update screen/i));
    await waitFor(() => assert.ok(submitted()));
    assert.equal(submitted().notes, "old note");
  } finally {
    restore();
  }
});
