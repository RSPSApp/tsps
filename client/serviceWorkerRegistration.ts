const serviceWorkerBase =
    typeof process !== "undefined" && process.env ? process.env.PUBLIC_URL : "";
// The host caches JS for a year; change the URL when updating the shell worker.
const SERVICE_WORKER_URL = `${serviceWorkerBase ?? ""}/service-worker.js?v=5`;

export function registerServiceWorker(): void {
    const isProd = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
    if (!isProd) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register(SERVICE_WORKER_URL)
            .then((registration) => registration.update())
            .catch((err) => {
                console.warn("[sw] registration failed", err);
            });
    });
}

export function unregisterServiceWorker(): void {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((registration) => registration.unregister()).catch(() => {});
}
