// Run after `yarn build`: node --test tests/rune-pouch.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

const RunePouch = require("../plugins/items/RunePouch.plugin");

// Item definitions normally come from the cache; stub the runes the pouch stores and
// the two pouches themselves.
const DEFINITIONS = new Map([
  [Items.AIR_RUNE, { name: "Air rune", stackable: true }],
  [Items.WATER_RUNE, { name: "Water rune", stackable: true }],
  [Items.EARTH_RUNE, { name: "Earth rune", stackable: true }],
  [Items.FIRE_RUNE, { name: "Fire rune", stackable: true }],
  [Items.MIND_RUNE, { name: "Mind rune", stackable: true }],
  [Items.RUNE_POUCH, { name: "Rune pouch", stackable: false }],
  [Items.DIVINE_RUNE_POUCH, { name: "Divine rune pouch", stackable: false }],
]);
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS.get(id) ?? { name: "null" };
  return {
    getName: () => def.name,
    isStackable: () => def.stackable === true,
    isNoted: () => def.noted === true,
    unNote: () => id,
    getPlaceholderId: () => -1,
    isTradeable: () => true,
  };
};

// The real plugin, wired through the real PluginManager so PluginManager's spell rune
// source registration and dispatch are exercised too.
RunePouch.register(PluginManager.createApi("RunePouchTest"));

function createInventory(initial = []) {
  const items = initial;
  return {
    getValidItems: () => items.filter((item) => item.getId() > 0 && item.getAmount() > 0),
    getAmount(id) {
      return items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0);
    },
    contains(id) {
      return items.some((item) => item.getId() === id && item.getAmount() > 0);
    },
    getFreeSlots() {
      return 28 - items.filter((item) => item.getId() > 0 && item.getAmount() > 0).length;
    },
    add(item) {
      if (item.getDefinition().isStackable()) {
        const stack = items.find((entry) => entry.getId() === item.getId());
        if (stack) {
          stack.setAmount(stack.getAmount() + item.getAmount());
          return this;
        }
      }
      if (this.getFreeSlots() > 0) items.push(item.clone());
      return this;
    },
    deleteNumber(id, amount) {
      let left = amount;
      for (const item of [...items]) {
        if (left <= 0) break;
        if (item.getId() !== id) continue;
        const taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        if (item.getAmount() <= 0) items.splice(items.indexOf(item), 1);
      }
      return this;
    },
    deletes(item) {
      return this.deleteNumber(item.getId(), item.getAmount());
    },
    refreshItems() {
      return this;
    },
  };
}

function createPlayer(inventoryItems = []) {
  const inventory = createInventory(inventoryItems);
  const equipment = Array.from({ length: 14 }, () => new Item(-1, 0));
  const attributes = new Map();
  const player = {
    messages: [],
    enteredAmountAction: null,
    sendMessage(message) {
      player.messages.push(message);
    },
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => equipment, containsAllItem: () => true }),
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ setCastSpell() {}, reset() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    setEnteredAmountAction(action) {
      player.enteredAmountAction = action;
    },
    getPacketSender: () => ({ sendEnterAmountPrompt() {} }),
  };
  return player;
}

function useItemOnItem(player, usedItem, usedWithItem) {
  return PluginManager.emitItemOnItem({
    player,
    usedItem,
    usedItemId: usedItem.getId(),
    usedItemSlot: 0,
    usedWithItem,
    usedWithItemId: usedWithItem.getId(),
    usedWithItemSlot: 0,
    handled: false,
  });
}

test("a rune pouch holds 16,000 of three rune types", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  assert.equal(RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 16000), 16000);
  assert.equal(RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 1), 0, "per-type cap");
  assert.equal(RunePouch._test.storeRune(pouch, Items.WATER_RUNE, 16000), 16000);
  assert.equal(RunePouch._test.storeRune(pouch, Items.FIRE_RUNE, 16000), 16000);
  assert.equal(RunePouch._test.storeRune(pouch, Items.EARTH_RUNE, 1), 0, "three types only");
  assert.deepEqual(RunePouch._test.storedRunes(pouch), {
    [Items.AIR_RUNE]: 16000,
    [Items.WATER_RUNE]: 16000,
    [Items.FIRE_RUNE]: 16000,
  });

  const partial = new Item(Items.RUNE_POUCH, 1);
  assert.equal(RunePouch._test.storeRune(partial, Items.AIR_RUNE, 15990), 15990);
  assert.equal(RunePouch._test.storeRune(partial, Items.AIR_RUNE, 100), 10, "only what fits is stored");
});

test("a divine rune pouch holds a fourth rune type", () => {
  const pouch = new Item(Items.DIVINE_RUNE_POUCH, 1);
  for (const id of [Items.AIR_RUNE, Items.WATER_RUNE, Items.EARTH_RUNE, Items.FIRE_RUNE]) {
    assert.equal(RunePouch._test.storeRune(pouch, id, 16000), 16000);
  }
  assert.equal(RunePouch._test.storeRune(pouch, Items.MIND_RUNE, 1), 0, "four types only");
});

