import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ClientState } from "../game/ClientState";
import { InputManager } from "../game/InputManager";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";

// The All Settings rows the browser client applies itself, from their vars.

const KEY_CTRL = 82;
const KEY_M = 70;

// Opcodes 1430/1431 and 2430/2431 set a component's key-down and key-up listeners: the minimap
// binds script 5141 (Ctrl+M) with 2430, and other interfaces follow Shift with the pair.
assert.equal(Opcodes.CC_SETONKEYDOWN, 1430);
assert.equal(Opcodes.CC_SETONKEYUP, 1431);
assert.equal(Opcodes.IF_SETONKEYDOWN, 2430);
assert.equal(Opcodes.IF_SETONKEYUP, 2431);

/** A visible component whose key-down and key-up listeners record the key code they get. */
function keyFrame(input: InputManager) {
    const script = new Script();
    script.id = 5141;
    script.instructions = Int32Array.from([Opcodes.RETURN]);
    script.intOperands = Int32Array.from([0]);
    script.stringOperands = [null];
    script.intArgCount = 1;
    script.localIntCount = 1;
    const manager: any = {
        rootInterface: 161, interfaceParents: new Map(), beginBatch() {}, endBatch() {},
        getWidgetByUid: () => undefined, isServerOwnedWidget: () => false,
        invalidateAll() {}, invalidateWidgetRender() {},
    };
    const vm = new Cs2Vm({ widgetManager: manager, loadScript: (id: number) => (id === script.id ? script : undefined) } as any);
    // Script 5141's first argument is event_keycode: record what the listener substitutes for it.
    const seen: number[] = [];
    const substitute = (vm as any).substituteMagicArgs.bind(vm);
    (vm as any).substituteMagicArgs = (...args: any[]) => {
        const result = substitute(...args);
        seen.push(result.intArgs[0]);
        return result;
    };
    const handler = { scriptId: script.id, intArgs: [-2147483640] };
    const minimap = { uid: (160 << 16) | 1, eventHandlers: { onKeyDown: handler, onKeyUp: { ...handler } } };
    const deps: any = {
        getCs2Vm: () => vm, getVarManager: () => ({ getVarbit: () => 0 }),
        getPendingInputDialogAction: () => null, getPendingTradeQuantityAction: () => null,
        getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false }),
    };
    const frame: any = { input, mx: 0, my: 0, allRoots: [minimap], visibleMap: new Map(), getStaticChildren: () => [] };
    return { run: () => processWidgetKeyboardInput(deps, frame, manager), seen, minimap, manager };
}

const press = (code: string, key: string, keyCode: number, extra: object = {}) =>
    ({ code, key, keyCode, repeat: false, preventDefault() {}, ...extra }) as KeyboardEvent;

// Ctrl+M: the key-down listener runs once per key, with the key's code as event_keycode, though
// "m" with Ctrl held types no character and reaches no onKey listener as a key code.
{
    const input = new InputManager();
    const { run, seen } = keyFrame(input);
    input.onKeyDown(press("ControlLeft", "Control", 17, { ctrlKey: true }));
    input.onKeyDown(press("KeyM", "m", 77, { ctrlKey: true }));
    assert.deepEqual(input.keyDownCodes, [KEY_CTRL, KEY_M]);
    run();
    assert.deepEqual(seen, [KEY_CTRL, KEY_M], "key-down listeners get each key pressed");
    (input as any).onKeyUp(press("KeyM", "m", 77));
    (input as any).onKeyUp(press("ControlLeft", "Control", 17));
    assert.deepEqual(input.keyUpCodes, [KEY_M, KEY_CTRL]);
    input.keyDownCodes.length = 0;
    seen.length = 0;
    run();
    assert.deepEqual(seen, [KEY_M, KEY_CTRL], "key-up listeners get each key released");
    input.flushInput();
    assert.deepEqual([input.keyDownCodes, input.keyUpCodes], [[], []]);
}

// A held key's auto-repeat doesn't run key-down listeners again; losing focus releases held keys.
{
    const input = new InputManager();
    input.onKeyDown(press("ControlLeft", "Control", 17, { ctrlKey: true }));
    input.onKeyDown(press("KeyM", "m", 77, { ctrlKey: true }));
    input.onKeyDown(press("KeyM", "m", 77, { ctrlKey: true, repeat: true }));
    assert.deepEqual(input.keyDownCodes, [KEY_CTRL, KEY_M]);
    (input as any).resetMouse = () => {};
    (input as any).onFocusOut();
    assert.deepEqual(input.keyUpCodes.sort((a, b) => a - b), [KEY_M, KEY_CTRL]);
}

// A plain "m" still reaches key-down listeners (onKey gets it as a typed character).
{
    const input = new InputManager();
    const { run, seen } = keyFrame(input);
    input.onKeyDown(press("KeyM", "m", 77));
    run();
    assert.deepEqual(seen, [KEY_M]);
}

// The construction build menu owns every key: no key-down listener runs while it is open.
{
    const input = new InputManager();
    const { run, seen, manager } = keyFrame(input);
    manager.rootInterface = 458;
    input.onKeyDown(press("KeyM", "m", 77, { ctrlKey: true }));
    input.keyEvents.length = 0; // the build menu's own handler took the key
    run();
    assert.deepEqual(seen, []);
}

