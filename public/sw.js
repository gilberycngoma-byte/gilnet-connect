const CACHE_NAME = "gilnet-shell-v2.5.0-offline-2";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icon-512.png",
  "/gilnet-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/precache-manifest.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the offline asset manifest.");
      const assets = await response.json();
      if (!Array.isArray(assets) || assets.some((asset) => typeof asset !== "string" || !asset.startsWith("/assets/"))) {
        throw new Error("The offline asset manifest is invalid.");
      }
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([...APP_SHELL, ...assets]);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("gilnet-shell-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match("/");
        if (shell) return shell;
        throw new Error("The GILNET app shell is not cached for offline use.");
      }),
    );
    return;
  }

  if (!url.pathname.startsWith("/assets/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
