import assert from "node:assert/strict";
import { test } from "node:test";
import { Inventory } from "../rs/inventory/Inventory";
import { retainedInventory, stopInventoryTransmit } from "../game/sync/InventoryStopTransmit";
import { capturePlayer } from "../game/plugins/shortestpath/playerState";
import { collectQuestHelperSnapshot } from "../game/plugins/questhelper/QuestHelperSnapshot";
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

test("plugins keep the closed bank's last contents; CS2's bank Inventory is cleared", () => {
    const bankInventory = new Inventory(1410);
    const lastKnownBank = retainedInventory(bankInventory);
    const ecs: any = { getIndexForServerId: () => 0, getLevel: () => 0, getAnimActionSeqId: () => -1,
        getAnimMovementSeqId: () => -1, getRotation: () => 0, getInteractionIndex: () => -1 };
    const client: any = { inventory: new Inventory(), equipment: new Inventory(14), bankInventory, lastKnownBank,
        getControlledPlayerMovementTile: () => ({ tileX: 3200, tileY: 3200 }), controlledPlayerServerId: 1,
        localPlayerName: "Tester", playerEcs: ecs,
        varManager: { values: new Int32Array(1), customVarbits: new Map(), varbitLoader: { load: () => undefined }, getVarbit: () => 0, getVarp: () => 0 },
        npcEcs: { forEachActive: () => {} }, renderer: { getLocIdsAtTileAllLevels: () => [] }, groundItems: { getAllStacks: () => [] },
        widgetManager: { rootInterface: -1, interfaceParents: new Map(), getAllGroupRoots: () => [] } };
    const shortestPathBank = () => [...(capturePlayer(client, true).bank ?? new Map())];
    const questHelperBank = () => collectQuestHelperSnapshot(client, 1, { baseX: 3150, baseY: 3150, plane: 0 } as any, [], new Set())
        .bank?.map((item: any) => [item.id, item.quantity]);
    bankInventory.setSnapshot([{ slot: 0, itemId: 8007, quantity: 5 }]);
    assert.deepEqual(shortestPathBank(), [[8007, 5]]);
    stopInventoryTransmit(new Map([[95, bankInventory]]), 95);
    assert.equal(bankInventory.getSlot(0)?.itemId, -1, "the CS2 container is still discarded");
    assert.deepEqual(shortestPathBank(), [[8007, 5]], "Shortest Path still counts the closed bank");
    assert.deepEqual(questHelperBank(), [[8007, 5]], "Quest Helper still sees the closed bank");
    bankInventory.setSnapshot([{ slot: 1, itemId: 8008, quantity: 2 }]);
    bankInventory.setSlot(1, -1, 0);
    assert.deepEqual(shortestPathBank(), [], "a real withdrawal while open still empties it");
});