// A hidden component's key listeners don't run.
{
    const input = new InputManager();
    const { run, seen, minimap } = keyFrame(input);
    (minimap as any).hidden = true;
    input.onKeyDown(press("KeyM", "m", 77));
    run();
    assert.deepEqual(seen, []);
}

async function main() {
    (globalThis as any).self = globalThis;
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");

    // Rows 48, 49 and 50 follow their vars as soon as they change (and at login).
    {
        const varbits = new Map<number, number>();
        let mouseButtons = 0;
        const client: any = Object.create(OsrsClient.prototype);
        client.inputManager = new InputManager();
        client.settings = { leftClickOpensMenu: false, tapToDrop: false };
        client.varManager = { getVarbit: (id: number) => varbits.get(id) ?? 0, getVarp: () => mouseButtons };
        client.applyControlSettingVars();
        assert.equal(client.inputManager.mouseCamEnabled, true, "the middle mouse turns the camera by default");
        assert.equal(ClientState.followerOpsLowPriority, false);
        client.inputManager.mouseWheelDown = true;
        varbits.set(4134, 1);
        varbits.set(5599, 1);
        mouseButtons = 1;
        client.applyControlSettingVars();
        assert.equal(client.inputManager.mouseCamEnabled, false, "mousecam_disabled turns it off");
        assert.equal(client.inputManager.mouseWheelDown, false, "a camera drag in progress stops");
        assert.equal(ClientState.followerOpsLowPriority, true, "followerops_deprioritised lowers follower options");
        assert.equal(client.settings.leftClickOpensMenu, true, "single mouse button mode opens the menu on a left click");
        varbits.clear();
        mouseButtons = 0;
        client.applyControlSettingVars();
        assert.equal(client.mouseCamEnabled, true);
        assert.equal(ClientState.followerOpsLowPriority, false);
        assert.equal(client.settings.leftClickOpensMenu, false, "the next account's varps replace the last one's");
    }

    // Row 54: the side-panel switch is told whether the open tab's own key closes it.
    {
        const runs: [number, number[]][] = [];
        const client: any = Object.create(OsrsClient.prototype);
        client.widgetManager = { rootInterface: 161 };
        client.varManager = { getVarcInt: () => 3, setVarcInt() {} };
        client.cs2Vm = {
            context: { loadScript: (id: number) => ({ id }) },
            run: (script: { id: number }, args: number[]) => runs.push([script.id, args]),
        };
        client.switchToTab(3);
        client.switchToTab(3, false, false);
        assert.equal(runs[0][0], 914, "a hotkey that may close its panel goes through the stock switch");
        assert.deepEqual(runs[0][1].slice(2), [3]);
        assert.equal(runs[1][0], 71, "one that may not calls the switch with closing off");
        assert.deepEqual([runs[1][1][1], runs[1][1][2]], [3, 0]);
        assert.equal(runs[1][1][0], runs[0][1][1], "both use the layout's display enum");
    }

    // Row 347: the in-game server list asks before switching while the confirmation is on.
    {
        let disableConfirmation = 0;
        const done: string[] = [];
        const here = { name: "Here", address: "here", secure: true, transport: "websocket" };
        const there = { name: "There", address: "there", secure: true, transport: "websocket" };
        let clicked: any;
        const client: any = Object.create(OsrsClient.prototype);
        client.loginRenderer = { serverList: [here, there], handleMouseClick: () => clicked };
        client.inputManager = { clickMode3: 1, saveClickX: 1, saveClickY: 1 };
        client.loginState = {
            serverTransport: "websocket", serverAddress: "here", serverSecure: true,
            serverListOpen: true, serverSwitchConfirm: null,
        };
        client.varManager = { getVarbit: (id: number) => (id === 4100 ? disableConfirmation : 0) };
        client.performLogout = (after: () => void) => { done.push("logout"); after(); };
        client.processLoginAction = (action: any) => done.push(`${action.type}${action.index ?? ""}`);
        const click = (action: any) => {
            clicked = action;
            Object.assign(client.inputManager, { clickMode3: 1, saveClickX: 1, saveClickY: 1 });
            client.handleInGameServerListInput();
        };

        click({ type: "select_server", index: 1 });
        assert.equal(client.loginState.serverSwitchConfirm, there, "the list asks first");
        assert.deepEqual(done, []);
        click({ type: "cancel_server_switch" });
        assert.equal(client.loginState.serverSwitchConfirm, null, "Cancel goes back to the list");
        assert.deepEqual(done, []);

        click({ type: "select_server", index: 1 });
        // A refresh while it asks puts the server elsewhere in a new list.
        client.loginRenderer.serverList = [{ ...there }, { name: "New", address: "new", secure: true, transport: "websocket" }, { ...here }];
        click({ type: "confirm_server_switch" });
        assert.deepEqual(done, ["logout", "select_server0"], "Switch world goes to the server it named");
        assert.equal(client.loginState.serverListOpen, false);

        done.length = 0;
        client.loginRenderer.serverList = [here, there];
        client.loginState.serverListOpen = true;
        disableConfirmation = 1;
        click({ type: "select_server", index: 1 });
        assert.equal(client.loginState.serverSwitchConfirm, null, "with the confirmation off it doesn't ask");
        assert.deepEqual(done, ["logout", "select_server1"]);

        done.length = 0;
        disableConfirmation = 0;
        click({ type: "select_server", index: 0 });
        assert.deepEqual(done, ["close_server_list"], "the current server just closes the list");
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
