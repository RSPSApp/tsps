/** Called after the desktop game's cache and renderer have initialized. */
export async function notifyDesktopAppReady(): Promise<void> {
    if (typeof window === "undefined" || !window.__RSPS_DESKTOP_PROFILE__) return;
    try {
        await window.__TAURI__?.core.invoke("plugin:hot-update|notify_app_ready");
    } catch (error) {
        console.warn("Could not confirm client startup", error);
    }
}
