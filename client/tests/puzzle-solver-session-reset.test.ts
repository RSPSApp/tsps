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

    const shop = new Inventory(300);
    const inventories = new Map<number, Inventory>([[93, new Inventory(28)], [516, shop]]);
    const client: any = Object.assign(Object.create(OsrsClient.prototype), {
        inventory: inventories.get(93), equipment: new Inventory(14), bankInventory: new Inventory(816),
        tradeOfferInventory: new Inventory(28), tradeOtherOfferInventory: new Inventory(28),
        shopInventory: shop, collectionInventory: new Inventory(2048),
        cs2Vm: { context: { inventories } },
        serverSentInventoryIds: new Set<number>(),
    });
    const facade = new ClientImpl(client);
    const puzzle = InventoryID.TRAIL_PUZZLEINV;

    inventories.set(puzzle, new Inventory(25));
    client.serverSentInventoryIds.add(puzzle);
    assert.ok(facade.getItemContainer(puzzle), "sent in this session");
    assert.ok(facade.getItemContainer(InventoryID.INV), "the backpack is a container");

    (OsrsClient.prototype as any).forgetSentInventories.call(client);
    assert.equal(facade.getItemContainer(puzzle), null, "forgotten once the session resets");
    assert.equal(inventories.has(puzzle), false, "and dropped from the script VM map");
    assert.ok(inventories.has(516) && inventories.has(93), "seeded entries stay");
    assert.ok(facade.getItemContainer(InventoryID.INV), "the backpack is untouched");
    console.log("puzzle-solver-session-reset ok");
}
main().catch((err) => { console.error(err); process.exit(1); });
