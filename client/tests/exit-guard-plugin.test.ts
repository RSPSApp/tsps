import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";
import {
    BackButtonGuard,
    EXIT_GUARD_STATE_KEY,
    type ExitGuardHistory,
    type ExitGuardHost,
} from "../game/plugins/exitguard/exitGuard";
import { ExitConfirmDialog } from "../game/plugins/exitguard/ExitConfirmDialog";
import { ExitGuardPlugin, type LeaveDialogView } from "../game/plugins/exitguard/ExitGuardPlugin";

assert.equal(ExitGuardPlugin.descriptor.name, "Exit Guard");
assert.equal(ExitGuardPlugin.descriptor.enabledByDefault, true, "protects players out of the box");
assert.equal(ExitGuardPlugin.descriptor.configKey, "exitguardplugin");
const registry = readFileSync(
    new URL("../runelite/client/plugins/index.ts", import.meta.url),
    "utf8",
);
assert.match(registry, /^\s+ExitGuardPlugin,$/m, "registered as a core plugin");

// --- The page, as far as the guard can see -----------------------------------------------------

/**
 * A history stack the test moves by hand. `behind` is how many entries sit before the game page,
 * so `0` models a tab opened on the game directly, where going back has nowhere to go.
 */
class FakeHistory implements ExitGuardHistory {
    readonly entries: unknown[];
    readonly goCalls: number[] = [];
    index: number;

    constructor(behind: number) {
        this.entries = Array.from({ length: behind + 1 }, (_, i) =>
            i === behind ? { routerKey: "page" } : { from: i },
        );
        this.index = this.entries.length - 1;
    }

    get state(): unknown {
        return this.entries[this.index];
    }

    pushState(data: unknown): void {
        this.entries.splice(this.index + 1);
        this.entries.push(data);
        this.index = this.entries.length - 1;
    }

    go(delta: number): void {
        this.goCalls.push(delta);
        const target = this.index + delta;
        // Outside the stack, a browser ignores the step rather than clamping it.
        if (target < 0 || target >= this.entries.length) return;
        this.index = target;
    }

    /** The back button: returns whether the page actually moved off its top entry. */
    pressBack(): boolean {
        const target = this.index - 1;
        if (target < 0) return false;
        this.index = target;
        return true;
    }

    hasSentinel(): boolean {
        const state = this.state as Record<string, unknown> | null;
        return state?.[EXIT_GUARD_STATE_KEY] === true;
    }
}

type FakeListener = (event: Event) => void;

class FakeHost implements ExitGuardHost {
    readonly history: FakeHistory;
    readonly listeners = new Map<string, Set<FakeListener>>();
    readonly deferred: Array<() => void> = [];
    readonly captureTypes = new Set<string>();
    closed = 0;
    visible = true;
    /** Whether closing is allowed here: a tab the player opened themselves cannot be closed. */
    closesWhenAsked = false;

    constructor(behind = 1) {
        this.history = new FakeHistory(behind);
    }

    addEventListener(type: string, listener: FakeListener, capture?: boolean): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
        if (capture) this.captureTypes.add(type);
    }

    removeEventListener(type: string, listener: FakeListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    close(): void {
        this.closed++;
        if (this.closesWhenAsked) this.visible = false;
    }

    isVisible(): boolean {
        return this.visible;
    }

    after(_delayMs: number, run: () => void): void {
        this.deferred.push(run);
    }

    dispatch(type: string, event: Event): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    }

    /** A back press, with the popstate a move brings. */
    pressBack(): void {
        if (this.history.pressBack()) this.dispatch("popstate", fakeEvent());
    }

    /** Runs what `after` deferred: the check on whether leaving actually worked. */
    flush(): void {
        for (const run of this.deferred.splice(0)) run();
    }

    listenerCount(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
}

type FakeEvent = {
    target: unknown;
    defaultPrevented: boolean;
    stoppedImmediate: boolean;
    preventDefault(): void;
    stopImmediatePropagation(): void;
};

