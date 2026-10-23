// Run after `yarn build`: node --test tests/trident.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Trident = require("../plugins/items/Trident.plugin");
const actions = new Map();
Trident.register({
  core: PluginManager.getCoreApi(),
  onItemAction: (name, itemActions) => actions.set(name, itemActions),
  onItemOnItem() {},
});

function makePlayer(trident, resources = {}) {
  const items = [trident];
  const amounts = new Map(Object.entries(resources).map(([id, amount]) => [Number(id), amount]));
  const messages = [];
  const inventory = {
    getItems: () => items,
    getAmount: (id) => amounts.get(id) ?? 0,
    deleteNumber(id, amount) {
      amounts.set(id, Math.max(0, this.getAmount(id) - amount));
      return true;
    },
    contains: (id) => (amounts.get(id) ?? 0) > 0,
    getFreeSlots: () => 28,
    addItem(item) {
      amounts.set(item.getId(), this.getAmount(item.getId()) + item.getAmount());
    },
    refreshItems() {},
  };
  const equipment = { getItems: () => [], refreshItems() {} };
  const player = {
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (message) => messages.push(message),
  };
  return { player, inventory, amounts, messages };
}

function resourceAmount(player, id) {
  return player.amounts.get(id) ?? 0;
}

test("both tridents charge from any required rune or their variant resource", () => {
  const cases = [
    {
      recipe: Trident._test.RECIPES[0],
      resourceId: ItemIdentifiers.DEATH_RUNE,
      primaryAmount: 30,
      expectedCharges: 3,
    },
    {
      recipe: Trident._test.RECIPES[1],
      resourceId: ItemIdentifiers.FIRE_RUNE,
      primaryAmount: 4,
      expectedCharges: 4,
    },
  ];

  for (const { recipe, resourceId, primaryAmount, expectedCharges } of cases) {
    const trident = new Item(recipe.unchargedId);
    const { player, inventory, amounts } = makePlayer(trident, {
      [ItemIdentifiers.DEATH_RUNE]: 4,
      [ItemIdentifiers.CHAOS_RUNE]: 4,
      [ItemIdentifiers.FIRE_RUNE]: 20,
      [recipe.primaryResourceId]: primaryAmount,
    });
    const event = {
      player,
      usedItemId: resourceId,
      usedWithItemId: recipe.unchargedId,
      usedItem: new Item(resourceId),
      usedWithItem: trident,
      usedItemSlot: 1,
      usedWithItemSlot: 0,
    };

    Trident._test.chargeWithResources(event);

    assert.equal(event.handled, true);
    assert.equal(trident.getId(), recipe.chargedId);
    assert.equal(Trident._test.getCharges(trident), expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.DEATH_RUNE), 4 - expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.CHAOS_RUNE), 4 - expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.FIRE_RUNE), 20 - expectedCharges * 5);
    assert.equal(resourceAmount({ amounts }, recipe.primaryResourceId), primaryAmount - expectedCharges * recipe.primaryPerCharge);
    assert.equal(inventory.getItems()[0], trident);
  }
});

test("uncharging restores runes and swamp scales but not sea-trident coins", () => {
  for (const recipe of Trident._test.RECIPES) {
    const trident = new Item(recipe.chargedId, 1, {
      [Trident._test.TRIDENT_CHARGE_META_KEY]: 12,
    });
    const { player, amounts, messages } = makePlayer(trident);

    assert.equal(Trident._test.unchargeTrident({ player, item: trident }), true);
    assert.equal(trident.getId(), recipe.unchargedId);
    assert.equal(Trident._test.getCharges(trident), 0);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.DEATH_RUNE), 12);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.CHAOS_RUNE), 12);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.FIRE_RUNE), 60);
    assert.equal(
      resourceAmount({ amounts }, ItemIdentifiers.ZULRAHS_SCALES),
      recipe === Trident._test.RECIPES[1] ? 12 : 0
    );
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.COINS), 0);
    assert.match(messages.at(-1), /uncharge/i);
  }
});

test("named inventory actions expose Charge, Check, and Uncharge", () => {
  assert.equal(typeof actions.get("Uncharged trident").Charge, "function");
  assert.equal(typeof actions.get("Trident of the Seas").Check, "function");
  assert.equal(typeof actions.get("Trident of the Seas").Uncharge, "function");
  assert.equal(typeof actions.get("Uncharged toxic trident").Charge, "function");
  assert.equal(typeof actions.get("Trident of the Swamp").Check, "function");
  assert.equal(typeof actions.get("Trident of the Swamp").Uncharge, "function");
});
