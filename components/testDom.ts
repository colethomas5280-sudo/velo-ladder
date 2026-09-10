import { JSDOM } from "jsdom";

/* ------------------------------------------------------------------ *
 * A DOM for the component tests
 *
 * Node's test runner has no DOM, and React Testing Library needs one before
 * anything is imported that touches `document`. Importing this module first
 * installs the globals; importing it twice is a no-op.
 *
 * Test-only. Nothing in `app/` or the shipped bundle imports it, and jsdom is
 * a devDependency.
 * ------------------------------------------------------------------ */

const g = globalThis as Record<string, unknown>;

if (!g.document) {
  /*
   * No `pretendToBeVisual`: it starts a requestAnimationFrame loop that keeps
   * the event loop alive, and Node's test runner waits for that to drain — so
   * the suite runs, passes, and then hangs forever without printing a line.
   */
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  g.window = dom.window;
  g.document = dom.window.document;
  // `navigator` is getter-only on Node's global, so plain assignment throws.
  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.getComputedStyle = dom.window.getComputedStyle;
  g.localStorage = dom.window.localStorage;
  /*
   * `next/link` prefetches through `requestIdleCallback`, which it reaches
   * via `self`. jsdom sets neither, so rendering any Link threw
   * "self is not defined" from inside React's commit phase — a long way from
   * anything a test wrote.
   */
  g.self = dom.window;
  g.requestIdleCallback = (fn: () => void) => setTimeout(fn, 0) as unknown as number;
  g.cancelIdleCallback = (id: number) => clearTimeout(id);
  g.requestAnimationFrame = (fn: (t: number) => void) =>
    setTimeout(() => fn(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  g.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  };
  dom.window.IntersectionObserver = g.IntersectionObserver as never;

  // React 19 checks this to decide whether act() warnings apply.
  g.IS_REACT_ACT_ENVIRONMENT = true;
}