function fakeEvent(target: unknown = null): FakeEvent {
    return {
        target,
        defaultPrevented: false,
        stoppedImmediate: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
            this.stoppedImmediate = true;
        },
    };
}

function fakeKey(key: string, target: unknown = null): KeyboardEvent {
    return Object.assign(fakeEvent(target), { key, type: "keydown" }) as unknown as KeyboardEvent;
}

/** The dialog, as the plugin drives it; a test presses its buttons by calling the guard. */
class FakeDialog implements LeaveDialogView {
    open = false;
    blocked = false;
    destroys = 0;
    /** The nodes this fake reports as its own, i.e. controls the browser should answer for. */
    readonly own: unknown[] = [];

    holds(target: EventTarget | Node | null): boolean {
        return this.own.includes(target);
    }

    show(blocked: boolean): void {
        this.open = true;
        this.blocked = blocked;
    }

    hide(): void {
        this.open = false;
    }

    destroy(): void {
        this.destroys++;
        this.open = false;
    }
}

type Harness = {
    plugin: ExitGuardPlugin;
    guard: BackButtonGuard;
    host: FakeHost;
    history: FakeHistory;
    dialog: FakeDialog;
    /** Whether the game would take a key press now, i.e. the modal filter's answer. */
    gameTakesInput: () => boolean;
    setSession: (inGame: boolean) => void;
    /** Whether a reload or tab close would raise the browser's own prompt. */
    unloadPrompts: () => boolean;
};

function setup(options: { inGame?: boolean; behind?: number } = {}): Harness {
    const host = new FakeHost(options.behind ?? 1);
    const dialog = new FakeDialog();
    const filters = new Set<(type: string, event: MouseEvent | KeyboardEvent) => boolean>();
    let session = options.inGame ?? false;
    const plugin = new ExitGuardPlugin(
        host,
        dialog,
        {
            addInputFilter: (filter) => {
                filters.add(filter);
                return () => {
                    filters.delete(filter);
                };
            },
        },
        () => session,
    );
    const guard = plugin.getGuard();
    assert.ok(guard, "a guard is built whenever there is a browser to guard");
    return {
        plugin,
        guard,
        host,
        history: host.history,
        dialog,
        gameTakesInput: () => ![...filters].some((filter) => filter("keyPressed", fakeKey("a"))),
        setSession: (value) => {
            session = value;
        },
        unloadPrompts: () => {
            const event = fakeEvent();
            host.dispatch("beforeunload", event as unknown as Event);
            return event.defaultPrevented;
        },
    };
}

// --- Arming: the guard keeps the first back press for itself -------------------------------------

test("arming puts one entry of its own on the stack and asks for nothing", async () => {
    const h = setup();
    await h.plugin.start();
    assert.equal(h.history.entries.length, 3, "what was behind, the page, and the guard's entry");
    assert.equal(h.history.index, 2, "the page sits on top of its own entry");
    assert.ok(h.history.hasSentinel());
    assert.equal(h.dialog.open, false, "arming is silent");
    assert.equal(h.host.listenerCount("popstate"), 1);
    assert.ok(
        h.host.captureTypes.has("keydown"),
        "keys are stopped ahead of the game's own listener",
    );
});

test("the guard's entry carries the page's own history state", async () => {
    const h = setup();
    await h.plugin.start();
    assert.equal(
        (h.history.state as Record<string, unknown>).routerKey,
        "page",
        "the router's keys survive",
    );
});

test("a back press opens the question instead of leaving the game", async () => {
    const h = setup();
    await h.plugin.start();
    h.host.pressBack();
    assert.equal(h.dialog.open, true);
    assert.equal(h.dialog.blocked, false);
    assert.ok(h.history.hasSentinel(), "the page is back on top of its own entry");
    assert.equal(h.history.entries.length, 3, "re-pushing keeps the stack the same length");
    assert.deepEqual(h.history.goCalls, [], "nothing navigated");
    assert.equal(h.gameTakesInput(), false, "a modal swallows keys and clicks");
});

