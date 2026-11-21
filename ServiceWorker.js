// Retired: the old Unity web build registered offline workers here (sw.js from the custom template,
// ServiceWorker.js from Unity's default PWA template). Both names now serve this file, which clears
// that build's caches, removes itself and reloads open pages, so returning visitors get the current game.
// Only the old build's caches are touched; other sites on this origin keep theirs.
const OLD = [/^voxel-valley-/, /^damho0514-Voxel Valley/, /^UnityCache_damho0514_Voxel Valley/];
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (OLD.some((r) => r.test(k))) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
