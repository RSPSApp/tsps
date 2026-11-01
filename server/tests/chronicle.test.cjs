// Run after `yarn build`: node --test tests/chronicle.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Chronicle = require("../plugins/items/Chronicle.plugin");

const { MAX_CHARGES, CHARGES_ATTRIBUTE, LANDING_TILES, charges, chargeWithCards, checkCharges, teleport } = Chronicle._test;

const hooks = { action: null, onItem: null };
const teleports = [];
let wilderness = false;
let reqsPass = true;
Chronicle.register({
  core: {
    ItemIdentifiers,
    Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
    Wilderness: { isIn: () => wilderness },
    Misc: { getRandom: () => 0 },
    TeleportType: { NORMAL: "normal" },
    TeleportHandler: {
      checkReqs: () => reqsPass,
      teleport: (player, destination, type, _force, onArrive) => teleports.push({ destination, type, onArrive }),
    },
  },
  persistAttribute: () => {},
  onItemAction: (name, actions) => { hooks.action = { name, actions }; },
  onItemOnItem: (used, target, handler, options) => { hooks.onItem = { used, target, handler, options }; },
});

function createPlayer(cards = 0, start = 0) {
  const attributes = new Map([[CHARGES_ATTRIBUTE, start]]);
  const messages = [];
  let held = cards;
  return {
    messages,
    held: () => held,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getInventory: () => ({
      getAmount: () => held,
      deleteNumber: (_id, amount) => { held -= amount; },
      refreshItems: () => {},
    }),
  };
}

test("noted cards can't charge it and both its option spellings answer (Wiki)", () => {
  assert.equal(hooks.action.name, "Chronicle");
  assert.deepEqual(Object.keys(hooks.action.actions), ["Teleport", "Check charges", "Check Charges"]);
  assert.deepEqual(hooks.onItem.options, { noted: false });
});

test("every card held charges at once, with the captured and Wiki messages", () => {
  const player = createPlayer(4, 95);
  chargeWithCards({ player });
  assert.equal(charges(player), 99);
  assert.equal(player.held(), 0);
  assert.equal(player.messages.at(-1), "You add 4 charges to your book. It now has 99 charges.");

  const single = createPlayer(1, 97);
  chargeWithCards({ player: single });
  assert.equal(single.messages.at(-1), "You add a single charge to your book. It now has 98 charges.");

  const first = createPlayer(1);
  chargeWithCards({ player: first });
  assert.equal(first.messages.at(-1), "You add a single charge to your book. It now has one charge.");
});

test("it holds 1,000 charges and keeps the cards it has no room for", () => {
  const full = createPlayer(1, MAX_CHARGES);
  chargeWithCards({ player: full });
  assert.equal(full.held(), 1);
  assert.equal(full.messages.at(-1), "Your book is fully charged! It has 1,000 charges already.");

  const nearly = createPlayer(5, 998);
  chargeWithCards({ player: nearly });
  assert.equal(charges(nearly), MAX_CHARGES);
  assert.equal(nearly.held(), 3);
});

test("Check charges reads the charges", () => {
  for (const [start, message] of [
    [0, "Your book has run out of charges."],
    [1, "You have one charge left in your book."],
    [95, "Your book has 95 charges left."],
  ]) {
    const player = createPlayer(0, start);
    checkCharges({ player });
    assert.equal(player.messages.at(-1), message);
  }
});

test("a teleport lands outside the Champions' Guild and spends its charge on arrival", () => {
  teleports.length = 0;
  const player = createPlayer(0, 99);
  teleport({ player });
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].type, "normal");
  assert.deepEqual([teleports[0].destination.x, teleports[0].destination.y], LANDING_TILES[0]);
  assert.equal(charges(player), 99, "nothing is spent until landing");
  teleports[0].onArrive();
  assert.equal(charges(player), 98);
  assert.equal(player.messages.at(-1), "<col=ef1020>Your book has 98 charges left.</col>");
});

test("the Wilderness, no charges and a refused teleport all spend nothing", () => {
  teleports.length = 0;
  wilderness = true;
  const inWilderness = createPlayer(0, 5);
  teleport({ player: inWilderness });
  assert.equal(inWilderness.messages.at(-1), "The book's powers do not work in the Wilderness.");
  wilderness = false;

  const empty = createPlayer();
  teleport({ player: empty });
  assert.equal(empty.messages.at(-1), "Your book does not have any charges. Purchase some Teleport Cards from Diango.");

  reqsPass = false;
  const refused = createPlayer(0, 5);
  teleport({ player: refused });
  reqsPass = true;
  assert.equal(charges(refused), 5);
  assert.equal(teleports.length, 0);
});