test("pressing back twice in a row asks once, not twice", async () => {
    const h = setup();
    await h.plugin.start();
    h.host.pressBack();
    const stack = h.history.entries.length;
    h.host.pressBack();
    assert.equal(h.dialog.open, true);
    assert.equal(h.history.entries.length, stack, "the stack does not grow with every press");
});

// --- Stay ---------------------------------------------------------------------------------------

test("staying closes the question and asks again on the next press", async () => {
    const h = setup();
    await h.plugin.start();
    h.host.pressBack();
    h.guard.stay();
    assert.equal(h.dialog.open, false);
    assert.equal(h.guard.isArmed(), true);
    assert.equal(h.gameTakesInput(), true, "the game can hear the keyboard again");
    h.host.pressBack();
    assert.equal(h.dialog.open, true);
});

test("keys reach the dialog's buttons but nothing else of the game's", async () => {
    const h = setup();
    await h.plugin.start();
    const stayButton = { label: "Stay" };
    h.dialog.own.push(stayButton);
    h.host.pressBack();

    // Walking, typing or a menu Escape: the game must not hear any of it behind the question.
    const letter = fakeKey("w");
    h.host.dispatch("keydown", letter as unknown as Event);
    assert.ok(letter.defaultPrevented && letter.stoppedImmediate);
    assert.equal(h.dialog.open, true, "typing cannot answer the question");

    // Tab stays the browser's, so the buttons remain reachable without a mouse.
    const tab = fakeKey("Tab", stayButton);
    h.host.dispatch("keydown", tab as unknown as Event);
    assert.equal(tab.defaultPrevented, false);
    assert.equal(tab.stoppedImmediate, false);

    // Enter or Space on the button holding focus is that button's own activation.
    for (const key of ["Enter", " "]) {
        const event = fakeKey(key, stayButton);
        h.host.dispatch("keydown", event as unknown as Event);
        assert.equal(event.defaultPrevented, false, `${key} on a focused button`);
        assert.equal(h.dialog.open, true, `${key} on Stay is Stay's answer, not a guess`);
    }

    // Escape, and Enter with focus anywhere else, is the safe answer.
    for (const key of ["Escape", "Enter"]) {
        const event = fakeKey(key);
        h.host.dispatch("keydown", event as unknown as Event);
        assert.ok(event.defaultPrevented, `${key} is not the game's either`);
        assert.equal(h.dialog.open, false, `${key} keeps the player in the game`);
        h.host.pressBack();
    }
});

// --- Leave ----------------------------------------------------------------------------------------

test("leaving steps over the guard's own entry and silences the browser's prompt", async () => {
    const h = setup({ inGame: true });
    await h.plugin.start();
    assert.equal(h.unloadPrompts(), true, "losing a session to a reload is worth a prompt");
    h.host.pressBack();
    h.guard.leave();
    assert.equal(h.dialog.open, false);
    assert.deepEqual(h.history.goCalls, [-2], "past the guard's entry and the page behind it");
    assert.equal(h.history.index, 0, "which is the entry the browser would have left for");
    assert.equal(h.unloadPrompts(), false, "and the navigation it started must not prompt as well");
    h.host.visible = false; // the page went away
    h.host.flush();
    assert.equal(h.host.closed, 0, "nothing to close once the page is gone");
});

test("leaving from a tab with nothing behind it closes the tab", async () => {
    const h = setup({ behind: 0 });
    await h.plugin.start();
    h.host.pressBack();
    h.guard.leave();
    assert.deepEqual(h.history.goCalls, [-2]);
    assert.equal(h.history.index, 1, "there was nowhere to go, so the page stayed");
    h.host.closesWhenAsked = true;
    h.host.flush();
    assert.equal(h.host.closed, 1);
    assert.equal(h.dialog.open, false, "the tab closed, so there is nothing left to ask");
});

test("a browser that refused to let go asks again rather than stranding the player", async () => {
    const h = setup({ behind: 0 });
    await h.plugin.start();
    h.host.pressBack();
    h.guard.leave();
    h.host.flush(); // still on screen: nowhere to go back to, and closing was not allowed
    assert.equal(h.host.closed, 1);
    assert.equal(h.dialog.open, true);
    assert.equal(h.dialog.blocked, true, "the hint to close the tab by hand");
    assert.ok(h.history.hasSentinel(), "still holding the stack");
    assert.equal(h.guard.isArmed(), true);
    h.guard.stay();
    assert.equal(h.dialog.open, false);
});

