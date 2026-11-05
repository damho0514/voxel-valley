// Offline support: game files are cached on first visit so the home-screen
// app opens without a connection. Each build gets its own cache.
const CACHE = "voxel-valley-0.1.0-20261105151955";
const CORE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "Build/WebGL.loader.js",
  "Build/WebGL.framework.js.unityweb",
  "Build/WebGL.data.unityweb",
  "Build/WebGL.wasm.unityweb",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("voxel-valley-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return; // online services pass through
  if (req.mode === "navigate") {
    // Page: try the network first so updates arrive, fall back to the cached copy offline.
    e.respondWith(fetch(req).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone(); // clone before the page reads the body
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
