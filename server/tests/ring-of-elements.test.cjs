// Run after `yarn build`: node --test tests/ring-of-elements.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Ring = require("../plugins/items/RingOfElements.plugin");

const items = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);
const byId = new Map(items.map((item) => [item.id, item]));

function createPlayer() {
  const attributes = new Map();
  const messages = [];
  const deleted = [];
  let hasRunes = true;
  const player = {
    attributes,
    deleted,
    messages,
    setHasRunes: (value) => { hasRunes = value; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      contains: () => hasRunes,
      deleteNumber: (id, amount) => deleted.push([id, amount]),
      refreshItems: () => {},
    }),
    getEquipment: () => ({ refreshItems: () => {} }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

const ringItem = (id) => ({
  id,
  getId() { return this.id; },
  setId(value) { this.id = value; },
});

test("the ring of the elements has both ids and they are rings", () => {
  const uncharged = byId.get(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  const charged = byId.get(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  assert.equal(uncharged?.equipmentType, "RING");
  assert.equal(charged?.equipmentType, "RING");
  assert.equal(uncharged?.tradeable, true, "uncharged rings are tradeable");
  assert.equal(charged?.tradeable, false, "charged rings are untradeable");
  assert.deepEqual(uncharged?.bonuses, new Array(14).fill(0));
});

test("teleport destinations match the Wiki", () => {
  const byLabel = new Map(Ring._test.TELEPORTS.map(({ label, destination }) => [
    label,
    [destination.getX(), destination.getY(), destination.getZ()],
  ]));
  assert.deepEqual(byLabel.get("Air Altar"), [2981, 3276, 0]);
  assert.deepEqual(byLabel.get("Water Altar"), [3170, 3155, 0]);
  assert.deepEqual(byLabel.get("Earth Altar"), [3288, 3468, 0]);
  assert.deepEqual(byLabel.get("Fire Altar"), [3314, 3279, 0]);
  assert.deepEqual(
    Ring._test.WORN_ACTIONS.map((action) => (action.type === "last" ? "last" : action.teleport.label)),
    ["last", "Air Altar", "Water Altar", "Earth Altar", "Fire Altar"]
  );
});

test("charges are per player, capped at 10,000, and drive the ring's id", () => {
  const player = createPlayer();
  assert.equal(Ring._test.getCharges(player), 0);
  Ring._test.setCharges(player, 5);
  assert.equal(Ring._test.getCharges(player), 5);
  Ring._test.setCharges(player, 99999);
  assert.equal(Ring._test.getCharges(player), Ring._test.MAX_CHARGES);
  const item = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  Ring._test.syncRing(player, item, 5);
  assert.equal(item.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  Ring._test.syncRing(player, item, 0);
  assert.equal(item.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS);
});

test("a charge consumes one of each elemental rune and one law rune", () => {
  const player = createPlayer();
  const item = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  assert.equal(Ring._test.handleChargeAttempt(player, item), true);
  assert.equal(Ring._test.getCharges(player), 1);
  assert.equal(item.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS_4, "the ring becomes charged");
  const consumed = player.deleted.map(([id]) => id).sort((a, b) => a - b);
  assert.deepEqual(consumed, [
    ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE,
    ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.LAW_RUNE,
  ].sort((a, b) => a - b));

  player.setHasRunes(false);
  assert.equal(Ring._test.handleChargeAttempt(player, item), false);
  assert.equal(Ring._test.getCharges(player), 1, "no runes, no charge");
  assert.match(player.messages.at(-1), /one of each elemental rune/);
});
