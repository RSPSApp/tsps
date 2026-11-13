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
 * notifyOn*, Boosts, Regen Meter and Idle Notifier's *Notification. Thresholds, word lists and
 * colours do not count.
 */
const NOTIFICATION_KEY = /notif/i;
/**
 * Idle Notifier's animationidle / interactionidle / movementidle. Only in its own group: runtime
 * keys elsewhere can end in "idle" too (Bank Tags' icon_<tag> for a tag named "idle").
 */
const IDLE_NOTIFIER_GROUP = "idlenotifier";
const IDLE_KEY = /idle$/i;
/** A mode setting set to notify (Implings' per-impling "Notify"). */
const NOTIFY_VALUE = /^notify$/i;
/** Values that leave a notification setting off. */
const OFF_VALUES = new Set(["", "false", "off", "none", "0"]);

let permissionAsked = false;

/** True when this change turns a notification setting on. */
export function turnsNotificationOn(group: string, key: string, value: string | undefined): boolean {
    if (value === undefined || OFF_VALUES.has(value.toLowerCase())) return false;
    if (NOTIFY_VALUE.test(value) || NOTIFICATION_KEY.test(key)) return true;
    return group === IDLE_NOTIFIER_GROUP && IDLE_KEY.test(key);
}

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
 * It asks once: while the answer is "default", every matching change (each keystroke in a number
 * field) would otherwise prompt again, and Chrome blocks a site whose prompts keep being dismissed.
 * The next-click fallback (askPermissionOnNextClick) still asks once more.
 */
export function watchNotificationSettings(config: ConfigSource): () => void {
    let asked = false;
    return config.addListener((event) => {
        if (asked) return;
        if (!turnsNotificationOn(event.getGroup(), event.getKey(), event.getNewValue())) return;
        if (!canAskPermission() || !hasUserActivation()) return;
        // The next-click fallback stays armed: a dismissed prompt leaves the permission "default".
        asked = true;
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
