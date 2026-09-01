/**
 * Plumbing for reading localStorage through `useSyncExternalStore`.
 *
 * Restoring a saved preference used to be a `useState` + `useEffect` pair in
 * each component: render the default, then overwrite it on mount. That is the
 * standard workaround for the fact that localStorage does not exist during
 * server rendering, and it is what `useSyncExternalStore` replaces — it takes a
 * separate server snapshot, so the server and the hydrating render agree by
 * construction rather than by a second render.
 *
 * A tab's own writes do not fire `storage`, only other tabs' do, so writers
 * here notify local subscribers explicitly.
 */

const listeners = new Set<() => void>();

/** Subscribe contract for useSyncExternalStore. Client-only, as React guarantees. */
export function subscribeLocal(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** Storage is unavailable in private modes and with site data blocked. */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a preference that cannot be saved is not worth an error */
  }
  for (const fn of [...listeners]) fn();
}
