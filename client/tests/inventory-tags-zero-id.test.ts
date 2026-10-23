import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { PluginInjector, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { InventoryTagsPlugin, inventoryTagBounds } from "../game/plugins/inventorytags/InventoryTagsPlugin";

test("Inventory Tags preserves valid cache item zero without highlighting empty widgets", () => {
    const config = new ConfigManager(new EventBus());
    const injector = new PluginInjector(config).provide(ConfigManager, config)
        .provide(ClientToolbar, new ClientToolbar()).provide(CLIENT_TOKEN, {});
    try {
        const plugin = injector.runWith(() => new InventoryTagsPlugin());
        // Cache 241's ItemIdentifiers.DWARF_REMAINS is 0; empty IF3 item widgets use -1.
        plugin.setGroups([{ name: "Quest items", color: "#112233", itemIds: [0, 0] }]);
        assert.deepEqual(plugin.getGroups()[0].itemIds, [0]);
        const restored = injector.runWith(() => new InventoryTagsPlugin());
        assert.deepEqual(restored.getGroups()[0].itemIds, [0]);
        assert.equal(restored.colorForItem(0), 0x112233);
        assert.equal(restored.colorForItem(-1), undefined);
        const widgets = [0, -1, undefined].map((itemId, index) => ({
            uid: (149 << 16) | index, itemId,
            _absX: index * 32, _absY: 0, _absWidth: 32, _absHeight: 32,
        }));
        assert.deepEqual(inventoryTagBounds(widgets, { isEffectivelyHidden: () => false }, id => restored.colorForItem(id)),
            [{ x: 0, y: 0, w: 32, h: 32, color: 0x112233 }]);
        for (const invalid of [-1, 0.5, NaN]) {
            assert.throws(() => plugin.setGroups([{ name: "Invalid", color: "#112233", itemIds: [invalid] }]));
            assert.deepEqual(plugin.getGroups()[0].itemIds, [0]);
        }
    } finally { config.destroy(); }
});
