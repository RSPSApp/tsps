// Run after `yarn build`: node --test tests/blood-fury.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { CombatMethod } = require("../dist/game/content/combat/method/CombatMethod");
const { Misc } = require("../dist/util/Misc");

const BloodFury = require("../plugins/items/AmuletOfBloodFury.plugin");

const itemOnItem = new Map();
let itemAction;
let resolver;

const baseMethod = new CombatMethod();
baseMethod.type = () => CombatType.MELEE;
baseMethod.handleAfterHitEffects = () => {};

BloodFury.register({
  getBonusManager: () => ({ update() {} }),
  getCombatFactory: () => ({ MELEE_COMBAT: baseMethod }),
  onItemOnItem: (first, second, handler) => itemOnItem.set(`${first}>${second}`, handler),
  onItemAction: (handler) => { itemAction = handler; },
  registerCombatMethodResolver: (registered) => { resolver = registered; },
});

function container(capacity) {
  const items = new Array(capacity).fill(null);
  return {
    getItems: () => items,
    get: (slot) => items[slot],
    set: (slot, item) => { items[slot] = item; },
    setItem: (slot, item) => { items[slot] = item; },
    deleteAtSlot: (slot) => { items[slot] = null; },
    refreshItems() {},
    getAmount: (id) => items.reduce(
      (total, item) => total + (item?.getId?.() === id ? item.getAmount?.() ?? 1 : 0),
      0,
    ),
    deleteNumber: (id, amount) => {
      let left = amount;
      for (const item of items) {
        if (left <= 0 || item?.getId?.() !== id) continue;
        const held = item.getAmount?.() ?? 1;
        const taken = Math.min(left, held);
        left -= taken;
        if (taken < held) item.setAmount(held - taken);
        else item.setId(-1);
      }
    },
  };
}

function createPlayer() {
  return {
    messages: [],
    healed: 0,
    inventory: container(28),
    equipment: container(14),
    getInventory() { return this.inventory; },
    getEquipment() { return this.equipment; },
    sendMessage(message) { this.messages.push(message); },
    heal(amount) { this.healed += amount; },
    getUpdateFlag: () => ({ flag() {} }),
    getCombat: () => ({ getCastSpell: () => null, getAutocastSpell: () => null, getRangedWeapon: () => null }),
    isSpecialActivated: () => false,
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function charges(item) {
  return item.getMetaValue("blood-fury")?.charges;
}

function useShard(player, fury, shard, named) {
  itemOnItem.get(named)({
    player,
    usedItem: fury,
    usedWithItem: shard,
    usedItemId: fury.getId(),
    usedWithItemId: shard.getId(),
  });
}

test("a blood shard makes an amulet of blood fury with 10,000 charges", () => {
  const player = createPlayer();
  const fury = new Item(ItemIdentifiers.AMULET_OF_FURY, 1);
  const shard = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  player.inventory.setItem(0, fury);
  player.inventory.setItem(1, shard);

  useShard(player, fury, shard, "Blood shard>Amulet of fury");

  assert.equal(fury.getId(), ItemIdentifiers.AMULET_OF_BLOOD_FURY);
  assert.equal(charges(fury), 10000);
  assert.equal(shard.getId(), -1, "the shard is consumed");
});

test("charging stops at 30,000 and reverting returns a plain amulet of fury", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 10000 } });
  player.inventory.setItem(0, amulet);
  player.inventory.setItem(1, new Item(ItemIdentifiers.BLOOD_SHARD, 3));

  const shard = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  useShard(player, amulet, shard, "Blood shard>Amulet of blood fury");
  assert.equal(charges(amulet), 30000);

  player.inventory.setItem(2, new Item(ItemIdentifiers.BLOOD_SHARD, 1));
  const extra = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  useShard(player, amulet, extra, "Blood shard>Amulet of blood fury");
  assert.equal(charges(amulet), 30000);
  assert.match(player.messages.at(-1), /cannot hold any more charges/);

  itemAction({
    player,
    item: amulet,
    itemId: amulet.getId(),
    clickType: 3,
    interfaceId: Equipment.INVENTORY_INTERFACE_ID,
  });
  assert.equal(amulet.getId(), ItemIdentifiers.AMULET_OF_FURY);
  assert.equal(charges(amulet), undefined);
});

test("hits spend one charge each and the 25% heal is 30% of the damage", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 5 } });
  player.equipment.set(Equipment.AMULET_SLOT, amulet);
  const method = resolver.resolve(player);
  assert.ok(method, "a melee attack with the amulet uses the wrapped method");

  const hit = (damages) => ({
    getAttacker: () => player,
    getHits: () => damages.map((damage) => ({ getDamage: () => damage })),
  });
  const originalRandom = Misc.getRandom;
  try {
    Misc.getRandom = () => 1;
    method.handleAfterHitEffects(hit([20]));
    assert.equal(charges(amulet), 4, "one damaging hit spends one charge");
    assert.equal(player.healed, 0, "no heal on the 3-in-4 miss");

    method.handleAfterHitEffects(hit([0]));
    assert.equal(charges(amulet), 4, "a zero hit spends nothing");

    Misc.getRandom = () => 0;
    method.handleAfterHitEffects(hit([20]));
    assert.equal(charges(amulet), 3);
    assert.equal(player.healed, 6, "floor(20 * 30%)");

    amulet.setMetaValue("blood-fury", { charges: 1 });
    method.handleAfterHitEffects(hit([10]));
    assert.equal(amulet.getId(), ItemIdentifiers.AMULET_OF_FURY, "the last charge reverts the amulet");
    assert.match(player.messages.at(-1), /run out of charges/);
  } finally {
    Misc.getRandom = originalRandom;
  }
});