// --- The browser's prompt on reload or tab close --------------------------------------------------

test("only a live session is worth the browser's own prompt", async () => {
    const h = setup({ inGame: false });
    await h.plugin.start();
    assert.equal(h.unloadPrompts(), false, "reloading the login screen is normal");
    h.setSession(true);
    assert.equal(h.unloadPrompts(), true);
    h.setSession(false);
    assert.equal(h.unloadPrompts(), false);
});

// --- Disarm: turning the plugin off gives the back button back ------------------------------------

test("stopping the plugin drops its entry and its listeners", async () => {
    const h = setup();
    await h.plugin.start();
    await h.plugin.stop();
    assert.deepEqual(h.history.goCalls, [-1], "the entry it added is removed");
    assert.equal(h.history.index, 1, "back to the page itself");
    assert.equal(h.host.listenerCount("popstate"), 0);
    assert.equal(h.host.listenerCount("beforeunload"), 0);
    assert.equal(h.host.listenerCount("keydown"), 0);
    assert.equal(h.dialog.destroys, 1);
    assert.equal(h.gameTakesInput(), true, "the input filter went with it");

    h.host.pressBack();
    assert.equal(h.dialog.open, false, "back leaves the game again");
    assert.deepEqual(h.history.goCalls, [-1], "and nothing is re-pushed");
});

test("arming or disarming twice changes nothing", async () => {
    const host = new FakeHost(0);
    const guard = new BackButtonGuard(host, {
        onDialog: () => {},
        shouldPromptOnUnload: () => false,
    });
    guard.arm();
    guard.arm();
    assert.equal(host.history.entries.length, 2);
    guard.disarm();
    guard.disarm();
    assert.equal(host.history.goCalls.length, 1);
    assert.equal(host.history.hasSentinel(), false);
    assert.equal(host.listenerCount("popstate"), 0);
    assert.equal(guard.isArmed(), false);
});

// --- The dialog's own DOM -------------------------------------------------------------------------

test("the dialog sits on the body and its buttons answer", async () => {
    const dom = new JSDOM("<canvas></canvas>", { url: "http://localhost/play" });
    const doc = dom.window.document;
    const asked: string[] = [];
    const dialog = new ExitConfirmDialog(
        { onStay: () => asked.push("stay"), onLeave: () => asked.push("leave") },
        doc,
    );

    dialog.show(false);
    const root = doc.querySelector(".exit-guard")!;
    assert.ok(doc.body.contains(root), "on the body, where hiding the game's UI cannot reach it");
    assert.equal(root.getAttribute("aria-modal"), "true");
    assert.equal(doc.activeElement, doc.querySelector(".exit-guard-stay"), "Enter means Stay");
    assert.equal(dialog.isOpen(), true);
    assert.ok(dialog.holds(doc.querySelector(".exit-guard-leave")));
    assert.equal(dialog.holds(doc.querySelector("canvas")), false);

    (doc.querySelector(".exit-guard-stay") as HTMLButtonElement).click();
    assert.deepEqual(asked, ["stay"], "Stay is a real button");

    // The backdrop answers it too: on a phone a small button must not be the only way to stay.
    root.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(asked, ["stay", "stay"]);

    dialog.hide();
    assert.equal(dialog.isOpen(), false);
    dialog.show(true);
    assert.match(
        doc.querySelector(".exit-guard-message")!.textContent!,
        /close its tab/i,
        "the blocked hint replaces the text",
    );
    (doc.querySelector(".exit-guard-leave") as HTMLButtonElement).click();
    assert.deepEqual(asked, ["stay", "stay", "leave"]);

    dialog.destroy();
    assert.equal(doc.querySelector(".exit-guard"), null);
    assert.equal(dialog.isOpen(), false);
});
