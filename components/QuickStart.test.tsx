import "./testDom";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import type { AthleteOverview } from "@/lib/types";
import { withSwr } from "./testSwr";
import QuickStart from "./QuickStart";
import RecordChooser from "./RecordChooser";

/* ------------------------------------------------------------------ *
 * The two homepage buttons and the flows behind them
 *
 * The flow tests hand the athlete list over as a fixture. The loading,
 * failure and "not requested up front" tests do the opposite: no fixture,
 * a stubbed fetch the test controls, so what the coach sees while the list
 * is really pending is what gets asserted.
 * ------------------------------------------------------------------ */

const person = (id: string, name: string, archived = false) =>
  ({ id, name, archived }) as unknown as AthleteOverview;

const ROSTER = [person("a1", "Jake Bell"), person("a2", "Cooper Hale"), person("a3", "Gone Guy", true)];

const FIXTURES: Record<string, unknown> = {
  "/api/athletes/overview": ROSTER,
  "/api/athletes/a1/screens": [],
  "/api/athletes/a2/screens": [],
  "/api/athletes/a1/sessions": [],
  "/api/athletes/a2/sessions": [],
  "/api/athletes/a1/delivery": [],
  "/api/athletes/a2/delivery": [],
};

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
});
afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const flows = (extra: Record<string, unknown> = {}, ui: React.ReactNode = <QuickStart />) =>
  render(withSwr({ ...FIXTURES, ...extra }, ui));

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const dialog = (name: string) => screen.queryByRole("dialog", { name });
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

/* ---- the buttons ---- */

test("both buttons render and nothing else is open", () => {
  flows();
  assert.ok(screen.queryByRole("button", { name: /Track a new session/ }) !== null);
  assert.ok(screen.queryByRole("button", { name: /Track a new test/ }) !== null);
  assert.ok(screen.queryByRole("dialog") === null, "no dialog until a button is pressed");
});

/* ---- session ---- */

test("Track a new session lists only the active athletes", () => {
  flows();
  press(/^Track a new session/);
  assert.ok(dialog("Who is in this session?") !== null);
  assert.ok(screen.queryByRole("checkbox", { name: "Jake Bell" }) !== null);
  assert.ok(screen.queryByRole("checkbox", { name: "Cooper Hale" }) !== null);
  assert.ok(screen.queryByRole("checkbox", { name: "Gone Guy" }) === null, "archived athletes never appear");
  assert.ok(screen.queryByRole("button", { name: "Start session" }) !== null, "no one picked yet");
});

test("picking two and starting opens the group velocity screen", () => {
  flows();
  press(/^Track a new session/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Jake Bell" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Cooper Hale" }));
  press("Start session with 2");
  assert.ok(screen.queryByText("Log session") !== null, "the velocity screen is open");
  assert.ok(dialog("Who is in this session?") === null, "the picker is gone");
});

/* ---- test ---- */

test("Track a new test offers exactly the two assessments, titled for the flow", () => {
  flows();
  press(/^Track a new test/);
  const chooser = dialog("Track a new test");
  assert.ok(chooser !== null, "the chooser carries the new title");
  assert.ok(within(chooser!).queryByText("Track a new test") !== null, "and shows it");
  const cards = Array.from(chooser!.querySelectorAll(".tc-name")).map((n) => n.textContent);
  assert.deepEqual(cards, ["Movement screen", "Pitching Inhibitors"]);
  assert.ok(screen.queryByRole("checkbox") === null, "the picker waits for the choice");
});

test("choosing Movement screen asks who, then opens that group test", () => {
  flows();
  press(/^Track a new test/);
  press(/^Movement screen/);
  assert.ok(dialog("Who is being tested?") !== null);
  assert.ok(screen.queryByRole("checkbox", { name: "Gone Guy" }) === null);
  assert.ok(screen.queryByRole("button", { name: "Start test" }) !== null);
  fireEvent.click(screen.getByRole("checkbox", { name: "Jake Bell" }));
  press("Start test with 1");
  assert.ok(dialog("Movement screen") !== null, "the movement screen group test is open");
  assert.ok(screen.queryByRole("button", { name: "Jake Bell" }) !== null, "with the athlete's tab");
  assert.ok(dialog("Who is being tested?") === null);
});

