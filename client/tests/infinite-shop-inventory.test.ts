import assert from "node:assert/strict";
import { test } from "node:test";
import { Inventory } from "../rs/inventory/Inventory";
import { getTransmitCycles } from "../game/TransmitCycles";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { DeferredArchiveInvTypeLoader } from "../rs/config/invtype/InvTypeLoader";
import { GroupMissingError } from "../rs/cache/js5/GroupMissingError";
import { Opcodes } from "../rs/cs2/Opcodes";

test("inventory definitions retry streamed archives and preserve explicit runtime capacities", () => {
    const { vm, cache, info } = createCacheVm();
    const archive = cache.getIndex(2).getArchive(5);
    let pending = true;
    let reads = 0;
    const loader = new DeferredArchiveInvTypeLoader(info, () => {
        reads++;
        if (pending) throw new GroupMissingError(2, 5, 0, 1);
        return archive;
    });
    assert.equal(reads, 0, "context construction does not request a streamed archive");
    assert.throws(() => loader.load(933), GroupMissingError);
    pending = false;
    assert.equal(loader.load(933).size, 12, "missing archive must not cache an empty definition");
    assert.equal(loader.load(976).size, 14);
    assert.equal(loader.load(95).size, 1410, "unsigned-short size is not truncated to one byte");
    assert.equal(loader.load(99999).size, 0);
    assert.equal(reads, 2, "successful archive is retained");

    const size = (id: number) => {
        const ctx = vm.createHandlerContext();
        vm.intStackSize = 1;
        vm.intStack[0] = id;
        vm.handlers.get(Opcodes.INV_SIZE)(ctx, 0, "");
        return vm.intStack[0];
    };
    vm.context.inventories = new Map();
    assert.equal(size(516), 28, "unregistered native looting bag uses its cache definition");
    vm.context.inventories.set(516, new Inventory(300));
    assert.equal(size(516), 300, "registered legacy shop retains its explicit capacity");
    vm.context.inventories.set(584, new Inventory(50));
    assert.equal(size(584), 50, "server-supplied custom capacity remains authoritative");
    vm.context.inventories.clear();
    vm.context.invTypeLoader = undefined;
    assert.equal(size(516), 300, "legacy caches keep their compatibility fallback");
    assert.equal(size(93), 28);
    assert.equal(size(99999), 0);
});

test("native shop scripts allocate slots before their first stock packet and update them after transmission", () => {
    const { vm, scripts } = createCacheVm();
    const widgets = vm.context.widgetManager;
    widgets.getGroup(300);
    const stock = new Inventory(300);
    vm.context.inventories = new Map([[516, stock]]);
    const errors: string[] = [];
    vm.logError = (error: Error) => errors.push(error.message);
    const parent = widgets.getWidgetByUid((300 << 16) | 16);

    // The server sends shop_main_init before SHOP_OPEN publishes its native inventory.
    // Fresh native containers therefore cannot rely on a previously received snapshot.
    for (const [id, size] of [[933, 12], [976, 14], [894, 7], [516, 300]]) {
        stock.clear();
        vm.run(scripts.load(1074), [id, -1, 0, 0], ["Shop"]);
        assert.equal(parent.children.length, size + 1, `inventory ${id}: highlight plus slots`);
        assert.equal(parent.onInvTransmit[2], size, "listener retains the capacity at initialization");
        assert.equal(parent.children[1].isHidden, true, "unreceived stock starts hidden");
        vm.context.inventories.set(id, stock);
        stock.setSlot(0, 1917, 2_000_000_000);
        stock.setSlot(size - 1, 2327, 2_000_000_000);
        vm.invokeEventHandler(parent, "onInvTransmit");
        assert.equal(parent.children[1].itemId, 1917);
        assert.equal(parent.children[size].itemId, 2327);
        assert.equal(parent.children[1].isHidden, false);
        assert.ok(parent.children[1].actions.includes("Value"));
        assert.ok(parent.children[1].actions.includes("Buy 1"));
        stock.setSlot(0, -1, 0);
        vm.invokeEventHandler(parent, "onInvTransmit");
        assert.equal(parent.children[1].isHidden, true, "later empty slots hide");
        assert.equal(parent.children[size].itemId, 2327, "other live slots survive");

        // Reopening after the packet has registered a runtime container must remain usable.
        vm.run(scripts.load(1074), [id, -1, 0, 0], ["Shop"]);
        assert.equal(parent.children.length, stock.capacity + 1);
        assert.equal(parent.children[size].itemId, 2327);
    }
    assert.deepEqual(errors, []);
});

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
