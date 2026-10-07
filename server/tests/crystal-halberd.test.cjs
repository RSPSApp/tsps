// Run after `yarn build`: node --test tests/crystal-halberd.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const CrystalHalberd = require("../plugins/items/CrystalHalberd.plugin");

let cycle = 1;
const itemActions = new Map();
CrystalHalberd.attach({
  core: {
    Equipment,
    ItemIds,
    ItemIdentifiers: require("../dist/util/ItemIdentifiers").ItemIdentifiers,
    World: { getProcessCycle: () => cycle },
  },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onItemOnItem() {},
  onCombatHitResolved() {},
});

function item(id, amount = 1) {
  const value = {
    id,
    amount,
    meta: {},
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getAmount() { return this.amount; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, next) {
      if (next === undefined) delete this.meta[key];
      else this.meta[key] = next;
    },
  };
  return value;
}

function createPlayer(weapon = null, inventory = []) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  const items = inventory;
  const attributes = new Map();
  const messages = [];
  return {
    messages,
    getEquipment: () => ({
      getItems: () => equipment,
      refreshItems: () => {},
    }),
    getInventory: () => ({
      getItems: () => items,
      getAmount: (id) => items.reduce((sum, entry) => sum + (entry?.getId() === id ? entry.getAmount() : 0), 0),
      deleteNumber: (id, amount) => {
        const entry = items.find((candidate) => candidate?.getId() === id);
        if (entry) entry.amount = Math.max(0, entry.amount - amount);
      },
      refreshItems: () => {},
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function hit({ accurate = true, damage = 5 } = {}) {
  return { isAccurate: () => accurate, getTotalDamage: () => damage };
}

function strike(player, options) {
  CrystalHalberd._test.onHitResolved({ attacker: player, target: {}, hit: hit(options) });
}

test("charges start at 2,500 and one is spent per successful hit", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD);
  const player = createPlayer(halberd);
  assert.equal(CrystalHalberd.charges(halberd), 2500);
  cycle = 1;
  strike(player);
  assert.equal(CrystalHalberd.charges(halberd), 2499);
  cycle = 2;
  strike(player);
  assert.equal(CrystalHalberd.charges(halberd), 2498);
});

test("a miss or a zero-damage hit does not spend a charge", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD);
  const player = createPlayer(halberd);
  cycle = 3;
  strike(player, { accurate: false });
  cycle = 4;
  strike(player, { damage: 0 });
  assert.equal(CrystalHalberd.charges(halberd), 2500);
});

test("a multi-hit special spends a single charge", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD);
  const player = createPlayer(halberd);
  cycle = 5;
  strike(player);
  strike(player);
  assert.equal(CrystalHalberd.charges(halberd), 2499);
  cycle = 6;
  strike(player);
  assert.equal(CrystalHalberd.charges(halberd), 2498);
});

test("the halberd goes inactive at zero and an inactive one spends nothing", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD);
  halberd.setMetaValue("crystal-halberd", { charges: 1 });
  const player = createPlayer(halberd);
  cycle = 7;
  strike(player);
  assert.equal(halberd.getId(), ItemIds.CRYSTAL_HALBERD_INACTIVE_);
  assert.match(player.messages.at(-1), /run out of charges/);

  cycle = 8;
  strike(player);
  assert.equal(halberd.getId(), ItemIds.CRYSTAL_HALBERD_INACTIVE_);
  assert.equal(CrystalHalberd.charges(halberd), 0);
});

test("crystal shards recharge an inactive halberd, 100 charges each", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD_INACTIVE_);
  const shard = item(ItemIds.CRYSTAL_SHARD, 3);
  const player = createPlayer(null, [shard]);
  const event = {
    player,
    usedItem: halberd,
    usedWithItem: shard,
    usedItemId: halberd.getId(),
    usedWithItemId: shard.getId(),
    handled: false,
  };
  CrystalHalberd._test.addShardCharges(event);
  assert.equal(event.handled, true);
  assert.equal(halberd.getId(), ItemIds.CRYSTAL_HALBERD);
  assert.equal(shard.getAmount(), 0);
  assert.equal(CrystalHalberd.charges(halberd), 300);
});

test("the Check action reports the remaining charges", () => {
  const halberd = item(ItemIds.CRYSTAL_HALBERD);
  const player = createPlayer(halberd);
  itemActions.get("Crystal halberd").Check({ player, item: halberd });
  assert.equal(player.messages[0], "Your crystal halberd has 2,500 charges left.");
});
