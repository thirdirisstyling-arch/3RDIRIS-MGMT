/* Offline support. Network first, so a new version is picked up as soon as it's online;
   the cached copy is only used when the network can't be reached. Only this site's own
   files are handled — GitHub sync and Google Fonts go straight to the network. */
const CACHE = "3rd-iris-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // an offline visit to any page of the app gets the app itself
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html") || await cache.match("./");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
