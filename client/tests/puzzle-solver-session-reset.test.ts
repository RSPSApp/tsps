import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as InventoryID from "@runelite/api/gameval/InventoryID";
import { Inventory } from "../rs/inventory/Inventory";
import { ClientImpl } from "../runelite/impl/ClientImpl";

// A new session must not see an inventory the previous one sent: getItemContainer is null for it
// again until the server sends it.
async function main() {
    (globalThis as any).self = globalThis;
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");

    for (const fullReset of [false, true]) {
        const inventory = new Inventory(28);
        const equipment = new Inventory(14);
        const bank = new Inventory(816);
        const trade = new Inventory(28);
        const otherTrade = new Inventory(28);
        const shop = new Inventory(300);
        const collection = new Inventory(2048);
        const seeded = new Map<number, Inventory>([
            [90, trade], [90 + 32768, otherTrade], [516, shop], [620, collection],
        ]);
        const inventories = new Map<number, Inventory>([
            [InventoryID.INV, inventory], [InventoryID.WORN, equipment], [InventoryID.BANK, bank],
            ...seeded,
        ]);
        const puzzle = InventoryID.TRAIL_PUZZLEINV;
        const pieces = new Inventory(25);
        pieces.setSlot(0, 1974, 1);
        inventories.set(puzzle, pieces);
        // Server updates can replace a startup entry: reset must restore the original object.
        const replacementShop = new Inventory(300);
        replacementShop.setSlot(0, 995, 100);
        inventories.set(516, replacementShop);
        for (const store of [inventory, equipment, bank, ...seeded.values()]) store.setSlot(0, 995, 7);
        const permanentSnapshots = [inventory, equipment, bank].map((store) => store.getSlots());
        const unrelated = { setting: "preserve" };
        const client: any = Object.assign(Object.create(OsrsClient.prototype), {
            inventory, equipment, bankInventory: bank,
            tradeOfferInventory: trade, tradeOtherOfferInventory: otherTrade,
            shopInventory: shop, collectionInventory: collection,
            cs2Vm: { context: { inventories } },
            serverSentInventoryIds: new Set([puzzle, InventoryID.BANK, ...seeded.keys()]),
            // Only unrelated scene services are stubbed; the reset method and inventory owners are real.
            npcInstances: { clearLocal() {} }, serverSubInterfaces: new Map(),
            burningLogMeshes: new Map(), replacedWorldEntities: new Map(),
            modelHighlightManager: { reset() {} }, friendLoginUpdates: new Map(),
            unrelated,
        });
        const facade = new ClientImpl(client);
        assert.ok(facade.getItemContainer(puzzle), "puzzle was sent in this session");
        assert.ok(facade.getItemContainer(InventoryID.BANK), "bank was sent in this session");
        const warnings: unknown[][] = [];
        const warn = console.warn;
        console.warn = (...args) => { warnings.push(args); };
        try {
            // Invoke the production disconnect/logout reset caller, never its private helper.
            client.resetWorld(fullReset);
        } finally {
            console.warn = warn;
        }
        assert.deepEqual(warnings, [], "production reset must not hide lifecycle errors");
        assert.equal(facade.getItemContainer(puzzle), null, "forgotten once the session resets");
        assert.equal(inventories.has(puzzle), false, "puzzle dropped from the script VM map");
        assert.equal(client.serverSentInventoryIds.size, 0, "all previous-session sent markers cleared");
        assert.equal(facade.getItemContainer(InventoryID.BANK), null, "bank becomes unsent");
        for (const [id, store] of seeded) {
            assert.equal(inventories.get(id), store, "original seeded object restored");
            assert.equal(store.getSlot(0)?.itemId, -1, "seeded session contents cleared");
            assert.equal(facade.getItemContainer(id), null, "seeded containers stay unsent");
        }
        for (const [index, id] of [InventoryID.INV, InventoryID.WORN, InventoryID.BANK].entries()) {
            const store = [inventory, equipment, bank][index];
            assert.equal(inventories.get(id), store, "permanent inventory object preserved");
            assert.deepEqual(store.getSlots(), permanentSnapshots[index], "permanent contents preserved");
        }
        assert.ok(facade.getItemContainer(InventoryID.INV), "backpack remains available");
        assert.ok(facade.getItemContainer(InventoryID.WORN), "equipment remains available");
        assert.equal(client.unrelated, unrelated, "unrelated client state preserved");
        // A later server inventory update in the next session can expose the puzzle again.
        const newPieces = new Inventory(25);
        newPieces.setSlot(0, 1975, 1);
        inventories.set(puzzle, newPieces);
        client.serverSentInventoryIds.add(puzzle);
        assert.ok(facade.getItemContainer(puzzle), "next-session puzzle is available after a new update");
        assert.equal(inventories.get(puzzle), newPieces);
    }
    console.log("puzzle-solver-session-reset ok");
}
main().catch((err) => { console.error(err); process.exit(1); });
