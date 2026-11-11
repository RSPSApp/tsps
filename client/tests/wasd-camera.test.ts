import assert from "node:assert/strict";

import { GameState } from "@runelite/api/GameState";
import { GameStateChanged, PluginMessage } from "@runelite/api/events";
import { CHATINPUT } from "@runelite/api/gameval/VarClientID";
import { InputManager } from "../game/InputManager";
import { CHAT_LINE_REDRAW_SCRIPT, WasdCamera, type WasdCameraClient } from "../game/input/WasdCamera";
import { ChatPastePlugin } from "../game/plugins/chatpaste/ChatPastePlugin";
import { WasdCameraPreference } from "../game/input/WasdCameraPreference";
import { AllSettingsToggle, CONTROLS_CATEGORY, ROW_HEIGHT, TOGGLE_OFF_SPRITE, TOGGLE_ON_SPRITE } from "../game/plugins/wasdcamera/AllSettingsToggle";
import { WASD_CAMERA_CHANNEL, WasdCameraPlugin } from "../game/plugins/wasdcamera/WasdCameraPlugin";
import { resetClientPreferencesCache } from "../game/preferences/ClientPreferences";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { runWidgetJsOp } from "../widgets/custom/dynamicWidgets";

// Settings > Controls > WASD Camera (RuneLite's Key Remapping, camera part): WASD turn the camera
// while the chat line is locked, Enter opens it, and sending (Enter) or leaving (Escape) a
// message locks it again.

const CHAT_LINE = (162 << 16) | 58;
const key = (code: string, name: string, keyCode: number) => ({
    code, key: name, keyCode, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    preventDefault() {}, getModifierState: () => false,
}) as unknown as KeyboardEvent;
const W = key("KeyW", "w", 87), A = key("KeyA", "a", 65), S = key("KeyS", "s", 83), D = key("KeyD", "d", 68);
const Q = key("KeyQ", "q", 81), ENTER = key("Enter", "Enter", 13), ESCAPE = key("Escape", "Escape", 27);
const typedW = [{ keyTyped: -1, keyPressed: 119, code: "KeyW" }];
const enter = [{ keyTyped: 84, keyPressed: 0, code: "Enter" }];

/** One press: the key events it queued and the keys left held. */
function press(input: InputManager, event: KeyboardEvent) {
    input.onKeyDown(event);
    const result = { events: input.keyEvents.splice(0), held: [...input.keys.keys()] };
    input.keyDownCodes.length = 0;
    return result;
}
/** One release: the key codes it released. */
function release(input: InputManager, event: KeyboardEvent): number[] {
    (input as any).onKeyUp(event);
    return input.keyUpCodes.splice(0);
}

/** A widget manager with the widgets it is given, for the dynamic children the toggle adds. */
function fakeWidgets(widgets: any[]) {
    const byUid = new Map(widgets.map((widget) => [widget.uid, widget]));
    const hidden = new Set<number>();
    const groups = new Map<number, { widgetsByUid: Map<number, any> }>();
    let nextUid = 1 << 30;
    return {
        rootInterface: 161, interfaceParents: new Map<number, { group: number; type: number }>(), hidden, groups,
        getGroup: (group: number) => groups.get(group),
        isEffectivelyHidden: (uid: number) => hidden.has(uid),
        getWidgetByUid: (uid: number) => byUid.get(uid),
        findWidget: (group: number, child: number) => byUid.get((group << 16) | child),
        allocateDynamicUid: () => nextUid++,
        registerWidget: (widget: any) => byUid.set(widget.uid, widget),
        unregisterWidgetTree: (widget: any) => byUid.delete(widget.uid),
        ensureLayout() {}, beforeScriptLayoutChange() {}, invalidateWidget() {}, invalidateWidgetRender() {},
        invalidateDynamicChildrenCache() {},
    } as any;
}

