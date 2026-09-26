// Stratum no longer uses a service worker: the earlier one answered every navigation from
// its cache, so returning visitors kept running an old build. This version replaces it in
// browsers that installed it, deletes its caches, unregisters itself and reloads open tabs.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
