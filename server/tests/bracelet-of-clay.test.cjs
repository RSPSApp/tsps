// From server/: node --test tests/bracelet-of-clay.test.cjs (after yarn build).
// Wiki Bracelet_of_clay and Soft_clay_rocks: worn, it softens mined clay and gives two soft clay at the
// soft clay rocks; 28 per-player charges, then it crumbles.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

const core = PluginManager.getCoreApi();
const plugin = require("../plugins/items/BraceletOfClay.plugin");
const I = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function wearer(worn = I.BRACELET_OF_CLAY) {
  const attributes = new Map();
  const hands = { id: worn };
  const player = {
    messages: [], refreshed: 0,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => player.messages.push(text),
    getEquipment: () => ({
      get: (slot) => (slot === core.Equipment.HANDS_SLOT && hands.id > 0 ? { getId: () => hands.id } : null),
      set: (slot, item) => { if (slot === core.Equipment.HANDS_SLOT) hands.id = item.getId(); },
      refreshItems: () => { player.refreshed++; },
    }),
    worn: () => hands.id,
  };
  return player;
}

function register() {
  const hooks = { events: {}, persisted: [] };
  plugin.register({
    core,
    persistAttribute: (key, value) => hooks.persisted.push([key, value]),
    onCustomEvent: (key, fn) => { hooks.events[key] = fn; },
  });
  return hooks;
}

test("registers as a members plugin with a persisted per-player charge count", () => {
  const hooks = register();
  assert.equal(plugin.members, true);
  assert.deepEqual(hooks.persisted, [[plugin._test.CHARGES_ATTRIBUTE, 28]]);
  assert.equal(typeof hooks.events["mining:ore-yield"], "function");
});

test("worn, clay is mined as soft clay and soft clay rocks give two", () => {
  const hooks = register();
  const player = wearer();
  const clay = { player, rock: "Clay rocks", oreId: I.CLAY, amount: 1, spend: null };
  hooks.events["mining:ore-yield"](clay);
  assert.deepEqual([clay.oreId, clay.amount], [I.SOFT_CLAY, 1]);
  const soft = { player, rock: "Soft clay rocks", oreId: I.SOFT_CLAY, amount: 1, spend: null };
  hooks.events["mining:ore-yield"](soft);
  assert.deepEqual([soft.oreId, soft.amount], [I.SOFT_CLAY, 2]);
});

test("not worn, or on another ore, nothing changes", () => {
  const hooks = register();
  const bare = wearer(-1);
  const clay = { player: bare, rock: "Clay rocks", oreId: I.CLAY, amount: 1, spend: null };
  hooks.events["mining:ore-yield"](clay);
  assert.deepEqual([clay.oreId, clay.amount, clay.spend], [I.CLAY, 1, null]);
  const iron = { player: wearer(), rock: "Iron rocks", oreId: I.IRON_ORE, amount: 1, spend: null };
  hooks.events["mining:ore-yield"](iron);
  assert.deepEqual([iron.oreId, iron.amount, iron.spend], [I.IRON_ORE, 1, null]);
});

test("28 softened clay use the bracelet up", () => {
  const hooks = register();
  const player = wearer();
  for (let i = 0; i < 27; i++) {
    const request = { player, rock: "Clay rocks", oreId: I.CLAY, amount: 1, spend: null };
    hooks.events["mining:ore-yield"](request);
    request.spend();
  }
  assert.equal(player.worn(), I.BRACELET_OF_CLAY);
  assert.equal(plugin._test.chargesLeft(player), 1);
  const last = { player, rock: "Clay rocks", oreId: I.CLAY, amount: 1, spend: null };
  hooks.events["mining:ore-yield"](last);
  last.spend();
  assert.equal(player.worn(), -1, "the bracelet crumbles");
  assert.equal(player.messages.at(-1), "Your bracelet of clay crumbles to dust.");
  assert.equal(plugin._test.chargesLeft(player), 28, "a new bracelet starts with a full count");
});

test("a charge is only spent when spend runs", () => {
  const hooks = register();
  const player = wearer();
  hooks.events["mining:ore-yield"]({ player, rock: "Clay rocks", oreId: I.CLAY, amount: 1, spend: null });
  assert.equal(plugin._test.chargesLeft(player), 28);
});
