// Run after `yarn build`: node --test tests/ring-of-wealth-coins.test.cjs
// Wiki, Ring of wealth: a worn ring collects coins dropped by monsters (#748: coins went to the
// pack without one).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Item } = require("../dist/game/model/Item");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

before(async () => CachePipeline.initialize(require("node:path").resolve(__dirname, "..")));

const COINS = 995;
const RING_OF_WEALTH_5 = 11980;
const grounded = [];
const noop = () => undefined;
NpcDrops.register(new Proxy({
  core: {},
  getItemOnGroundManager: () => ({ registerLocation: (_player, item) => grounded.push({ id: item.getId(), amount: item.getAmount() }) }),
}, { get: (target, key) => (key in target ? target[key] : noop) }));

function killer(ringId = RING_OF_WEALTH_5, attributes = {}) {
  const player = new Player(new PlayerSession({ kind: "test", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} }));
  if (ringId) player.getEquipment().setItem(Equipment.RING_SLOT, new Item(ringId, 1));
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  return player;
}
function place(player, amount = 25) {
  grounded.length = 0;
  NpcDrops.__internals.placeDrops(player, [{ itemId: COINS, amount }], null);
}
function coinsGoTo(ringId, attributes = {}) {
  const player = killer(ringId, attributes);
  place(player);
  return player.getInventory().getAmount(COINS) > 0 ? "pack"
    : grounded.some((drop) => drop.id === COINS) ? "ground" : "nowhere";
}

test("coins drop to the ground without a ring of wealth", () => {
  assert.equal(coinsGoTo(null), "ground");
});

test("a worn ring of wealth collects them, unless Coin collection is off", () => {
  assert.equal(coinsGoTo(RING_OF_WEALTH_5), "pack");
  assert.equal(coinsGoTo(RING_OF_WEALTH_5, { "ring-of-wealth-auto-collect": false }), "ground");
});

for (const headroom of [0, 10, 25]) {
  test(`real coin stack with ${headroom} capacity collects only what fits and grounds the exact remainder`, () => {
    const MAX = 2147483647;
    const player = killer();
    const inventory = player.getInventory();
    inventory.adds(COINS, MAX - headroom);
    place(player);
    const collected = Math.min(headroom, 25);
    assert.equal(inventory.getAmount(COINS), MAX - headroom + collected);
    assert.deepEqual(grounded, collected === 25 ? [] : [{ id: COINS, amount: 25 - collected }]);
    assert.equal(inventory.getAmount(COINS) - (MAX - headroom)
      + grounded.reduce((sum, drop) => sum + drop.amount, 0), 25, "every dropped coin is conserved");
  });
}

for (const full of [false, true]) {
  test(`preset coins are unchanged when the real inventory is ${full ? "full" : "open"}`, () => {
    const player = killer();
    const inventory = player.getInventory();
    const preset = new Item(COINS, 100).setMetaValue(Item.PRESET_META, true);
    inventory.setItem(0, preset);
    if (full) for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new Item(1511, 1));
    place(player);
    assert.equal(inventory.get(0), preset);
    assert.equal(preset.getAmount(), 100);
    assert.equal(preset.isPresetItem(), true);
    const plain = inventory.getItems().filter((item) => item.getId() === COINS && item.getMeta() == null)
      .reduce((sum, item) => sum + item.getAmount(), 0);
    assert.equal(plain, full ? 0 : 25);
    assert.deepEqual(grounded, full ? [{ id: COINS, amount: 25 }] : []);
    assert.equal(plain + grounded.reduce((sum, drop) => sum + drop.amount, 0), 25);
  });
}
