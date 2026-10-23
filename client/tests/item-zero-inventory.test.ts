import { strict as assert } from "node:assert";

import { Inventory } from "../rs/inventory/Inventory";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { ServerPacketId } from "../common/packets/ServerPacketId";
import { GroundItemStore } from "../game/data/ground/GroundItemStore";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

const payload = Buffer.alloc(12);
payload.writeUInt16BE(2, 0);
payload.writeUInt16BE(0, 2);
payload.writeUInt16BE(1, 4); // wire id 1 is cache item 0
payload[6] = 1;
payload.writeUInt16BE(1, 7);
payload.writeUInt16BE(0, 9); // wire id 0 is the empty-slot sentinel (-1)
payload[11] = 0;
const packet = Buffer.concat([
    Buffer.from([ServerPacketId.INVENTORY_SNAPSHOT, payload.length >> 8, payload.length & 0xff]),
    payload,
]);
const decoded = decodeServerPacket(packet);
assert.equal(decoded?.type, "inventory");
if (decoded?.type !== "inventory") throw new Error("inventory snapshot was not decoded");

const inventory = new Inventory(3);
inventory.setSnapshot(decoded.payload.slots);
assert.deepEqual(inventory.getSlot(0), { slot: 0, itemId: 0, quantity: 1 });
assert.deepEqual(inventory.getSlot(1), { slot: 1, itemId: -1, quantity: 0 });
assert.equal(inventory.firstEmptySlot(), 1);
inventory.setSelectedSlot(0);
assert.equal(inventory.getSelectedSlot(), 0, "item 0 remains a selectable inventory slot");
inventory.setSlot(0, -1, 0);
assert.equal(inventory.getSelectedSlot(), null, "only the negative empty sentinel clears selection");

const bankPayload = Buffer.alloc(10);
bankPayload.writeUInt16BE(1410, 0);
bankPayload.writeUInt16BE(1, 2);
bankPayload.writeUInt16BE(0, 4);
bankPayload.writeUInt16BE(1, 6); // bank wire id 1 is cache item 0
bankPayload[8] = 1;
bankPayload[9] = 0;
const bankPacket = Buffer.concat([
    Buffer.from([ServerPacketId.BANK_SNAPSHOT, bankPayload.length >> 8, bankPayload.length & 0xff]),
    bankPayload,
]);
const bankDecoded = decodeServerPacket(bankPacket);
assert.equal(bankDecoded?.type, "bank");
if (bankDecoded?.type !== "bank") throw new Error("bank snapshot was not decoded");
assert.equal(bankDecoded.payload.slots[0]?.itemId, 0);
const bankInventory = new Inventory(1410);
bankInventory.setSnapshot(bankDecoded.payload.slots);
assert.equal(bankInventory.getSlot(0)?.itemId, 0, "bank inventory retains the cache item");

const menu = deriveMenuEntriesForWidget(
    {
        uid: 149 << 16,
        childIndex: 0,
        itemId: 0,
        name: "Dwarf remains",
        actions: ["Drop"],
    },
    false,
    () => -1,
    () => undefined,
);
assert.ok(menu.some((entry) => entry.option === "Drop"), "item 0 keeps its real inventory menu actions");
assert.ok(menu.some((entry) => entry.target === "<col=ff9040>Dwarf remains"));

const bankMenu = deriveMenuEntriesForWidget(
    {
        uid: 12 << 16,
        childIndex: 0,
        itemId: 0,
        name: "Dwarf remains",
        actions: ["Withdraw-1"],
    },
    false,
    () => -1,
    () => undefined,
);
assert.ok(bankMenu.some((entry) => entry.option === "Withdraw-1"));
assert.ok(bankMenu.some((entry) => entry.target === "<col=ff9040>Dwarf remains"));

const ground = new GroundItemStore();
ground.update({
    kind: "snapshot",
    stacks: [{ id: 1, itemId: 0, quantity: 1, tile: { x: 10, y: 20, level: 0 } }],
});
assert.equal(ground.getStacksAt(10, 20, 0)[0]?.itemId, 0, "ground item snapshots retain cache item 0");
