import assert from "node:assert/strict";
import { GroundItemStore, isGroundItemOperationEnabled } from "../game/data/ground/GroundItemStore";
import { cloneGroundItemsPayload, applyGroundItemsDelta } from "../network/serverConnection/utils/groundItems";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { ServerPacketId } from "../common/packets/ServerPacketId";
import { buildGroundItemMenuEntries } from "../game/menu/WorldMenuBuilder";

const stack = { id: 4, itemId: 1785, quantity: 1, tile: { x: 2822, y: 3355, level: 0 }, enabledOps: 0 };
const store = new GroundItemStore();
const snapshot = { kind: "snapshot" as const, serial: 1, stacks: [stack, { ...stack, id: 5, enabledOps: 31 }] };
store.update(cloneGroundItemsPayload(snapshot));
assert.equal(store.getStacksAt(2822, 3355, 0)[0].enabledOps, 0);
assert.equal(store.getStacksAt(2822, 3355, 0)[1].enabledOps, 31);
const delta = { kind: "delta" as const, serial: 2, upserts: [{ ...stack, enabledOps: 8 }], removes: [] };
const merged = applyGroundItemsDelta(snapshot, delta);
store.update(merged);
assert.equal(store.getStacksAt(2822, 3355, 0).find(s => s.id === 4)!.enabledOps, 8);
for (let index = 0; index < 5; index++) assert.equal(isGroundItemOperationEnabled({ enabledOps: 8 }, index), index === 3);
assert.equal(isGroundItemOperationEnabled({}, 2), true);

// Real binary decoder: zero survives the wire and the following row stays aligned.
const row = (id: number, flags: number) => {
    const bytes = Buffer.alloc(34);
    bytes.writeInt32BE(id); bytes.writeUInt16BE(1785, 4); bytes.writeInt32BE(1, 6);
    bytes.writeUInt16BE(2822, 10); bytes.writeUInt16BE(3355, 12); bytes[33] = flags;
    return bytes;
};
const header = Buffer.alloc(9); header[0] = ServerPacketId.GROUND_ITEMS;
header.writeUInt16BE(6 + 68, 1); header.writeInt32BE(1, 3); header.writeUInt16BE(2, 7);
const decoded: any = decodeServerPacket(Buffer.concat([header, row(4, 0), row(5, 31)]));
assert.deepEqual(decoded.payload.stacks.map((s: any) => [s.id, s.enabledOps]), [[4, 0], [5, 31]]);

const context: any = { activeSpell: null, selectedItem: null, debugId: false };
const callbacks: any = { closeMenu() {}, onTakeGroundItem() {} };
const type: any = { id: 1785, name: "Glassblowing pipe", groundActions: [null, null, null, "Light", null] };
const menu = (flags: number) => buildGroundItemMenuEntries(type, 4, { ...stack, enabledOps: flags }, 1, 1, context, callbacks);
assert.equal(menu(0).actions.length, 0);
assert.equal(menu(0).examine!.option, "Examine");
assert.deepEqual(menu(8).actions.map(e => e.option), ["Light"]);
assert.deepEqual(menu(4).actions.map(e => e.option), ["Take"]);
store.update(undefined); store.update({ ...snapshot, stacks: [{ ...stack, enabledOps: undefined }] });
assert.equal(store.getStacksAt(2822, 3355, 0)[0].enabledOps, 31);
console.log("ground-item wire, cache, identity, menu and reset checks passed");
