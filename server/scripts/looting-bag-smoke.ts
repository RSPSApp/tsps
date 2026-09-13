import { strict as assert } from "assert";

const LootingBag = require("../plugins/items/LootingBag.plugin");
const { Item } = require("../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../src/main/typescript/elvarg/game/definition/ItemDefinition");

ItemDefinition.forId = (id: number) => ({
  getValue: () => 500,
  getName: () => id === 4151 ? "Abyssal whip" : "Dragon dagger",
  isTradeable: () => true,
  isStackable: () => id === 995,
});

let itemActionHandler: any;
let itemOnItemHandler: any;
let itemPickupHandler: any;
let canBankHandler: any;
let deathDropHandler: any;

LootingBag.register({
  persistAttribute: () => undefined,
  registerCustomInterface: () => undefined,
  onItemAction: (handler: any) => (itemActionHandler = handler),
  onInterfaceActionButton: () => undefined,
  onItemOnItem: (handler: any) => (itemOnItemHandler = handler),
  onItemPickup: (handler: any) => (itemPickupHandler = handler),
  onCanBank: (handler: any) => (canBankHandler = handler),
  onPlayerDeathItemDrop: (handler: any) => (deathDropHandler = handler),
  sendMultiChatboxPrompt: () => true,
});

assert.ok(itemActionHandler, "Item action handler must be registered");
assert.ok(itemOnItemHandler, "Item on item handler must be registered");
assert.ok(itemPickupHandler, "Item pickup handler must be registered");
assert.ok(canBankHandler, "Can bank handler must be registered");
assert.ok(deathDropHandler, "Death drop handler must be registered");

// Test bag detection
assert.strictEqual(LootingBag._test.isLootingBag(11941), true);
assert.strictEqual(LootingBag._test.isLootingBag(22586), true);
assert.strictEqual(LootingBag._test.isLootingBag(4151), false);
assert.strictEqual(LootingBag._test.isOpenBag(22586), true);
assert.strictEqual(LootingBag._test.isOpenBag(11941), false);

// Mock player state
const attributes = new Map<string, any>();
const messages: string[] = [];
const mockPlayer: any = {
  getAttribute: (key: string) => attributes.get(key),
  setAttribute: (key: string, val: any) => attributes.set(key, val),
  getPacketSender: () => ({
    sendMessage: (m: string) => messages.push(m),
    sendSubInterface: () => undefined,
    sendItemOnInterface: () => undefined,
    clearItemOnInterface: () => undefined,
    sendInterfaceDisplayState: () => undefined,
    sendString: () => undefined,
    sendInterfaceRemoval: () => undefined,
    closeSubInterface: () => undefined,
  }),
  getInventory: () => ({
    getItems: () => [],
    getValidItems: () => [],
    deleteAtSlot: () => undefined,
    refreshItems: () => undefined,
  }),
};

// Test get/set bag items
assert.deepStrictEqual(LootingBag._test.getBagItems(mockPlayer), []);
LootingBag._test.setBagItems(mockPlayer, [{ id: 4151, amount: 1 }]);
assert.deepStrictEqual(LootingBag._test.getBagItems(mockPlayer), [{ id: 4151, amount: 1 }]);
assert.strictEqual(LootingBag._test.totalBagValue(mockPlayer), 500);

console.log("looting bag smoke test passed");
