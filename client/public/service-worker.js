// Shell service worker. Must NOT mediate workers/scripts under COEP:
// Safari blocks Worker() loads when a SW calls respondWith() for them,
// even when Cross-Origin-Resource-Policy is present on the network response.
const CACHE_NAME = "osrs-typescript-shell-v3";

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(["/index.html"]))
            .catch(() => {}),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k.startsWith("osrs-typescript-shell-") && k !== CACHE_NAME).map((k) => caches.delete(k))),
            )
            .then(() => self.clients.claim()),
    );
});

// Plugin notifications (RuneLite's Notifier) shown through the worker: a click brings the game back.
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((windows) => {
                const scope = self.registration.scope;
                const open = windows.find((client) => client.url.startsWith(scope) && "focus" in client);
                if (open) return open.focus();
                return self.clients.openWindow ? self.clients.openWindow(self.registration.scope) : undefined;
            })
            .catch(() => {}),
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const destination = event.request.destination;
    if (
        destination === "worker" ||
        destination === "script" ||
        destination === "sharedworker" ||
        destination === "audioworklet" ||
        destination === "paintworklet"
    ) {
        // Let the browser fetch directly so COEP/CORP checks see real response headers.
        return;
    }

    let url;
    try {
        url = new URL(event.request.url);
    } catch {
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith("/static/")) {
        return;
    }

    // Network-first navigations so COOP/COEP headers are not served from a stale shell cache.
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy)).catch(() => {});
                    return response;
                })
                .catch(() => caches.match("/index.html")),
        );
    }
});