test("using a rune stack on the pouch prompts and stores only what the inventory holds", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch, new Item(Items.AIR_RUNE, 5)]);

  assert.equal(useItemOnItem(player, player.getInventory().getValidItems()[1], pouch), true);
  assert.ok(player.enteredAmountAction, "a stack asks how many to store");
  player.enteredAmountAction.execute(3);

  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.AIR_RUNE]: 3 });
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 2);
});

test("using a single rune on the pouch stores it without a prompt", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch, new Item(Items.MIND_RUNE, 1)]);

  assert.equal(useItemOnItem(player, player.getInventory().getValidItems()[1], pouch), true);
  assert.equal(player.enteredAmountAction, null);
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.MIND_RUNE]: 1 });
  assert.equal(player.getInventory().getAmount(Items.MIND_RUNE), 0);
});

test("using a non-rune on the pouch is left alone", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch, new Item(Items.COINS, 1)]);

  assert.equal(useItemOnItem(player, player.getInventory().getValidItems()[1], pouch), false);
  assert.deepEqual(RunePouch._test.storedRunes(pouch), {});
});

test("Open reports the contents and Empty returns them to the inventory", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 1500);
  RunePouch._test.storeRune(pouch, Items.MIND_RUNE, 2);
  const player = createPlayer([pouch]);

  RunePouch._test.openPouch({ player, item: pouch });
  assert.equal(player.messages.at(-1), "Your rune pouch contains 1500 x Air rune, 2 x Mind rune.");

  RunePouch._test.emptyPouch({ player, item: pouch });
  assert.deepEqual(RunePouch._test.storedRunes(pouch), {});
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 1500);
  assert.equal(player.getInventory().getAmount(Items.MIND_RUNE), 2);
  assert.equal(player.messages.at(-1), "You empty your rune pouch.");
});

test("Open on an empty pouch says so", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  RunePouch._test.openPouch({ player, item: pouch });
  assert.equal(player.messages.at(-1), "Your rune pouch is empty.");
});

test("Empty with no room keeps the runes and says so", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 10);
  const player = createPlayer([pouch, ...Array.from({ length: 27 }, () => new Item(Items.COINS, 1))]);

  RunePouch._test.emptyPouch({ player, item: pouch });
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.AIR_RUNE]: 10 });
  assert.equal(player.messages.at(-1), "You don't have enough inventory space.");
});

test("Empty moves what fits and keeps the rest", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 10);
  RunePouch._test.storeRune(pouch, Items.WATER_RUNE, 20);
  const player = createPlayer([pouch, ...Array.from({ length: 26 }, () => new Item(Items.COINS, 1))]);

  RunePouch._test.emptyPouch({ player, item: pouch });
  assert.equal(player.getInventory().getAmount(Items.WATER_RUNE), 20, "the first stored rune fills the one free slot");
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.AIR_RUNE]: 10 });
  assert.equal(player.messages.at(-1), "You empty some of the runes from your rune pouch.");
});

test("casting Wind Strike spends pouch runes when the inventory has none", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 1);
  RunePouch._test.storeRune(pouch, Items.MIND_RUNE, 1);
  const player = createPlayer([pouch]);

  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), true);
  assert.deepEqual(RunePouch._test.storedRunes(pouch), {});
  assert.equal(player.messages.includes("You do not have the required items to cast this spell."), false);
});

test("casting spends inventory runes first and the pouch only for the shortfall", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.MIND_RUNE, 2);
  const player = createPlayer([pouch, new Item(Items.AIR_RUNE, 1)]);

  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), true);
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 0, "the inventory air rune is spent");
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.MIND_RUNE]: 1 }, "one mind rune came from the pouch");
});

test("a pouch holding only part of the requirement fails the cast without consuming anything", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 10);
  const player = createPlayer([pouch]);

  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, false), false);
  assert.equal(player.messages.at(-1), "You do not have the required items to cast this spell.");
  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), false);
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.AIR_RUNE]: 10 });
});

test("a cast the inventory can fully pay for never touches the pouch", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.AIR_RUNE, 10);
  RunePouch._test.storeRune(pouch, Items.MIND_RUNE, 10);
  const player = createPlayer([pouch, new Item(Items.AIR_RUNE, 1), new Item(Items.MIND_RUNE, 1)]);

  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), true);
  assert.deepEqual(RunePouch._test.storedRunes(pouch), { [Items.AIR_RUNE]: 10, [Items.MIND_RUNE]: 10 });
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 0);
  assert.equal(player.getInventory().getAmount(Items.MIND_RUNE), 0);
});

test("pouch contents live in item meta, so banks and trades carry them", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  RunePouch._test.storeRune(pouch, Items.WATER_RUNE, 500);

  // Trading.ts moves item.clone(); the save file round-trips the meta as JSON.
  const traded = pouch.clone();
  const hydrated = new Item(pouch.getId(), 1, JSON.parse(JSON.stringify(pouch.getMeta())));
  assert.deepEqual(RunePouch._test.storedRunes(traded), { [Items.WATER_RUNE]: 500 });
  assert.deepEqual(RunePouch._test.storedRunes(hydrated), { [Items.WATER_RUNE]: 500 });
});
