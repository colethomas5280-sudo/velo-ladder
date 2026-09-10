"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readLocal, subscribeLocal, writeLocal } from "@/lib/localStore";
import { todayISO } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * A prompt that shows once a day, per device
 *
 * "Every time we open the app" — but not every time a page renders. A coach
 * with a roster will have somebody due most mornings, and a modal that
 * reappears on every navigation is one you learn to dismiss without reading.
 * Then the day it matters, it gets dismissed too.
 *
 * So: it opens on the first visit of the day and stays gone once answered.
 * Dismissal is per device rather than stored on the athlete, because it is a
 * reading habit and not a fact about anybody.
 * ------------------------------------------------------------------ */

const KEY = "veloladder:retest-prompt";

function keyFor(scope: string) {
  return `${KEY}:${scope}`;
}

export function useDailyPrompt(scope: string): [boolean, () => void] {
  const dismissedOn = useSyncExternalStore(
    subscribeLocal,
    useCallback(() => readLocal(keyFor(scope)), [scope]),
    // The server has no storage, so it renders the prompt closed and lets the
    // client decide — a modal that flashes on every page load during
    // hydration is worse than one that appears a beat late.
    todayISO,
  );
  const dismiss = useCallback(
    () => writeLocal(keyFor(scope), todayISO()),
    [scope],
  );
  return [dismissedOn !== todayISO(), dismiss];
}
