import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier, turnsNotificationOn, watchNotificationSettings } from "@runelite/client/Notifier";
import { GroundItemsConfig } from "../game/plugins/grounditems/GroundItemsConfig";
import { ChatNotificationsConfig } from "../game/plugins/chatnotifications/ChatNotificationsConfig";
import { IdleNotifierConfig } from "../game/plugins/idlenotifier/IdleNotifierConfig";
import { ImplingsConfig } from "../game/plugins/implings/ImplingsConfig";

// --- Browser fakes: Notification, window, document, navigator ----------------------------------
const shown: string[] = [];
let permission: NotificationPermission = "default";
let permissionRequests = 0;
let constructorThrows = false;
class FakeNotification {
    static get permission(): NotificationPermission {
        return permission;
    }
    static requestPermission(): Promise<NotificationPermission> {
        permissionRequests++;
        return Promise.resolve(permission);
    }
    constructor(title: string, options: { body: string }) {
        if (constructorThrows) throw new TypeError("Illegal constructor");
        shown.push(`page:${title}:${options.body}`);
    }
}
const clickListeners: Array<() => void> = [];
const fakeWindow = {
    addEventListener(type: string, listener: () => void) {
        if (type === "pointerdown") clickListeners.push(listener);
    },
    removeEventListener() {},
};
const fakeDocument = { hidden: true, focused: true, hasFocus() { return this.focused; } };
let userActive = true;
let registration: { showNotification(title: string, options: { body: string }): Promise<void> } | undefined;
const fakeNavigator = {
    userActivation: { get isActive() { return userActive; } },
    serviceWorker: { getRegistration: () => Promise.resolve(registration) },
};
for (const [name, value] of Object.entries({
    Notification: FakeNotification, window: fakeWindow, document: fakeDocument, navigator: fakeNavigator,
})) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const values = new Map<string, string>();
const storage = {
    get length() { return values.size; },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
};
const config = new ConfigManager(undefined, storage);
const stop = watchNotificationSettings(config);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- Permission: asked on the click that turns a notification setting on ------------------------
config.setConfigValue(GroundItemsConfig, "highlightTiles", true);
config.setConfigValue(ImplingsConfig, "showName", true);
config.setConfigValue(ImplingsConfig, "showBaby", "HIGHLIGHT");
config.setConfigValue(ChatNotificationsConfig, "highlightWordsString", "dragon");
config.setConfigValue(ChatNotificationsConfig, "highlightOwnName", false);
config.setConfigValue(ChatNotificationsConfig, "highlightOwnName", true);
config.setConfigValue(IdleNotifierConfig, "getHitpointsThreshold", 20);
config.setConfigValue(IdleNotifierConfig, "getIdleNotificationDelay", 3000);
assert.equal(permissionRequests, 0, "a setting that is not about notifications does not ask");

config.setConfigValue(GroundItemsConfig, "notifyTier", "OFF");
config.setConfigValue(GroundItemsConfig, "notifyHighlightedDrops", false);
assert.equal(permissionRequests, 0, "leaving a notify setting off does not ask");

userActive = false;
config.setConfigValue(GroundItemsConfig, "notifyHighlightedDrops", true);
assert.equal(permissionRequests, 0, "a change without a click (another tab) does not ask");
config.setConfigValue(GroundItemsConfig, "notifyHighlightedDrops", false);
userActive = true;

// A runtime key that happens to end in "idle" is not Idle Notifier's: Bank Tags' icon for a tag named "idle".
config.setConfiguration("banktags", "icon_idle", "995");
assert.equal(permissionRequests, 0, "banktags.icon_idle is not a notification setting");

config.setConfigValue(GroundItemsConfig, "notifyHighlightedDrops", true);
assert.equal(permissionRequests, 1, "turning on Notify for highlighted drops asks");
config.setConfigValue(GroundItemsConfig, "notifyTier", "HIGH");
config.setConfigValue(IdleNotifierConfig, "animationIdle", true);
config.setConfigValue(ImplingsConfig, "showBaby", "NOTIFY");
for (const ms of ["1", "10", "100"]) config.setConfiguration("idlenotifier", "hitpointsNotification", ms);
assert.equal(permissionRequests, 1, "while the answer is still pending, later notification settings do not ask again");

