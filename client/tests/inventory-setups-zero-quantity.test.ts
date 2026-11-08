import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inventory } from "../rs/inventory/Inventory";
import { InventorySetupsPanel } from "../game/plugins/inventorysetups/InventorySetupsPanel";
import type { InventorySetupsPlugin } from "../game/plugins/inventorysetups/InventorySetupsPlugin";

// This exercises the panel's server snapshot with a synthetic public receiver;
// it does not exercise plugin lifecycle or the game's equipment producer.
const itemX = 1001;
const itemY = 1002;
const inventory = new Inventory();
const equipment = new Inventory(14);
const bankCounts = new Map<number, number>();
const setup = {
    id: "synthetic-setup",
    name: "Synthetic setup",
    inventory: [],
    equipment: [{ slot: 13, itemId: itemX, quantity: 1 }],
    updatedAt: 0,
};
const state = { setups: [setup], selectedId: setup.id, version: 0 };
const receiver = {
    subscribe: (_listener: () => void) => () => {},
    getState: () => state,
    getCurrentInventory: () => inventory.getSlots(),
    getCurrentEquipment: () => equipment.getSlots(),
    getBankCounts: () => bankCounts,
    isBankOpen: () => true,
    getClient: () => ({ objTypeLoader: { load: (id: number) => ({ name: id === itemX ? "Item X" : "Item Y" }) } }),
};
const render = () => renderToStaticMarkup(React.createElement(
    InventorySetupsPanel,
    { plugin: receiver as unknown as InventorySetupsPlugin },
));
const allAvailable = "All required items are on hand or in your bank.";

equipment.setSlot(13, itemX, 1);
let markup = render();
assert.ok(markup.includes("Equipped"), "a full equipment slot is equipped");
assert.ok(markup.includes(allAvailable), "the required item is on hand");

setup.equipment[0].quantity = 2;
equipment.setSlot(13, itemX, 2);
markup = render();
assert.ok(markup.includes("Equipped"), "a full multi-item equipment stack is equipped");
assert.ok(markup.includes(allAvailable), "both required items are on hand");
equipment.setSlot(13, itemX, 1);
markup = render();
assert.ok(markup.includes("Need 1 more"), "a partial equipment stack has a one-item shortfall");
assert.ok(markup.includes("Still missing") && markup.includes("Item X × 1"), "the summary reports the same shortfall");
assert.ok(!markup.includes(allAvailable), "a partial stack is not enough");

equipment.setSlot(13, itemX, 2);
bankCounts.set(itemX, 1);
setup.equipment[0].quantity = 3;
markup = render();
assert.ok(markup.includes(allAvailable), "two equipped items and one banked item satisfy three required");
setup.equipment[0].quantity = 4;
markup = render();
assert.ok(markup.includes("Still missing") && markup.includes("Item X × 1"), "two equipped items and one banked item leave one of four missing");
assert.ok(!markup.includes(allAvailable), "three available items do not satisfy four required");
bankCounts.clear();

setup.equipment[0].quantity = 1;
equipment.setSlot(13, -1, 0);
assert.deepEqual(equipment.getSlots()[13], { slot: 13, itemId: -1, quantity: 0 });
markup = render();
assert.ok(markup.includes("Still missing") && markup.includes("Item X × 1"), "an empty equipment slot supplies nothing");
assert.ok(!markup.includes(allAvailable), "an empty slot is not an item on hand");

equipment.setSlot(13, itemX, 0);
inventory.setSlot(0, itemX, 1);
markup = render();
assert.ok(markup.includes("Need 1 more"), "the depleted equipment slot still needs an item");
assert.ok(markup.includes(allAvailable), "the inventory item supplies the requirement");

inventory.setSlot(0, itemY, 1);
equipment.setSlot(13, -1, 0);
markup = render();
assert.ok(markup.includes("Still missing"), "an unrelated item cannot satisfy the requirement");
assert.ok(markup.includes("Item X × 1"), "the shortage identifies the required item and quantity");
assert.ok(!markup.includes(allAvailable), "an unrelated item is not counted as the required item");

inventory.clear();
equipment.setSlot(13, itemX, 0);
assert.deepEqual(equipment.getSlots()[13], { slot: 13, itemId: itemX, quantity: 0 });
assert.ok(inventory.getSlots().every((slot) => slot.itemId < 0));
assert.equal(receiver.getBankCounts().size, 0);
assert.equal(receiver.isBankOpen(), true);
markup = render();
assert.ok(markup.includes("Need 1 more"), "the equipment row reports the shortfall");
assert.ok(markup.includes("Still missing"), "zero equipment quantity does not satisfy the summary");
assert.ok(markup.includes("Item X × 1"), "the summary reports the missing item and quantity");
assert.ok(!markup.includes(allAvailable), "zero equipment quantity is not an item on hand");
