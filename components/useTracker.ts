"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readLocal, subscribeLocal, writeLocal } from "@/lib/localStore";
import type { TrackerId } from "@/lib/types";

/**
 * Which tracker the coach last had open, remembered across visits.
 *
 * Shared because the athlete page and the group-session page have to agree:
 * they previously each declared this key and this restore logic separately,
 * which is two places for one decision to drift.
 */
const TRACKER_KEY = "veloladder:tracker";

function getSnapshot(): TrackerId {
  return readLocal(TRACKER_KEY) === "pulldown" ? "pulldown" : "mound";
}

/** The server has no stored preference, so it renders the default. */
function getServerSnapshot(): TrackerId {
  return "mound";
}

export function useTracker(): [TrackerId, (t: TrackerId) => void] {
  // Safe to return a fresh value each call: TrackerId is a string, so React
  // compares snapshots by value and never sees a spurious change.
  const tracker = useSyncExternalStore(
    subscribeLocal,
    getSnapshot,
    getServerSnapshot,
  );
  const setTracker = useCallback((t: TrackerId) => writeLocal(TRACKER_KEY, t), []);
  return [tracker, setTracker];
}
