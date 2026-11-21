import type { ClientPlugin } from "../ClientPluginManager";

export class DesktopPlugin implements ClientPlugin {
    clientReady(signal: AbortSignal): void {
        // Let the initialized game reach a frame before accepting the bundle.
        requestAnimationFrame(() => {
            if (signal.aborted) return;
            void window.__TAURI__?.core.invoke("plugin:hot-update|notify_app_ready").catch(error => {
                console.warn("Could not confirm client startup", error);
            });
        });
    }
}
