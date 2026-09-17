"use client";

import { useEffect } from "react";

/** Registers the no-op-cache service worker PWA installability needs. Renders nothing. */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is a nice-to-have, not worth surfacing a failure for */
      });
    }
  }, []);
  return null;
}