test("choosing Pitching Inhibitors opens the delivery group test", () => {
  flows();
  press(/^Track a new test/);
  press(/^Pitching Inhibitors/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Cooper Hale" }));
  press("Start test with 1");
  assert.ok(dialog("Pitching Inhibitors") !== null);
  assert.ok(dialog("Movement screen") === null);
  assert.ok(screen.queryByRole("button", { name: "Cooper Hale" }) !== null);
});

test("the chooser, given no title, is still the Record a screen one", () => {
  render(<RecordChooser onPick={() => {}} onClose={() => {}} />);
  assert.ok(screen.queryByRole("dialog", { name: "Record an assessment" }) !== null);
  assert.ok(screen.queryByText("Record a screen") !== null);
});

/* ---- backing out ---- */

test("closing a picker returns to the two buttons and opens nothing else", () => {
  flows();
  press(/^Track a new session/);
  press("Close");
  assert.ok(screen.queryByRole("dialog") === null);
  assert.ok(screen.queryByRole("button", { name: /Track a new session/ }) !== null);
  assert.ok(screen.queryByRole("button", { name: /Track a new test/ }) !== null);
});

test("cancelling the chooser opens no picker", () => {
  flows();
  press(/^Track a new test/);
  press("Close");
  assert.ok(screen.queryByRole("dialog") === null);
  assert.ok(screen.queryByRole("checkbox") === null);
});

/* ---- the athlete list: when it is asked for, and what shows meanwhile ---- */

/**
 * A fetch the test controls. The athlete list waits for answer()/fail(); every
 * other GET answers [] at once. Every GET url is recorded.
 */
function liveApi() {
  const gets: string[] = [];
  const waiting: ((r: Response) => void)[] = [];
  const real = globalThis.fetch;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    gets.push(url);
    if (url !== "/api/athletes/overview") return json([]);
    return new Promise<Response>((res) => waiting.push(res));
  }) as typeof fetch;
  const reply = async (body: unknown, status = 200) => {
    await waitFor(() => assert.ok(waiting.length > 0, "no athlete-list GET is waiting"));
    const res = waiting.shift()!;
    await act(async () => {
      res(json(body, status));
      await new Promise((r) => setTimeout(r, 20));
    });
  };
  return { gets, reply, restore: () => (globalThis.fetch = real) };
}

const live = (ui: React.ReactNode = <QuickStart />) =>
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        shouldRetryOnError: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 0,
      }}
    >
      {ui}
    </SWRConfig>,
  );

const listGets = (gets: string[]) => gets.filter((u) => u === "/api/athletes/overview").length;

test("the athlete list is not requested until a picker is wanted", async () => {
  const api = liveApi();
  try {
    live();
    await tick();
    assert.ok(screen.queryByRole("button", { name: /Track a new session/ }) !== null);
    assert.equal(listGets(api.gets), 0, "the homepage costs nothing");

    press(/^Track a new test/);
    await tick();
    assert.equal(listGets(api.gets), 0, "the chooser does not need the list either");

    press(/^Movement screen/);
    await waitFor(() => assert.equal(listGets(api.gets), 1, "the picker asks for it"));
  } finally {
    api.restore();
  }
});

test("while the list loads there is a loading note with a way out, never the empty-roster message or a picker", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new session/);
    await waitFor(() => assert.equal(listGets(api.gets), 1));
    assert.ok(screen.queryByText("Loading athletes…") !== null, "loading note");
    assert.ok(screen.queryByText("No athletes yet.") === null, "an unloaded roster is not an empty one");
    assert.ok(screen.queryByRole("checkbox") === null && screen.queryByPlaceholderText(/search/i) === null, "no picker yet");
    assert.ok(screen.queryByRole("button", { name: /^Start/ }) === null);

    press("Close");
    assert.ok(screen.queryByRole("dialog") === null, "back to the idle buttons");
    assert.ok(screen.queryByRole("button", { name: /Track a new test/ }) !== null);
  } finally {
    api.restore();
  }
});

test("when the list arrives the picker takes the loading note's place", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new session/);
    await api.reply(ROSTER);
    assert.ok(screen.queryByText("Loading athletes…") === null);
    assert.ok(screen.queryByRole("checkbox", { name: "Jake Bell" }) !== null);
    assert.ok(screen.queryByRole("checkbox", { name: "Gone Guy" }) === null);
  } finally {
    api.restore();
  }
});

