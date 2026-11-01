import assert from "node:assert/strict";
import { Inventory } from "../rs/inventory/Inventory";
import { deriveRawMenuEntriesForWidget } from "../widgets/menu/utils";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetRunScript } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// Exercise the cache's actual panels and long-price script, not just the VM opcode.
{
    const { createCacheVm } = require('../scripts/cache/cs2-sweep');
    const { vm: cacheVm } = createCacheVm();
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 161;
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(464);
    wm.getGroup(238);
    const checked = new Inventory(28);
    checked.setSlot(0, 1333, 1);
    const backpack = new Inventory(28);
    backpack.setSlot(0, 1511, 10);
    cacheVm.context.inventories = new Map([[90, checked], [93, backpack]]);
    cacheVm.run(cacheVm.context.loadScript(149), [(238 << 16), 93, 4, 7, 1, -1],
        ['Add', 'Add-5', 'Add-10', 'Add-All', 'Add-X']);
    assert.equal(wm.getWidgetByUid(238 << 16).children[0].itemId, 1511);
    cacheVm.run(cacheVm.context.loadScript(785), [], [], undefined,
        [12345678901n, ...Array(27).fill(0n)]);
    assert.equal(wm.getWidgetByUid((464 << 16) | 2).children[0].itemId, 1333);
    assert.ok(wm.getWidgetByUid((464 << 16) | 2).children.some((child: any) =>
        child?.text?.includes('12,345,678,901')), 'guide-price text preserves a 64-bit total');

    // Looting bag prices precede setup: wrong int arguments throw before it can draw the items.
    wm.getGroup(81);
    const runPacket = (packet: Uint8Array) => {
        const { payload } = decodeServerPacket(packet) as any;
        for (const [id, snapshot] of Object.entries(payload.inventories ?? {}) as [string, any][]) {
            const inventory = new Inventory(snapshot.capacity);
            inventory.setSnapshot(snapshot.slots);
            cacheVm.context.inventories.set(Number(id), inventory);
        }
        if (payload.scriptId < 0) return;
        cacheVm.run(cacheVm.context.loadScript(payload.scriptId),
            payload.args.filter((arg: any) => typeof arg === 'number'),
            payload.args.filter((arg: any) => typeof arg === 'string'), undefined,
            payload.args.filter((arg: any) => typeof arg === 'bigint'));
        assert.equal(cacheVm.lastError, null);
    };
    runPacket(encodeWidgetRunScript(-1, [], undefined, undefined, {
        516: { capacity: 28, slots: [{ slot: 0, itemId: 995, quantity: 7 }, { slot: 1, itemId: 1333, quantity: 1 }] },
    }));
    runPacket(encodeWidgetRunScript(1235, [516, 1n, 12_345_678_901n, ...Array(26).fill(-1n)]));
    runPacket(encodeWidgetRunScript(495, ['Looting bag', 0]));
    const bagItems = wm.getWidgetByUid((81 << 16) | 5);
    assert.equal(wm.getWidgetByUid((81 << 16) | 1).text, 'Looting bag');
    assert.deepEqual(bagItems.children.slice(0, 2).map((child: any) => [child.itemId, child.itemQuantity]),
        [[995, 7], [1333, 1]], 'Check draws the decoded bag inventory');
    assert.ok(bagItems.children[1].onMouseRepeat.some((arg: any) =>
        typeof arg === 'string' && arg.includes('12,345,678,901')), 'per-slot prices retain 64 bits');
    runPacket(encodeWidgetRunScript(1235, [93, 42n, ...Array(27).fill(-1n)]));
    runPacket(encodeWidgetRunScript(495, ['Add to bag', 1]));
    assert.equal(bagItems.children[0].itemId, 1511, 'Deposit draws the backpack instead');
    assert.equal(bagItems.children[0].actions[0], 'Store-1');

    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    for (const [book, child] of [[0, 6], [1, 108], [2, 109], [3, 153]]) {
        cacheVm.context.varManager.setVarbit(4070, book);
        cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
        const home = wm.getWidgetByUid((218 << 16) | child);
        assert.ok(deriveRawMenuEntriesForWidget(home).some(entry => entry.option === 'Animation' && entry.opIndex === 10),
            `Home Teleport animation menu entry in spellbook ${book}`);
    }

    wm.getGroup(525);
    cacheVm.context.varManager.setVarp(4559, 4093);
    cacheVm.context.varManager.setVarp(4560, 1);
    cacheVm.run(cacheVm.context.loadScript(7707), [], []);
    assert.equal(cacheVm.lastError, null, 'native Home Teleport animation picker initializes');
    assert.ok(wm.getWidgetByUid((525 << 16) | 3).children.some((child: any) =>
        child?.text === 'Home Teleport Animations'));
    const toggles = wm.getWidgetByUid((525 << 16) | 8).children;
    for (const toggle of [toggles[0], toggles[1]]) {
        cacheVm.runScriptEvent({ args: toggle.onClick, widget: toggle });
        assert.equal(cacheVm.context.varManager.getVarp(4560), 1,
            'Default remains selected: the last animation and locked cosmetics cannot be toggled');
    }
}

console.log("Cache panel scripts retain dynamic inventory items and 64-bit prices");
