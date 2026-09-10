import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SCREEN_TESTS } from "@/lib/screen";
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
const form = (sessions: unknown[] = []) =>
  render(
    withSwr(
      { [`/api/athletes/${ID}/sessions`]: sessions },
      <ScreenModal
        athleteId={ID}
        athleteName="Test Athlete"
        initial={null}
        takenDates={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    ),
  );

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

  const { sel } = options(/Hip internal rotation — Left/i);
  fireEvent.change(sel, { target: { value: "short" } });

  assert.equal(
    [...document.querySelectorAll(".ms-select")].some((s) =>
      /pelvis held — Left/i.test(s.getAttribute("aria-label") ?? ""),
    ),
    true,
    "the left leg came up short, so ask about the left",
  );
  assert.equal(
    [...document.querySelectorAll(".ms-select")].some((s) =>
      /pelvis held — Right/i.test(s.getAttribute("aria-label") ?? ""),
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
  form([{ id: "s1", athleteId: ID, type: "mound", date: todayISO(), notes: "", throws: {} }]);
  assert.match(document.body.textContent!, /threw on this date/i);
  assert.ok(screen.getByText(/save screen/i), "still recordable");
});

test("a quiet date is not flagged", () => {
  form([{ id: "s1", athleteId: ID, type: "mound", date: "2020-01-01", notes: "", throws: {} }]);
  assert.doesNotMatch(document.body.textContent!, /threw on this date/i);
});
