import assert from "node:assert/strict";

import {
    decodeClientPacket,
    encodeWidgetSetFlagsRangeV2,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { flushPackets, setPacketSocket } from "../network/packet";
import { sendWidgetAction } from "../network/serverConnection/outgoing/widgets";
import { PlayerDesignController } from "../game/widgets/PlayerDesignController";
import { PlayerAppearance, Gender } from "../rs/config/player/PlayerAppearance";
import { state } from "../network/serverConnection/state";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { Inventory } from "../rs/inventory/Inventory";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

// The real client keeps ops 1-32. The cache's ~bankmain_drawitem sets op 11 "Examine" on every
// bank item, and live OSRS (rsprox, rev 239) enables it with IF_SETEVENTS_V2's op mask
// (events=[OP1..OP11, DEPTH2, DRAGTARGET, TARGET]) and sends a click as IF_BUTTONX op=11.
const BANK = 12;
const ITEMS = (BANK << 16) | 12;
const WHIP = 4151;

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
manager.rootInterface = 161;
const bank = new Inventory(1410);
bank.setSlot(0, WHIP, 1);
vm.context.inventories = new Map([[95, bank], [93, new Inventory(28)]]);
manager.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 500000);
manager.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");
for (const root of manager.getAllGroupRoots(BANK)) manager.triggerOnLoad(root);

const whip = manager.getWidgetByUid(ITEMS).children[0];
assert.equal(whip.itemId, WHIP, "the real bank scripts draw the whip in slot 0");
assert.equal(whip.actions[10], "Examine", "~bankmain_drawitem's op 11 is kept");

const menu = () =>
    deriveMenuEntriesForWidget(whip, false, (w) => manager.getWidgetFlags(w), undefined, (w) => manager.getWidgetOpMask(w));
const examine = () => menu().find((entry) => entry.option === "Examine");

// Bank.ITEM_SLOT_FLAGS sent the old way: transmit bits 1-10 only.
const flags = 0x7fe | (2 << 17) | (1 << 20) | (1 << 21);
manager.setWidgetFlagsByKey(ITEMS, 0, flags);
assert.equal(examine(), undefined, "op 11 needs its transmit bit, which IF_SETEVENTS (v1) cannot carry");

// IF_SETEVENTS_V2 with ops 1-11, as the server sends the bank's slots.
const v2 = decodeServerPacket(new Uint8Array(encodeWidgetSetFlagsRangeV2(ITEMS, 0, 1409, flags, 0x7ff))) as any;
assert.deepEqual(v2?.payload, { action: "set_flags_range", uid: ITEMS, fromSlot: 0, toSlot: 1409, flags, opMask: 0x7ff });
manager.setWidgetFlagsByKey(ITEMS, 0, v2.payload.flags, v2.payload.opMask);
assert.deepEqual(
    menu().map((entry) => entry.option),
    ["Withdraw-1", "Withdraw-5", "Withdraw-10", "Withdraw-X", "Withdraw-All", "Withdraw-All-but-1", "Placeholder", "Examine", "Cancel"],
);
assert.equal(examine()?.opIndex, 11);
assert.equal(manager.getWidgetFlags(whip) & 0x7fe, 0x7fe, "v2 ops 1-10 still set flag bits 1-10");

// A later v1 event for the slot drops op 11 again, as the real client's events replace both masks.
manager.setWidgetFlagsByKey(ITEMS, 0, flags);
assert.equal(examine(), undefined);
manager.setWidgetFlagsByKey(ITEMS, 0, flags, 0x7ff);
manager.clearWidgetFlagsOverridesForGroup(BANK);
assert.equal(manager.getWidgetOpMask(whip), 0, "closing the bank clears its op masks");

// The click goes out as IF_BUTTONX with the op index; ops 1-10 keep their IF_BUTTON1-10 packets.
const sent: Uint8Array[] = [];
(globalThis as any).WebSocket = { OPEN: 1 };
state.socket = { readyState: 1, send: (packet: Uint8Array) => sent.push(packet) } as any;
setPacketSocket(state.socket);
const click = (opId: number) => {
    sent.length = 0;
    sendWidgetAction({ widgetId: ITEMS, groupId: BANK, childId: 12, opId, slot: 0, itemId: WHIP });
    flushPackets();
    assert.equal(sent.length, 1);
    return decodeClientPacket(Buffer.from(sent[0]));
};
const action = { type: "widget_action", widgetId: ITEMS, groupId: BANK, childId: 12, slot: 0, itemId: WHIP };
assert.deepEqual(click(11), { ...action, buttonNum: 11 });
assert.deepEqual(click(1), { ...action, buttonNum: 1 });
// The designer consumes its local appearance controls, but the native pronoun dropdown is a server op.
const appearance = new PlayerAppearance(Gender.MALE, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]);
appearance.pronouns = 2;
let preview = appearance;
const designer = new PlayerDesignController({
    getIdkTypeLoader: () => ({}), getControlledPlayerServerId: () => 1,
    playerEcs: { getIndexForServerId: () => 0, getAppearance: () => preview, setAppearance: (_index: number, next: PlayerAppearance) => { preview = next; } },
} as any);
assert.equal(designer.handleWidgetAction(15), true, "a local kit arrow remains client-owned");
assert.equal(designer.handleWidgetAction(78), false, "pronoun controls must reach native dispatch");
assert.equal(designer.handleWidgetAction(47), true, "a colour changes the local preview");
assert.equal(preview.pronouns, 2, "local appearance previews retain the separately chosen pronouns");
sent.length = 0;
const pronouns = (679 << 16) | 78;
sendWidgetAction({ widgetId: pronouns, groupId: 679, childId: 78, opId: 1, slot: 3 });
flushPackets();
assert.equal(sent.length, 1, "the transport must not discard every designer op");
assert.deepEqual(decodeClientPacket(Buffer.from(sent[0])), {
    type: "widget_action", widgetId: pronouns, groupId: 679, childId: 78,
    buttonNum: 1, slot: 3, itemId: undefined,
});
setPacketSocket(null);
state.socket = null as any;

console.log("widget ops beyond 10 passed");