// Which changes count (the listener's own test, now that it asks only once).
assert.equal(turnsNotificationOn("idlenotifier", "animationidle", "true"), true, "Idle Notifier's idle toggles count");
assert.equal(turnsNotificationOn("idlenotifier", "movementidle", "true"), true);
assert.equal(turnsNotificationOn("banktags", "icon_idle", "995"), false, "another group's ...idle key does not");
assert.equal(turnsNotificationOn("grounditems", "notifyTier", "HIGH"), true, "a notify tier counts");
assert.equal(turnsNotificationOn("implings", "showBaby", "NOTIFY"), true, "an impling set to Notify counts");
assert.equal(turnsNotificationOn("implings", "showBaby", "NONE"), false, "an impling set to None does not");
assert.equal(turnsNotificationOn("grounditems", "notifyTier", "OFF"), false, "a notify setting left off does not");

permission = "granted";
config.setConfigValue(GroundItemsConfig, "notifyTier", "INSANE");
permission = "denied";
config.setConfigValue(GroundItemsConfig, "notifyTier", "MEDIUM");
assert.equal(permissionRequests, 1, "no prompt once the player has answered");

// --- notify(): chat line, then the browser notification -----------------------------------------
async function notifyCases(): Promise<void> {
    const chat: string[] = [];
    const notifier = new Notifier({ addGameMessage: (message) => chat.push(message) });

    notifier.notify("denied");
    await flush();
    assert.deepEqual(chat, ["<col=ff0000>denied</col>"], "the chat line is written whatever the permission");
    assert.deepEqual(shown, [], "no browser notification when denied");

    permission = "default";
    notifier.notify("first");
    await flush();
    assert.deepEqual(shown, []);
    assert.equal(clickListeners.length, 1, "the fallback still asks on the next click");
    clickListeners[0]();
    assert.equal(permissionRequests, 2, "the next-click fallback asks");

    permission = "granted";
    fakeDocument.hidden = false;
    notifier.notify("visible");
    await flush();
    assert.deepEqual(shown, [], "no browser notification while the game is on screen");

    fakeDocument.hidden = true;
    notifier.notify("no worker");
    await flush();
    assert.deepEqual(shown, ["page:RuneLite:no worker"], "without a service worker the page's Notification is used");

    registration = {
        showNotification: (title, options) => {
            shown.push(`worker:${title}:${options.body}`);
            return Promise.resolve();
        },
    };
    constructorThrows = true;
    notifier.notify("android");
    await flush();
    assert.deepEqual(shown.slice(1), ["worker:RuneLite:android"], "the service worker shows it (Android refuses new Notification)");

    registration = { showNotification: () => Promise.reject(new TypeError("no permission in worker")) };
    constructorThrows = false;
    notifier.notify("worker failed");
    await flush();
    assert.deepEqual(shown.slice(2), ["page:RuneLite:worker failed"], "a failing worker falls back to the page");

    fakeDocument.hidden = false;
    fakeDocument.focused = false;
    registration = { showNotification: (title, options) => {
        shown.push(`worker:${title}:${options.body}`);
        return Promise.resolve();
    } };
    notifier.notify("visible but unfocused");
    await flush();
    assert.equal(shown.at(-1), "worker:RuneLite:visible but unfocused",
        "another desktop window can have focus without hiding the game");
    fakeDocument.focused = true;
    const count = shown.length;
    notifier.notify("playing in the focused game");
    await flush();
    assert.equal(shown.length, count, "the visible focused game still suppresses popups");

    stop();
    permission = "default";
    // A fresh watcher has not asked yet; stopped, it still says nothing.
    const stopFresh = watchNotificationSettings(config);
    stopFresh();
    config.setConfigValue(GroundItemsConfig, "notifyTier", "LOW");
    assert.equal(permissionRequests, 2, "the returned function stops listening");
    const fresh = watchNotificationSettings(config);
    config.setConfigValue(GroundItemsConfig, "notifyTier", "HIGH");
    assert.equal(permissionRequests, 3, "a listening watcher that has not asked yet does ask");
    fresh();

    console.log("notifier: ok");
}

notifyCases().catch((error) => {
    console.error(error);
    process.exit(1);
});
