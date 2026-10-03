import { strict as assert } from "node:assert";

import { decodeClientPacket } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { state } from "../network/serverConnection/state";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerChatOps } from "../rs/cs2/handlers/ChatOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { InputManager } from "../game/InputManager";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { setPacketSocket, flushPackets } from "../network/packet";
import { WidgetInputController } from "../game/widgets/WidgetInputController";

let sentPacket: Uint8Array | undefined;
(globalThis as any).WebSocket = { OPEN: 1 };
state.socket = {
    readyState: 1,
    send: (packet: Uint8Array) => {
        sentPacket = packet;
    },
} as any;

const handlers: HandlerMap = new Map();
registerChatOps(handlers);
const sendPublic = handlers.get(Opcodes.CHAT_SENDPUBLIC);
const sendClan = handlers.get(Opcodes.CHAT_SENDCLAN);
const sendPrivate = handlers.get(Opcodes.CHAT_SENDPRIVATE);
const setFilter = handlers.get(Opcodes.CHAT_SETFILTER);
assert.ok(sendPublic);
assert.ok(sendClan);
assert.ok(sendPrivate);
assert.ok(setFilter);

const clearedVarcs: Array<[number, string]> = [];
sendPublic(
    {
        stringStack: ["/hello channel"],
        stringStackSize: 1,
        intStack: Int32Array.from([2]),
        intStackSize: 1,
        varManager: {
            setVarcString: (id: number, value: string) => clearedVarcs.push([id, value]),
        },
    } as any,
    0,
    null,
);

assert.ok(sentPacket);
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket)), {
    type: "chat",
    text: "hello channel",
    messageType: "friends_chat",
});
assert.deepEqual(clearedVarcs, [[335, ""]]);

sentPacket = undefined;
sendPublic(
    {
        stringStack: ["hello public"],
        stringStackSize: 1,
        intStack: Int32Array.from([0]),
        intStackSize: 1,
        varManager: { setVarcString: () => {} },
    } as any,
    0,
    null,
);
assert.ok(sentPacket);
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket)), {
    type: "chat",
    text: "hello public",
    messageType: "public",
});

sentPacket = undefined;
sendClan(
    {
        stringStack: ["legacy channel must not use this opcode"],
        stringStackSize: 1,
        intStack: Int32Array.from([2, -1]),
        intStackSize: 2,
        varManager: { setVarcString: () => {} },
    } as any,
    0,
    null,
);
assert.equal(sentPacket, undefined);

sendPrivate(
    {
        stringStack: ["Alice", "Meet me in Lumbridge."],
        stringStackSize: 2,
    } as any,
    0,
    null,
);
assert.ok(sentPacket);
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket)), {
    type: "private_message",
    recipient: "Alice",
    text: "Meet me in Lumbridge.",
});

setFilter(
    {
        intStack: Int32Array.from([1, 2, 0]),
        intStackSize: 3,
    } as any,
    0,
    null,
);
assert.ok(sentPacket);
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket)), {
    type: "chat_filter",
    publicMode: 1,
    privateMode: 2,
    tradeMode: 0,
});

