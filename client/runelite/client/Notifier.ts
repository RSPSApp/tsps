import type { ConfigChanged } from "@runelite/api/events";

/** Where RuneLite's Notifier sends a notification here: the game's chat and the browser. */
type NotifierClient = { addGameMessage(message: string): void };

/** The part of ConfigManager the permission prompt listens to. */
type ConfigSource = { addListener(listener: (event: ConfigChanged) => void): () => void };

/** ChatColorType.HIGHLIGHT for a console message (opaque chatbox). */
const HIGHLIGHT = "ff0000";
const APP_NAME = "RuneLite";
/**
 * Keys of settings that turn a notification on: Ground Items' notify*, Chat Notifications'
 * notifyOn*, Boosts, Regen Meter and Idle Notifier's *Notification, plus Idle Notifier's
 * animationidle / interactionidle / movementidle. Thresholds, word lists and colours do not count.
 */
const NOTIFICATION_KEY = /notif|idle$/i;
/** A mode setting set to notify (Implings' per-impling "Notify"). */
const NOTIFY_VALUE = /^notify$/i;
/** Values that leave a notification setting off. */
const OFF_VALUES = new Set(["", "false", "off", "none", "0"]);

let permissionAsked = false;

function canAskPermission(): boolean {
    return typeof window !== "undefined" && typeof Notification !== "undefined"
        && Notification.permission === "default";
}

function requestPermission(): void {
    try {
        void Notification.requestPermission()?.catch(() => {});
    } catch {}
}

/**
 * The browser asks for notification permission only after a user gesture, so it is asked on the
 * first click in the page after something first wants to notify.
 */
function askPermissionOnNextClick(): void {
    if (permissionAsked || !canAskPermission()) return;
    permissionAsked = true;
    window.addEventListener("pointerdown", requestPermission, { once: true, capture: true });
}

/** True while the page has a user gesture to spend (always true where the browser cannot say). */
function hasUserActivation(): boolean {
    const activation = typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    return activation === undefined || activation.isActive;
}

/**
 * Asks for notification permission on the click that turns a notification setting on, so the
 * prompt comes while the player is choosing notifications, not on a later unrelated click after
 * the first notification was already lost. A change from another tab (no gesture) is ignored.
 */
export function watchNotificationSettings(config: ConfigSource): () => void {
    return config.addListener((event) => {
        const value = event.getNewValue();
        if (value === undefined || OFF_VALUES.has(value.toLowerCase())) return;
        if (!NOTIFICATION_KEY.test(event.getKey()) && !NOTIFY_VALUE.test(value)) return;
        if (!canAskPermission() || !hasUserActivation()) return;
        // The next-click fallback stays armed: a dismissed prompt leaves the permission "default".
        requestPermission();
    });
}

/**
 * Shows the browser notification. Android Chrome refuses `new Notification()` and only shows one
 * through the service worker, so that is tried first; without a worker (dev builds, browsers
 * without one) the page's own Notification is used.
 */
async function show(message: string): Promise<void> {
    try {
        const registration = typeof navigator !== "undefined" && "serviceWorker" in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        if (registration) {
            await registration.showNotification(APP_NAME, { body: message });
            return;
        }
    } catch {}
    try {
        new Notification(APP_NAME, { body: message });
    } catch {}
}

/**
 * RuneLite's Notifier.notify: a highlighted game message, and (in place of the tray
 * notification) a browser notification while the game is hidden or unfocused, once allowed.
 */
export class Notifier {
    constructor(private readonly client: NotifierClient) {}

    notify(message: string): void {
        try {
            this.client.addGameMessage(`<col=${HIGHLIGHT}>${message}</col>`);
        } catch {}
        if (typeof Notification === "undefined" || typeof document === "undefined") return;
        if (Notification.permission === "default") {
            askPermissionOnNextClick();
            return;
        }
        // Another desktop window can take focus without making this page hidden.
        if (Notification.permission !== "granted" || (!document.hidden && document.hasFocus())) return;
        void show(message);
    }
}
