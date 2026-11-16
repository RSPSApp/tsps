import assert from "node:assert/strict";
import { test } from "node:test";
import { Inventory } from "../rs/inventory/Inventory";
import { getTransmitCycles } from "../game/TransmitCycles";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";

/** SHOP_OPEN (150, var-short) as the server writes it: id, name, header, the stock rows, then optionally the inventory. */
function shopOpen(inventoryId?: number): Uint8Array {
    const text = (value: string) => [...Buffer.from(value, "latin1"), 0];
    const short = (value: number) => [(value >> 8) & 0xff, value & 0xff];
    const int = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    const row = [...short(0), ...short(5343), ...int(2000000000), ...int(2000000000), ...int(6), ...int(0)]; // a seed dibber
    const body = [
        ...text("1113"), ...text("Farming Supplies"),
        ...short(995), 0, 1, 1, ...short(1), ...row,
        ...(inventoryId === undefined ? [] : short(inventoryId)),
    ];
    return Uint8Array.from([150, ...short(body.length), ...body]);
}

test("SHOP_OPEN carries the shop's live inventory when the server sends one, and none from an older server", () => {
    const withInventory: any = decodeServerPacket(shopOpen(894));
    assert.equal(withInventory?.type, "shop");
    assert.equal(withInventory.payload.inventoryId, 894);
    assert.equal(withInventory.payload.stock[0].itemId, 5343);
    assert.equal(withInventory.payload.stock[0].quantity, 2000000000);
    const legacy: any = decodeServerPacket(shopOpen());
    assert.equal(legacy.payload.inventoryId, undefined);
    assert.equal(legacy.payload.stock.length, 1);
});

test("a shop opened under its live inventory is published there too, so the cache scripts read the stock from it", async () => {
    (globalThis as any).self = globalThis;
    const { readFileSync } = await import("node:fs");
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");
    const stock = new Inventory(300);
    const inventories = new Map<number, Inventory>([[516, stock]]);
    const client: any = Object.assign(Object.create(OsrsClient.prototype), { shopInventory: stock, cs2Vm: { context: { inventories } } });

    const before = getTransmitCycles().changedInvCount;
    client.handleShopServerUpdate({ open: true, inventoryId: 894, stock: [{ slot: 0, itemId: 5343, quantity: 2000000000 }] });
    assert.equal(inventories.get(894), stock, "the farmer_supplies inventory is the shop's stock");
    assert.equal(inventories.get(516), stock);
    assert.equal(inventories.get(894)?.getSlot(0)?.itemId, 5343);
    assert.equal(getTransmitCycles().changedInvCount, before + 2, "both inventories transmit");

    // A shop without one keeps the shared 516 only.
    const plain = new Map<number, Inventory>([[516, stock]]);
    client.cs2Vm = { context: { inventories: plain } };
    const plainBefore = getTransmitCycles().changedInvCount;
    client.handleShopServerUpdate({ open: true, stock: [{ slot: 0, itemId: 1931, quantity: 5 }] });
    assert.equal(plain.has(894), false);
    assert.equal(getTransmitCycles().changedInvCount, plainBefore + 1);
});