// Construction must accept raw keys even when a plugin consumes keyboard input,
// chat widgets are hidden, and a stale dialog/search still claims focus.
const input = new InputManager();
input.addKeyHandler({ onKeyDown: () => true });
const rawKey = (key: string, keyCode: number) => ({
    key, keyCode, code: key, preventDefault() {},
} as KeyboardEvent);
input.onKeyDown(rawKey("x", 88));
assert.equal(input.keyEvents.length, 0);
for (const [key, code] of [["h", 72], ["i", 73], [" ", 32], ["1", 49], ["!", 49], ["Backspace", 8]] as const) {
    input.onKeyDown(rawKey(key, code), true);
}
let buffer = "";
let closed = 0;
const inputVm = { inputDialogType: 3, inputDialogWidgetId: 458 << 16, inputDialogString: "old", deferIfClose: () => closed++ };
const keyboardDeps = {
    getVarManager: () => ({ getVarcString: () => buffer, setVarcString: (_id: number, text: string) => buffer = text }),
    getCs2Vm: () => inputVm,
    setPendingInputDialogAction: (action: unknown) => assert.equal(action, null),
    setPendingTradeQuantityAction: (action: unknown) => assert.equal(action, null),
    getCustomInterfaces: () => assert.fail("construction must not reach search input"),
    executeScriptListener: (_widget: unknown, listener: number[]) => assert.deepEqual(listener, [223], "only the chat redraw script may run"),
} as any;
const widgetManager = { rootInterface: 161, interfaceParents: new Map([[1, { group: 458, type: 0 }]]), findWidget: () => ({ hidden: true }) } as any;
const dispatch = () => {
    processWidgetKeyboardInput(keyboardDeps, { input } as any, widgetManager);
    input.keyEvents.length = 0;
};
dispatch();
assert.equal(buffer, "hi 1", "space must be inserted once, and Backspace must edit the standard buffer");
assert.equal(inputVm.inputDialogType, 0);
assert.equal(inputVm.inputDialogWidgetId, -1);
input.onKeyDown(rawKey("Enter", 13), true);
dispatch();
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket!)), { type: "chat", text: "hi 1", messageType: "public" });
assert.equal(buffer, "");
buffer = "/hello";
input.onKeyDown(rawKey("Enter", 13), true);
dispatch();
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket!)), { type: "chat", text: "hello", messageType: "friends_chat" });
buffer = "a".repeat(80);
input.onKeyDown(rawKey("b", 66), true);
dispatch();
assert.equal(buffer.length, 80);
widgetManager.rootInterface = 458;
widgetManager.interfaceParents.clear();
setPacketSocket(state.socket);
input.onKeyDown(rawKey("Escape", 27), true);
dispatch();
flushPackets();
assert.equal(closed, 1, "Escape must close a root build interface without the close-key varbit");
assert.deepEqual(decodeClientPacket(Buffer.from(sentPacket!)), { type: "interface_close" });

buffer = "";
const controller = new WidgetInputController({
    ...keyboardDeps, getInputManager: () => input, getWidgetManager: () => widgetManager,
    getWidgetInteraction: () => assert.fail("raw construction typing must not depend on UI picking"),
});
input.onKeyDown(rawKey("z", 90), true);
controller.handleConstructionKeyboardInput();
assert.equal(buffer, "z", "the raw key must reach the buffer immediately");
assert.equal(input.keyEvents.length, 0, "the frame dispatcher must not repeat raw input");
dispatch();
assert.equal(buffer, "z");

// Closing the build menu must restore the native onKey listener removed by
// cache script 2157, rather than relying on the construction-only fallback.
const chat: any = { uid: 162 << 16, hidden: false, onKey: null };
let chatLocked = 1;
let nativeKeys = 0;
const closeDeps: any = {
    ...keyboardDeps,
    getWidgetManager: () => widgetManager,
    getVarManager: () => ({ getVarbit: () => 0, setVarcInt: (id: number, value: number) => { assert.equal(id, 11); chatLocked = value; } }),
    getPendingInputDialogAction: () => null,
    getPendingTradeQuantityAction: () => null,
    getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false }),
    executeScriptListener: (_widget: unknown, listener: number[], event: any) => {
        if (listener[0] === 927) {
            assert.equal(listener[1], 1);
            chat.onKey = [73, -2147483640, -2147483639];
        } else if (listener[0] === 73) {
            nativeKeys++;
            buffer += String.fromCharCode(event.keyPressed);
        } else assert.deepEqual(listener, [223]);
    },
};
widgetManager.rootInterface = 161;
widgetManager.findWidget = () => chat;
const closeController = new WidgetInputController(closeDeps);
closeController.onInterfaceClosed(458);
assert.equal(chatLocked, 0);
assert.ok(chat.onKey);
assert.equal(buffer, "z", "closing must preserve the chat draft");
input.enqueueTypedChar("a".charCodeAt(0));
processWidgetKeyboardInput(closeDeps, {
    input, mx: 0, my: 0, allRoots: [chat], visibleMap: new Map(), getStaticChildren: () => [],
} as any, widgetManager);
input.keyEvents.length = 0;
assert.equal(nativeKeys, 1, "normal chat must receive the first key after close exactly once");
assert.equal(buffer, "za");
chat.onKey = null;
closeController.onInterfaceClosed(12);
assert.equal(chat.onKey, null, "closing unrelated dialogs must not override their focus");

setPacketSocket(null);
state.socket = null;
console.log("chat-channel-prefix.test.ts: all tests passed");
