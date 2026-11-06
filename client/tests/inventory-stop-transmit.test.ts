import assert from "node:assert/strict";
import { test } from "node:test";
import { Inventory } from "../rs/inventory/Inventory";
import { stopInventoryTransmit } from "../game/sync/InventoryStopTransmit";
import { getTransmitCycles } from "../game/TransmitCycles";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundUi } from "../network/serverConnection/handlers/inboundUi";
import { subscribeBank, subscribeWidgetEvents } from "../network/serverConnection/subscriptions/ui";
import { state } from "../network/serverConnection/state";

test("wire stop clears only its cached Inventory and notifies even repeated/unknown IDs", () => {
    const bank = new Inventory(10), bag = new Inventory(28);
    bank.setSlot(0, 995, 100); bag.setSlot(0, 554, 7);
    const map = new Map([[95, bank], [516, bag]]);
    const unsub = subscribeWidgetEvents(payload => {
        if (payload.action === "inventory_stop_transmit") stopInventoryTransmit(map, payload.inventoryId);
    });
    const before = getTransmitCycles().changedInvCount;
    try {
        for (const id of [95, 95, 65535]) {
            const packet = decodeServerPacket(Uint8Array.of(56, id >> 8, id & 255));
            assert.ok(packet);
            assert.equal(handleInboundUi(packet), true);
        }
        assert.equal(map.get(95), bank, "retain identity for existing HUD consumers");
        assert.equal(bank.getSlot(0)?.itemId, -1);
        assert.equal(bag.getSlot(0)?.quantity, 7);
        assert.equal(getTransmitCycles().changedInvCount, before + 3);
        assert.equal(getTransmitCycles().changedInvsBuffer[(before + 2) & 31], 32767);
        bank.setSlot(3, 995, 9);
        assert.equal(bank.getSlot(0)?.quantity, 0, "a later partial cannot revive old slots");
        assert.equal(bank.getSlot(3)?.quantity, 9);
    } finally { unsub(); }
});

test("stopping a bank clears late-subscriber replay; a subsequent partial starts a fresh cache", () => {
    handleInboundUi({ type: "bank", payload: { kind: "snapshot", capacity: 1410,
        slots: [{ slot: 0, itemId: 995, quantity: 100 }] } });
    handleInboundUi(decodeServerPacket(Uint8Array.of(56, 0, 95)));
    const replay: any[] = [];
    const unsub = subscribeBank(p => replay.push(p));
    assert.deepEqual(replay, []);
    unsub();
    handleInboundUi({ type: "bank", payload: { kind: "slot", slot: { slot: 3, itemId: 554, quantity: 4 } } });
    const resumed: any[] = [];
    const end = subscribeBank(p => resumed.push(p));
    try {
        assert.equal(resumed.length, 1);
        assert.deepEqual(resumed[0].slots.map((s: any) => [s.slot, s.itemId, s.quantity]), [[3, 554, 4]]);
    } finally { end(); state.lastBankState = undefined; }
});
