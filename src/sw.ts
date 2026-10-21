/// <reference lib="webworker" />

/**
 * Omnivex Academy service worker.
 * - Precaches the build manifest emitted by vite-plugin-pwa (injectManifest).
 * - Serves navigations network-first with an offline fallback.
 * - Serves hashed static assets cache-first.
 * - Never touches /api, /media, or /socket.io (auth-protected, must stay fresh).
 * - Displays web-push notifications and focuses the app on click.
 */

export {};

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST?: Array<{ url: string; revision: string | null }>;
};

const CACHE = "omnivex-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const entries = self.__WB_MANIFEST || [];
      await Promise.all(
        entries.map((e) => cache.add(e.url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.startsWith("/socket.io")
  ) {
    return; // let the network handle authenticated traffic
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          void cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const shell = await caches.match("/index.html");
          return (
            shell ||
            new Response("<h1>You're offline</h1>", {
              status: 503,
              headers: { "Content-Type": "text/html" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first, refreshed in the background.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          void cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});

type PushData = { title?: string; body?: string; link?: string; tag?: string };

self.addEventListener("push", (event) => {
  let data: PushData = {
    title: "Omnivex Academy",
    body: "You have a new notification",
    link: "/app/notifications",
  };
  try {
    data = { ...data, ...(event.data?.json() as PushData) };
  } catch {
    const text = event.data?.text();
    if (text) data.body = text;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Omnivex Academy", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { link: data.link || "/app/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link =
    (event.notification.data as { link?: string } | null)?.link ||
    "/app/notifications";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          void client.navigate(link);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