async function main() {
    const state = { enabled: true, loggedIn: true, prompt: false, elsewhere: false };
    const listeners = new Set<() => void>();
    const setting = {
        isEnabled: () => state.enabled,
        subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    };
    const varcs = new Map<number, string>();
    const scripts: number[][] = [];
    const line = { uid: CHAT_LINE, text: "" };
    const client = {
        inputManager: new InputManager(),
        isLoggedIn: () => state.loggedIn,
        isWidgetTextInputActive: () => state.prompt,
        followPlayerCamera: true,
        varManager: { setVarcString: (id: number, value: string) => varcs.set(id, value) },
        widgetManager: fakeWidgets([line, { uid: 162 << 16 }, { uid: (162 << 16) | 56 }, { uid: (162 << 16) | 57 }]),
        executeScriptListener: (_widget: unknown, listener: number[]) => {
            scripts.push(listener);
            // The chatbox's redraw writes the line from VarC 335, then tells the camera.
            if (listener[0] === CHAT_LINE_REDRAW_SCRIPT) {
                line.text = `wasdtester: <col=0000ff>${varcs.get(CHATINPUT) ?? ""}</col><col=0000ff>*</col>`;
                camera.chatLineRedrawn();
            }
        },
    } as unknown as WasdCameraClient;
    const input = client.inputManager;
    const camera = new WasdCamera(client, setting, () => state.elsewhere);
    const frame = () => input.onFrameEnd();

    assert.deepEqual(press(input, W).events, typedW, "not attached: W types into chat");
    release(input, W);
    camera.attach();
    frame();
    assert.equal(line.text, "wasdtester: Press Enter to Chat...", "the locked line says how to chat");

    // Locked: each of W, A, S and D is exactly its arrow key, which the chatbox doesn't type.
    for (const [wasd, arrow, keyCode] of [[W, "ArrowUp", 38], [A, "ArrowLeft", 37], [S, "ArrowDown", 40], [D, "ArrowRight", 39]] as const) {
        const alone = new InputManager();
        const expected = press(alone, key(arrow, arrow, keyCode));
        const released = release(alone, key(arrow, arrow, keyCode));
        const pressed = press(input, wasd);
        assert.deepEqual(pressed.events, expected.events.map((event) => ({ ...event, chatBlocked: true })), arrow);
        assert.deepEqual(pressed.held, [arrow], `${wasd.code} holds ${arrow}, which turns the camera`);
        assert.deepEqual(release(input, wasd), released);
        assert.deepEqual([...input.keys.keys()], [], `releasing ${wasd.code} releases ${arrow}`);
    }
    assert.deepEqual(press(input, Q).events, [{ keyTyped: -1, keyPressed: 113, code: "KeyQ", chatBlocked: true }],
        "other keys still reach dialogues and interfaces, not the chat line");
    release(input, Q);
    // WASD replaces the arrow keys: they turn nothing while it's on.
    const UP = key("ArrowUp", "ArrowUp", 38);
    assert.deepEqual(press(input, UP), { events: [], held: [] }, "the Up arrow doesn't turn the camera");
    assert.deepEqual(release(input, UP), []);
    // A paste (Chat Paste's Ctrl+V) doesn't slip into the locked line either.
    const paste = new ChatPastePlugin(input);
    const clipboard = (text: string) => ({ clipboardData: { getData: () => text }, target: null, preventDefault() {} }) as any;
    paste.paste(clipboard("hi"));
    assert.deepEqual(input.keyEvents.splice(0), [], "nothing is pasted under 'Press Enter to Chat...'");

    // Enter opens the chat line and goes no further; keys then type as normal.
    assert.deepEqual(press(input, ENTER).events, [], "the Enter that opens chat sends nothing");
    assert.deepEqual(release(input, ENTER), [], "nor its release");
    assert.equal(camera.chat.isTyping(), true);
    frame();
    assert.equal(line.text, "wasdtester: <col=0000ff></col><col=0000ff>*</col>", "the typed text shows");
    assert.deepEqual(press(input, W).events, typedW);
    release(input, W);
    assert.deepEqual(press(input, UP).held, [], "nor while typing");
    release(input, UP);
    paste.paste(clipboard("hi"));
    assert.deepEqual(input.keyEvents.splice(0).map((event) => event.keyPressed), [104, 105], "while typing, a paste types");
    // Enter sends the message (the chatbox gets it), then the line locks again.
    assert.deepEqual(press(input, ENTER).events, enter);
    release(input, ENTER);
    assert.equal(camera.chat.isTyping(), false);
    assert.deepEqual(press(input, W).held, ["ArrowUp"]);
    // Opening chat while W is held still releases the arrow key.
    press(input, ENTER);
    release(input, W);
    assert.deepEqual([...input.keys.keys()], []);
    release(input, ENTER);

    // Still typing: Escape leaves the message. It is cleared, the line locks, and nothing else
    // sees the Escape. Keys typed just before it may still be queued: it clears after them.
    varcs.set(CHATINPUT, "hello");
    assert.deepEqual(press(input, ESCAPE).events, [], "Escape closes no interface");
    release(input, ESCAPE);
    assert.equal(camera.chat.isTyping(), false);
    assert.equal(varcs.get(CHATINPUT), "hello");
    scripts.length = 0;
    frame();
    assert.equal(varcs.get(CHATINPUT), "");
    assert.deepEqual(scripts.splice(0), [[CHAT_LINE_REDRAW_SCRIPT]], "the chat line is redrawn once");
    assert.equal(line.text, "wasdtester: Press Enter to Chat...");
    frame();
    assert.deepEqual(scripts, []);

    // Prompts (an amount, a search), First Person or a RuneLite chatbox input, and the login
    // screen take keys as normal.
    for (const field of ["prompt", "elsewhere", "loggedIn"] as const) {
        state[field] = !state[field];
        assert.deepEqual(press(input, W).events, typedW, field);
        release(input, W);
        assert.deepEqual(press(input, ENTER).events, enter, field);
        release(input, ENTER);
        assert.equal(camera.chat.isTyping(), false, `${field}: Enter goes to it`);
        state[field] = !state[field];
    }

    // It never takes keys from anything else that listens for them: All Settings' search (134:12,
    // script 3876), a dialogue, or a prompt that hides the chat line (script 73 types nothing then).
    {
        const widgets = (client as any).widgetManager;
        const search = { uid: (134 << 16) | 12, eventHandlers: { onKey: { scriptId: 3876 } } };
        widgets.interfaceParents.set((161 << 16) | 16, { group: 134, type: 0 });
        widgets.groups.set(134, { widgetsByUid: new Map([[search.uid, search]]) });
        assert.deepEqual(press(input, W).events, typedW, "W types into All Settings' search");
        release(input, W);
        assert.deepEqual(press(input, ENTER).events, enter);
        release(input, ENTER);
        assert.equal(camera.chat.isTyping(), false);
        frame();
        assert.equal(line.text, "wasdtester: <col=0000ff></col><col=0000ff>*</col>", "the line doesn't say Press Enter to Chat then");
        widgets.hidden.add(search.uid);
        assert.deepEqual(press(input, W).held, ["ArrowUp"], "a hidden listener doesn't count");
        release(input, W);
        widgets.interfaceParents.clear();
        frame();
        assert.equal(line.text, "wasdtester: Press Enter to Chat...", "closing it gives the line back");
        widgets.hidden.add((162 << 16) | 57);
        assert.deepEqual(press(input, W).events, typedW, "the chat line hidden by a prompt");
        release(input, W);
        widgets.hidden.clear();
    }

    // Turning the setting off lets go of a held arrow key, and W types again.
    press(input, W);
    state.enabled = false;
    for (const listener of listeners) listener();
    assert.deepEqual([...input.keys.keys()], []);
    release(input, W);
    assert.deepEqual(press(input, W).events, typedW);
    release(input, W);
    assert.deepEqual(press(input, UP).held, ["ArrowUp"], "off: the arrow keys turn the camera again");
    release(input, UP);
    frame();
    assert.equal(line.text, "wasdtester: <col=0000ff></col><col=0000ff>*</col>", "off: the line is the game's");
    state.enabled = true;
    for (const listener of listeners) listener();
    camera.detach();
    assert.equal(input.keyRemapper, undefined);
    assert.deepEqual(press(input, W).events, typedW, "detached");
    release(input, W);

    // The chatbox's typing listener (162:0, script 73) skips a blocked key; a dialogue's doesn't.
    {
        const calls: number[] = [];
        const deps: any = {
            getCs2Vm: () => ({ inputDialogType: 0, invokeEventHandler: (w: { uid: number }) => calls.push(w.uid) }),
            getVarManager: () => ({ getVarbit: () => 0 }),
            getPendingInputDialogAction: () => null, getPendingTradeQuantityAction: () => null,
            getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false }),
        };
        const chatbox = { uid: 162 << 16, eventHandlers: { onKey: { scriptId: 73 } } };
        const options = { uid: (219 << 16) | 1, eventHandlers: { onKey: { scriptId: 2153 } } };
        const manager: any = { rootInterface: 161, interfaceParents: new Map(), isEffectivelyHidden: () => false };
        const frameInput = new InputManager();
        const widgetFrame: any = { input: frameInput, mx: 0, my: 0, allRoots: [chatbox, options], visibleMap: new Map(), getStaticChildren: () => [] };
        frameInput.keyEvents.push({ keyTyped: -1, keyPressed: 49, code: "Digit1", chatBlocked: true });
        processWidgetKeyboardInput(deps, widgetFrame, manager);
        assert.deepEqual(calls.splice(0), [options.uid]);
        frameInput.keyEvents.splice(0, 1, { keyTyped: -1, keyPressed: 49, code: "Digit1" });
        processWidgetKeyboardInput(deps, widgetFrame, manager);
        assert.deepEqual(calls, [chatbox.uid, options.uid]);
    }

    // All Settings > Controls: the row goes after the category's last row, drawn like the rows the
    // cache built (copied from one of them), and the list scrolls far enough to show it.
    {
        const settings = (child: number) => (134 << 16) | child;
        const hover = (transparency: number) => ({ scriptId: 244, intArgs: [settings(19), -2147483643, transparency, -1] });
        const nativeRow = (top: number) => [
            { uid: 1 + top, type: 3, rawX: 0, rawY: top, rawWidth: 10, rawHeight: 40, xPositionMode: 1, widthMode: 1, color: 0, filled: true,
                transparency: 200, eventHandlers: { onMouseOver: hover(240), onMouseLeave: hover(200) } },
            { uid: 2 + top, type: 4, rawX: 10, rawY: top + 6, rawWidth: 45, rawHeight: 14, widthMode: 1, fontId: 496, textColor: 0xff981f, text: "World Map Hotkey" },
            { uid: 3 + top, type: 5, rawX: 10, rawY: top + 11, rawWidth: 18, rawHeight: 18, xPositionMode: 2, spriteId: TOGGLE_ON_SPRITE },
            { uid: 4 + top, type: 4, rawX: 10, rawY: top + 20, rawWidth: 45, rawHeight: 14, widthMode: 1, fontId: 495, textColor: 0x9f9f9f, text: "Allows the world map..." },
        ];
        const rows: any = { uid: settings(19), children: [...nativeRow(29), ...nativeRow(1217)] };
        const clicks: any = { uid: settings(20), children: [{ uid: 9, rawY: 29 }, { uid: 10, rawY: 1217 }] };
        const scroll: any = { uid: settings(14), scrollHeight: 1262, scrollY: 0 };
        const widgets = fakeWidgets([rows, clicks, scroll, { uid: settings(21) }]);
        const vars = { varbits: new Map<number, number>([[9656, CONTROLS_CATEGORY]]), search: "" };
        const paneScripts: unknown[][] = [];
        const pane = {
            widgetManager: widgets, executeScriptListener: (_w: unknown, listener: unknown[]) => paneScripts.push(listener),
            varManager: { getVarbit: (id: number) => vars.varbits.get(id) ?? 0, getVarcString: () => vars.search },
        };
        const preference = { enabled: false, isEnabled() { return this.enabled; }, setEnabled(on: boolean) { this.enabled = on; } };
        const toggle = new AllSettingsToggle(pane, preference);
        toggle.sync();
        const [background, name, sprite, description] = rows.children.slice(8);
        const click = clicks.children[2];
        assert.deepEqual([background.rawY, background.rawHeight, click.rawY, click.rawHeight], [1257, ROW_HEIGHT, 1257, ROW_HEIGHT], "after the last row");
        assert.deepEqual([name.text, name.fontId, name.rawY, description.fontId, description.rawY], ["WASD Camera", 496, 1263, 495, 1277]);
        assert.deepEqual([sprite.spriteId, sprite.rawY, sprite.xPositionMode], [TOGGLE_OFF_SPRITE, 1257 + (ROW_HEIGHT - 18) / 2, 2], "off by default, on the right");
        assert.deepEqual(background.eventHandlers.onMouseOver, hover(240), "it lightens on hover as the others do");
        assert.deepEqual([click.actions[0], click.transparency], ["Toggle", 255]);
        assert.equal(scroll.scrollHeight, 1257 + ROW_HEIGHT + 5, "the list scrolls to it");
        assert.deepEqual(paneScripts.splice(0), [[72, settings(21), settings(14), 0]], "and the scrollbar resizes");
        toggle.sync();
        assert.equal(rows.children.length, 12, "added once");
        assert.equal(runWidgetJsOp({ widget: click, opIndex: 0 }), true);
        assert.deepEqual([preference.enabled, sprite.spriteId, paneScripts.splice(0)], [true, TOGGLE_ON_SPRITE, [[3945]]], "the click is the client's: nothing is sent");
        // The cache rebuilds the list (a category, a search, a setting changed): the row comes back.
        rows.children = rows.children.slice(0, 4);
        clicks.children = clicks.children.slice(0, 1);
        toggle.sync();
        assert.deepEqual([rows.children.length, rows.children[4].rawY, rows.children[6].spriteId], [8, 69, TOGGLE_ON_SPRITE]);
        // Another category, or a search for something else: no row.
        vars.varbits.set(9656, 4);
        toggle.sync();
        assert.deepEqual([rows.children.length, clicks.children.length], [4, 1]);
        vars.varbits.set(16073, 1);
        vars.search = "zoom";
        toggle.sync();
        assert.equal(rows.children.length, 4);
        // A search for it finds it, even with no other row to copy from.
        vars.search = "WASD";
        rows.children = [{ uid: 77, type: 4, rawY: 10, rawHeight: 20, y: 10, height: 233, text: "<br><br>Could not find any settings" }];
        toggle.sync();
        assert.deepEqual([rows.children.length, rows.children[1].rawY, rows.children[2].text, rows.children[2].fontId], [5, 5, "WASD Camera", 496]);
        assert.equal(rows.children[0].hidden, true, "it is the result, so the cache's 'Could not find' text goes");
        widgets.hidden.add(settings(19));
        toggle.sync();
        assert.equal(rows.children.length, 1, "closing All Settings takes it out");
    }

    // The switch is kept in the client preferences, off in a new browser.
    {
        const stored = new Map<string, string>();
        (globalThis as any).window = { localStorage: {
            getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v),
            removeItem: (k: string) => void stored.delete(k),
        } };
        resetClientPreferencesCache();
        const first = new WasdCameraPreference();
        assert.equal(first.isEnabled(), false);
        let heard = 0;
        first.subscribe(() => heard++);
        first.setEnabled(true);
        first.setEnabled(true);
        assert.equal(heard, 1);
        resetClientPreferencesCache();
        assert.equal(new WasdCameraPreference().isEnabled(), true, "on after a reload");
        delete (globalThis as any).window;
        resetClientPreferencesCache();
    }

    // The client plugin hosting it is hidden from the plugin list and always running. WASD works
    // only once the world's server offers it at login (its WasdCamera plugin), and the player has
    // turned it on.
    {
        assert.equal(WasdCameraPlugin.descriptor.hidden, true);
        assert.notEqual(WasdCameraPlugin.descriptor.enabledByDefault, false);
        let on = true;
        const preference = { isEnabled: () => on, setEnabled: (value: boolean) => void (on = value), subscribe: () => () => {} } as any;
        const plugin = new WasdCameraPlugin({
            client, preference,
            pluginManager: { getPlugin: () => undefined } as any, chatbox: { getCurrentInput: () => undefined } as any,
        });
        await plugin.start();
        assert.equal(input.keyRemapper, plugin.camera);
        assert.equal(plugin.isEnabled(), false, "not offered by this world yet");
        assert.deepEqual(press(input, W).events, typedW);
        release(input, W);
        plugin.onPluginMessage(new PluginMessage("other", { available: true }));
        assert.equal(plugin.isAvailable(), false);
        plugin.onPluginMessage(new PluginMessage(WASD_CAMERA_CHANNEL, { available: true }));
        assert.equal(plugin.isEnabled(), true);
        assert.deepEqual(press(input, W).held, ["ArrowUp"]);
        release(input, W);
        line.text = "wasdtester: *";
        plugin.onScriptFinished(CHAT_LINE_REDRAW_SCRIPT);
        assert.equal(line.text, "wasdtester: Press Enter to Chat...");
        on = false;
        assert.equal(plugin.isEnabled(), false, "the player's choice still counts");
        on = true;
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
        assert.equal(plugin.isAvailable(), false, "the next world has to offer it again");
        assert.deepEqual(press(input, W).events, typedW);
        release(input, W);
        await plugin.stop();
        assert.equal(input.keyRemapper, undefined);
    }

    console.log("wasd camera ok");
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