test("a coach with no athletes does get told so, once the list has loaded", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new session/);
    await api.reply([]);
    assert.ok(screen.queryByText("No athletes yet.") !== null);
  } finally {
    api.restore();
  }
});

test("a failed load says so, can be retried, and can be closed", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new test/);
    press(/^Movement screen/);
    await api.reply({ error: "down" }, 500);
    assert.ok(screen.queryByText("Couldn't load your athletes.") !== null);
    assert.ok(screen.queryByText("Loading athletes…") === null, "not stuck on loading");
    assert.ok(screen.queryByText("No athletes yet.") === null);
    assert.ok(screen.queryByRole("checkbox") === null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => assert.equal(listGets(api.gets), 2, "Retry asks again"));
    await api.reply(ROSTER);
    assert.ok(screen.queryByText("Couldn't load your athletes.") === null);
    assert.ok(dialog("Who is being tested?") !== null);
    assert.ok(screen.queryByRole("checkbox", { name: "Cooper Hale" }) !== null, "the picker is there now");
  } finally {
    api.restore();
  }
});

test("Escape closes the loading note", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new session/);
    await waitFor(() => assert.ok(screen.queryByText("Loading athletes…") !== null));
    fireEvent.keyDown(document, { key: "Escape" });
    assert.ok(screen.queryByRole("dialog") === null);
    assert.ok(screen.queryByRole("button", { name: /^Track a new session/ }) !== null);
  } finally {
    api.restore();
  }
});

test("a failed load can be closed back to the idle buttons", async () => {
  const api = liveApi();
  try {
    live();
    press(/^Track a new session/);
    await api.reply({ error: "down" }, 500);
    assert.ok(screen.queryByText("Couldn't load your athletes.") !== null);
    press("Close");
    assert.ok(screen.queryByRole("dialog") === null);
    assert.ok(screen.queryByRole("button", { name: /Track a new session/ }) !== null);
  } finally {
    api.restore();
  }
});

/* ---- refreshing the rest of the app ---- */

const REFRESHED = ["/api/dashboard", "/api/screens/overview", "/api/delivery/overview"];

/** Subscribes to one key with a fetcher that logs, so a refresh is observable. */
function Watch({ k, log, failing }: { k: string; log: string[]; failing?: string }) {
  useSWR(k, async () => {
    log.push(k);
    if (k === failing) throw new Error("down");
    return {};
  });
  return null;
}

function watched(log: string[], failing?: string) {
  const fixtures = Object.fromEntries(REFRESHED.map((k) => [k, {}]));
  return flows(
    fixtures,
    <>
      {REFRESHED.map((k) => (
        <Watch key={k} k={k} log={log} failing={failing} />
      ))}
      <QuickStart />
    </>,
  );
}

async function openTestAndClose() {
  press(/^Track a new test/);
  press(/^Movement screen/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Jake Bell" }));
  press("Start test with 1");
  await act(async () => {
    fireEvent.click(within(dialog("Movement screen")!).getByRole("button", { name: "Close" }));
  });
}

test("closing a test screen refreshes the dashboard and both overviews, and returns to the buttons", async () => {
  const log: string[] = [];
  watched(log);
  assert.deepEqual(log, [], "nothing fetched before the close");
  await openTestAndClose();
  await waitFor(() => assert.deepEqual([...log].sort(), [...REFRESHED].sort()));
  assert.ok(screen.queryByRole("dialog") === null);
});

test("closing a session screen refreshes the same three", async () => {
  const log: string[] = [];
  watched(log);
  press(/^Track a new session/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Jake Bell" }));
  press("Start session with 1");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  });
  // Closing the velocity pop-up now asks first; leaving is what really closes it.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  });
  await waitFor(() => assert.deepEqual([...log].sort(), [...REFRESHED].sort()));
});

test("a refresh whose fetch fails still refreshes the rest and still closes", async () => {
  const log: string[] = [];
  watched(log, "/api/dashboard");
  await openTestAndClose();
  await waitFor(() => assert.deepEqual([...log].sort(), [...REFRESHED].sort()));
  assert.ok(screen.queryByRole("dialog") === null);
});
