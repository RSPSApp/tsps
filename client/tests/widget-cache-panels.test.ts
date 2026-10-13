import assert from "node:assert/strict";
import { Inventory } from "../rs/inventory/Inventory";

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
}

console.log("Cache panel scripts retain dynamic inventory items and 64-bit prices");
