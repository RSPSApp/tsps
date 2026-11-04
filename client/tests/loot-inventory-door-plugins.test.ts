import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import type { ConfigStorage } from "../runelite/client/config/ConfigStorage";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { PluginManager } from "../runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { Inventory } from "../rs/inventory/Inventory";
import { loadItemPrices } from "../network/serverConnection/domain/itemPrices";
import { state } from "../network/serverConnection/state";
import { LootTrackerPlugin } from "../game/plugins/loottracker/LootTrackerPlugin";
import { InventorySetupsPlugin, InventorySetupsConfig } from "../game/plugins/inventorysetups/InventorySetupsPlugin";
import { DoorKickerPlugin, DoorKickerConfig } from "../game/plugins/doorkicker/DoorKickerPlugin";

class MemoryStorage implements ConfigStorage {
    private readonly values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    removeItem(key: string): void { this.values.delete(key); }
    key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
    get length(): number { return this.values.size; }
}

async function main(): Promise<void> {
    (state as any).webRtcConfig = {};
    (state as any).socket = { fetchContent: async (path: string) => path === "/api/item-prices" ? { 4151: 250 } : {} };
    await loadItemPrices();

    const mutationListeners = new Set<(event: any) => void>();
    const playerAnimations: Array<[number, number]> = [];
    let bankOpen = true;
    const client: any = {
        controlledPlayerServerId: 42,
        groundItems: { mutationListeners },
        inventory: new Inventory(),
        equipment: new Inventory(14),
        bankInventory: new Inventory(1410),
        widgetManager: { getWidgetByUid: () => bankOpen ? {} : undefined },
        objTypeLoader: { load: (id: number) => ({ id, name: id === 4151 ? "Abyssal whip" : `Item ${id}`, price: 100, noteTemplate: -1, note: -1 }) },
        playerAnimController: { setAnimation: (playerId: number, sequence: number) => playerAnimations.push([playerId, sequence]) },
    };
    client.inventory.setSlot(0, 4151, 1);
    client.equipment.setSlot(3, 4151, 1);
    client.bankInventory.setSlot(0, 4151, 4);

    const configManager = new ConfigManager(undefined, new MemoryStorage());
    const pluginManager = new PluginManager(new EventBus(), configManager);
    pluginManager.getInjector().provide(CLIENT_TOKEN, client);
    pluginManager.loadCorePlugins([LootTrackerPlugin, InventorySetupsPlugin, DoorKickerPlugin]);

    const loot = pluginManager.getPlugin(LootTrackerPlugin)!;
    const setups = pluginManager.getPlugin(InventorySetupsPlugin)!;
    const door = pluginManager.getPlugin(DoorKickerPlugin)!;

    // Door animation stays inactive when its plugin is off and never consumes an interaction.
    const openDoor = { param0: 0, param1: 0, opcode: 3, identifier: 12, itemId: -1, option: "Open", target: "<col=ffff00>Oak door</col>", screenX: 0, screenY: 0 };
    assert.equal(door.onMenuOptionClicked(openDoor), false);
    assert.deepEqual(playerAnimations, []);

    await pluginManager.setPluginEnabled(LootTrackerPlugin, true);
    await pluginManager.setPluginEnabled(InventorySetupsPlugin, true);
    await pluginManager.setPluginEnabled(DoorKickerPlugin, true);

    // The tracker counts each owned stack once, adds later quantity increases, and ignores another player's drops.
    const emit = (event: any) => { for (const listener of mutationListeners) listener(event); };
    const stack = { id: 7, itemId: 4151, quantity: 2, tile: { x: 3200, y: 3200, level: 0 }, createdTick: 100, ownerId: 42, ownership: 1, name: "Abyssal whip", gePrice: 100 };
    emit({ kind: "spawn", stack });
    emit({ kind: "spawn", stack });
    emit({ kind: "quantity", stack: { ...stack, quantity: 4 }, oldQuantity: 2 });
    emit({ kind: "spawn", stack: { ...stack, id: 8, ownerId: 99 } });
    assert.deepEqual(loot.getState().items, [{ itemId: 4151, name: "Abyssal whip", quantity: 4, unitPrice: 250 }]);
    emit({ kind: "despawn", stack: { ...stack, quantity: 4 } });
    assert.equal(loot.getState().items[0].quantity, 4, "despawning a ground stack does not erase recorded drops");
    loot.clear();
    assert.deepEqual(loot.getState().items, []);

    // Setups capture exact slots, can be updated by name, and compare against bank contents.
    setups.saveCurrent("Raid");
    let setupState = setups.getState();
    assert.equal(setupState.setups.length, 1);
    assert.deepEqual(setupState.setups[0].inventory, [{ slot: 0, itemId: 4151, quantity: 1 }]);
    assert.deepEqual(setupState.setups[0].equipment, [{ slot: 3, itemId: 4151, quantity: 1 }]);
    assert.equal(setups.getBankCounts().get(4151), 4);
    assert.equal(setups.isBankOpen(), true);
    setups.saveCurrent("raid");
    setupState = setups.getState();
    assert.equal(setupState.setups.length, 1, "saving with the same name updates the existing setup");
    bankOpen = false;
    assert.equal(setups.isBankOpen(), false);
    assert.equal(configManager.getConfiguration(InventorySetupsConfig.group, "setups")?.includes("raid"), true);

    // Animation choice comes from the config dropdown; only open actions on door-like objects match.
    assert.equal(door.onMenuOptionClicked(openDoor), false);
    assert.deepEqual(playerAnimations, [[42, 423]]);
    configManager.setConfigValue(DoorKickerConfig, "animation", "PUNCH");
    assert.equal(door.onMenuOptionClicked({ ...openDoor, target: "Iron gate" }), false);
    assert.equal(door.onMenuOptionClicked({ ...openDoor, target: "Trap door" }), false);
    assert.equal(door.onMenuOptionClicked({ ...openDoor, target: "Bank chest" }), false);
    assert.equal(door.onMenuOptionClicked({ ...openDoor, option: "Close" }), false);
    assert.deepEqual(playerAnimations, [[42, 423], [42, 422], [42, 422]]);

    await pluginManager.setPluginEnabled(LootTrackerPlugin, false);
    await pluginManager.setPluginEnabled(InventorySetupsPlugin, false);
    await pluginManager.setPluginEnabled(DoorKickerPlugin, false);
    assert.equal(mutationListeners.size, 0, "disabling loot tracking unsubscribes from ground-item updates");
    console.log("Loot, inventory setup, and door animation checks passed.");
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
