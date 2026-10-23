// Run after `yarn build`: node --test tests/ring-of-wealth-coins.test.cjs
// Wiki, Ring of wealth: a worn ring collects coins dropped by monsters (#748: coins went to the
// pack without one).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

// Item definitions normally come from the cache; coins are all this test drops.
ItemDefinition.forId = () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true });

const COINS = 995;
const RING_OF_WEALTH_5 = 11980;
const grounded = [];
const noop = () => undefined;
NpcDrops.register(new Proxy({
  core: {},
  getItemOnGroundManager: () => ({ registerLocation: (_player, item) => grounded.push(item.getId()) }),
}, { get: (target, key) => (key in target ? target[key] : noop) }));

function coinsGoTo(ringId, attributes = {}) {
  const pack = [];
  grounded.length = 0;
  const player = {
    getEquipment: () => ({ get: () => (ringId ? { getId: () => ringId } : null) }),
    getInventory: () => ({ contains: () => false, getFreeSlots: () => 28, adds: (id) => pack.push(id) }),
    getAttribute: (key) => attributes[key],
  };
  NpcDrops.__internals.placeDrops(player, [{ itemId: COINS, amount: 25 }], null);
  return pack.includes(COINS) ? "pack" : grounded.includes(COINS) ? "ground" : "nowhere";
}

test("coins drop to the ground without a ring of wealth", () => {
  assert.equal(coinsGoTo(null), "ground");
});

test("a worn ring of wealth collects them, unless Coin collection is off", () => {
  assert.equal(coinsGoTo(RING_OF_WEALTH_5), "pack");
  assert.equal(coinsGoTo(RING_OF_WEALTH_5, { "ring-of-wealth-auto-collect": false }), "ground");
});
