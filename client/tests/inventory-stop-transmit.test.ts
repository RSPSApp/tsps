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


test("bag stop leaves the legacy shop replay intact; explicit shop close clears it", async () => {
    const { handleShopPayload } = await import("../network/serverConnection/domain/shop");
    const { subscribeShop } = await import("../network/serverConnection/subscriptions/ui");
    handleShopPayload({ kind: "open", shopId: "1222", name: "Lumbridge General Store",
        currencyItemId: 995, stock: [{ slot: 0, itemId: 1931, quantity: 5,
            priceEach: 1, sellPrice: 0, defaultQuantity: 5 }] });
    handleInboundUi(decodeServerPacket(Uint8Array.of(56, 2, 4)));
    const replay: any[] = [];
    const end = subscribeShop(value => replay.push(value));
    try {
        assert.equal(replay[0].stock[0]?.itemId, 1931);
        assert.equal(replay[0].stock[0]?.quantity, 5);
        assert.equal(replay[0].stock[0]?.priceEach, 1);
        handleShopPayload({ kind: "close", shopId: "1222" });
        assert.equal(replay.at(-1).open, false);
        assert.deepEqual(replay.at(-1).stock, []);
    } finally { end(); handleShopPayload({ kind: "close" }); }
});

test("shop updates restore the registry after bag Check/bank snapshots and stop packets", async () => {
    (globalThis as any).self = globalThis;
    const { readFileSync } = await import("node:fs");
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");
    const stock = new Inventory(300), backpack = new Inventory(28), bank = new Inventory(1410);
    backpack.setSlot(0, 11941, 1); bank.setSlot(0, 995, 100);
    const inventories = new Map([[516, stock], [93, backpack], [95, bank]]);
    const client: any = Object.assign(Object.create(OsrsClient.prototype), {
        shopInventory: stock, cs2Vm: { context: { inventories } },
    });
    const publish = (itemId: number, quantity: number) =>
        client.handleShopServerUpdate({ open: true, stock: [{ slot: 0, itemId, quantity }] });
    publish(1931, 5);
    for (const [itemId, quantity] of [[1931, 5], [1351, 10], [1931, 4]]) {
        const bag = new Inventory(28);
        bag.setSlot(0, 554, 7);
        inventories.set(516, bag); // Actual run_script snapshot behavior on a capacity change.
        stopInventoryTransmit(inventories, 516);
        const before = getTransmitCycles().changedInvCount;
        publish(itemId, quantity);
        assert.equal(inventories.get(516), stock, "CS2 must query the populated shop container");
        assert.equal(inventories.get(516)?.getSlot(0)?.itemId, itemId);
        assert.equal(inventories.get(516)?.getSlot(0)?.quantity, quantity);
        assert.equal(inventories.get(516)?.capacity, 300);
        assert.equal(getTransmitCycles().changedInvCount, before + 1);
        assert.equal(backpack.getSlot(0)?.itemId, 11941);
        assert.equal(bank.getSlot(0)?.quantity, 100);
        client.handleShopServerUpdate({ open: false });
        assert.equal(stock.getSlot(0)?.itemId, -1);
    }
});
