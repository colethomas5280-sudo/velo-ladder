/*
 * Network-first passthrough. This app is live coach/athlete data — a
 * cached-stale dashboard would be worse than no offline support — so this
 * doesn't cache anything. It exists to satisfy PWA installability criteria
 * that expect a registered service worker with a fetch handler.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
