import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BIG_12 } from "@/lib/big12";
import type { DeliveryScreen } from "@/lib/types";
import { TODAY } from "./testRender";
import DeliveryModal from "./DeliveryModal";

/* ------------------------------------------------------------------ *
 * Recording a delivery assessment
 *
 * Split off the movement screen in v27 (see ScreenModal): a saved row IS
 * the assessment now, so there is no separate flag saying whether anyone
 * looked, and nothing here reaches into the physical screen at all.
 * ------------------------------------------------------------------ */

const ID = "a1";
const modal = (
  opts: {
    date?: string;
    initial?: DeliveryScreen | null;
  } = {},
) =>
  render(
    <DeliveryModal
      athleteId={ID}
      date={opts.date ?? TODAY}
      initial={opts.initial ?? null}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

/**
 * Stubs the network call `save()` makes, so a test can inspect exactly what
 * left the browser without a real server. Must be restored after use.
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

beforeEach(cleanup);

test("the twelve are offered in the app owner's order", () => {
  modal();
  const boxes = [...document.querySelectorAll('input[name^="flaw:"]')];
  assert.equal(boxes.length, 12);
  assert.deepEqual(
    boxes.map((b) => b.getAttribute("name")),
    BIG_12.map((f) => `flaw:${f.key}`),
  );
});

/*
 * Welded once already, in a different component (recipe cards), and called
 * out for it twice. The description and the how-to-spot procedure are
 * different kinds of copy and must render as distinct blocks, never
 * concatenated into one string a coach has to read all the way through to
 * find where the procedure starts.
 */
test("a flaw's description and how-to-spot stay two blocks, not one string", () => {
  modal();
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

/*
 * The row IS the assessment now (see lib/deliveryInput.ts): nothing ticked
 * still means "I looked and found nothing", which is a result, not a blank.
 */
test("saving with nothing ticked still records an assessment", async () => {
  const { submitted, restore } = mockApi();
  try {
    modal();
    fireEvent.click(screen.getByText(/save assessment/i));
    await waitFor(() => assert.ok(submitted()));
    assert.deepEqual(submitted(), { date: TODAY, flaws: {}, notes: "" });
  } finally {
    restore();
  }
});

test("there is no separate assessed checkbox any more", () => {
  modal();
  assert.equal(document.querySelector('input[name="deliveryAssessed"]'), null);
});

test("an existing assessment opens with its marks already ticked", () => {
  const existing: DeliveryScreen = {
    id: "d1",
    athleteId: ID,
    date: "2020-01-01",
    flaws: { sway: true },
    notes: "",
  };
  modal({ initial: existing });
  assert.equal(
    document.querySelector<HTMLInputElement>('input[name="flaw:sway"]')!.checked,
    true,
  );
});

/*
 * Carried from ScreenModal's "ticking a flaw marks the delivery as
 * assessed" — the assessed-flag side effect that test pinned is gone (see
 * "there is no separate assessed checkbox any more" above), but ticking a
 * flaw must still reach the saved payload.
 */
test("ticking a flaw includes it in the saved assessment", async () => {
  const { submitted, restore } = mockApi();
  try {
    modal();
    fireEvent.click(
      document.querySelector<HTMLInputElement>('input[name="flaw:sway"]')!,
    );
    fireEvent.click(screen.getByText(/save assessment/i));
    await waitFor(() => assert.ok(submitted()));
    assert.deepEqual(submitted().flaws, { sway: true });
  } finally {
    restore();
  }
});

/*
 * Carried from ScreenModal's "editing an already-assessed screen keeps
 * sending its flaws" — `upsertDeliveryScreen` writes EXCLUDED.flaws on
 * conflict the same way `upsertScreen` did, so a submit that omits `flaws`
 * would wipe out whatever was already recorded. Editing something unrelated
 * (the notes) must not silently erase the marks already on the row.
 */
test("editing an already-recorded assessment keeps sending its flaws", async () => {
  const { submitted, restore } = mockApi();
  try {
    const existing: DeliveryScreen = {
      id: "d1",
      athleteId: ID,
      date: "2020-01-01",
      flaws: { sway: true },
      notes: "old note",
    };
    modal({ initial: existing });

    fireEvent.change(screen.getByPlaceholderText(/filmed from the side/i), {
      target: { value: "new note" },
    });

    fireEvent.click(screen.getByText(/update assessment/i));
    await waitFor(() => assert.ok(submitted()));
    assert.deepEqual(submitted().flaws, { sway: true });
  } finally {
    restore();
  }
});
