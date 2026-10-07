// Run after `yarn build`: node --test tests/ornament-kits.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const OrnamentKits = require("../plugins/items/OrnamentKits.plugin");

let itemOnItem = null;
OrnamentKits.register({
  core: { GameConstants: { DEFINITIONS_DIRECTORY: path.join(__dirname, "..", "data", "definitions") } },
  onItemOnItem: (handler) => { itemOnItem = handler; },
  log() {},
});

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
  };
}

function createPlayer(items) {
  const messages = [];
  return {
    messages,
    getInventory: () => ({
      deleteNumber: (id, amount) => {
        const index = items.findIndex((entry) => entry.getId() === id);
        if (index >= 0) items.splice(index, 1);
        void amount;
      },
      refreshItems: () => {},
    }),
    sendMessage: (message) => messages.push(message),
  };
}

test("the ornament kit table maps kits to their base and result items", () => {
  const kits = OrnamentKits._test.loadKits();
  assert.equal(kits.length, 23);
  const runeDefender = kits.find((entry) => entry.name === "Rune defender ornament kit");
  assert.deepEqual([runeDefender.kit, runeDefender.base, runeDefender.result], [23227, 8850, 23230]);
  const dragonHelm = kits.find((entry) => entry.name === "Dragon full helm ornament kit");
  assert.deepEqual([dragonHelm.kit, dragonHelm.base, dragonHelm.result], [12538, 11335, 12417]);
});

test("using a kit consumes it and transforms the base item", () => {
  const kit = item(23227);
  const defender = item(8850);
  const items = [kit, defender];
  const player = createPlayer(items);
  const event = { player, usedItem: kit, usedWithItem: defender, usedItemId: 23227, usedWithItemId: 8850, handled: false };
  itemOnItem(event);
  assert.equal(event.handled, true);
  assert.equal(defender.getId(), 23230);
  assert.equal(items.length, 1, "the kit is consumed");
  assert.match(player.messages[0], /apply the rune defender ornament kit/);
});

test("a kit does not work on the wrong item, and noted kits are filtered", () => {
  const kit = item(12538);
  const dragonScimitar = item(4587);
  const player = createPlayer([kit, dragonScimitar]);
  const event = { player, usedItem: kit, usedWithItem: dragonScimitar, usedItemId: 12538, usedWithItemId: 4587, handled: false };
  itemOnItem(event);
  assert.equal(event.handled, false);
  assert.equal(dragonScimitar.getId(), 4587);
});
