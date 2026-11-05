// Run after `yarn build`: node --test tests/sailing-salvage-collection-log.test.cjs
// Sorting salvage credits only the loot the inventory actually accepted.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Player } = require("../dist/game/entity/impl/player/Player");

let plugin, hooks, obtains;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  hooks = {};
  obtains = [];
  const api = {
    core: require("../dist/plugins/PluginManager").PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onServerStartup: () => {},
    onPlayerLogout: () => {},
    emitCustomEvent: (name, event) => { if (name === "collection-log:obtain") obtains.push(event); },
  };
  plugin = require("../plugins/skills/sailing/Salvaging.plugin");
  plugin.register(api);
});

function player() {
  const p = new Player(null);
  p.setUsername("salvageClog");
  p.setRegistered(true);
  p.setLocation(new Location(3000, 3000, 0));
  p.inventory = new Inventory(p);
  p.getPacketSender = () => ({ sendSound: () => {}, sendSoundEffect: () => {}, sendClientScript: () => {}, sendTypedMessage: () => {}, sendItemContainer: () => {}, sendMessage: () => {} });
  p.getSkillManager = () => ({ getCurrentLevel: () => 99, addExperiences: () => {} });
  p.getMovementQueue = () => ({ size: () => 0 });
  p.getDialogueManager = () => ({ startDialogues: () => {} });
  p.performAnimation = () => {};
  return p;
}

/** A random source that plays back `values`, then repeats the last. */
function sequence(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function sort(p) {
  hooks["Salvaging station"]["Sort-salvage"]({ player: p });
  for (let i = 0; i < 3; i++) TaskManager.process();
}

test("sorting a Small salvage credits the loot it actually adds once", () => {
  obtains.length = 0;
  const random = Math.random;
  Math.random = () => 0;
  try {
    const p = player();
    p.getInventory().add(new Item(32847, 1), true);
    sort(p);
    assert.equal(p.getInventory().getAmount(31989), 1, "the Boat bottle (empty) pre-roll");
    assert.deepEqual(obtains.map((event) => [event.player, event.itemId, event.amount]), [[p, 31989, 1]]);
  } finally {
    Math.random = random;
    TaskManager.process();
  }
});

test("a capped stack credits only the loot the inventory accepted", () => {
  obtains.length = 0;
  const random = Math.random;
  // Skip pre-rolls; pick Bronze nails (5) from the table.
  Math.random = sequence([0.999, 0.999, 0.999, 0.999, 0.15, 0.999]);
  try {
    const p = player();
    p.getInventory().add(new Item(32847, 1), true);
    p.getInventory().add(new Item(4819, 2_147_483_646), true);
    sort(p);
    assert.equal(p.getInventory().getAmount(4819), 2_147_483_647, "the stack takes one of the five nails");
    assert.deepEqual(obtains.map((event) => [event.player, event.itemId, event.amount]), [[p, 4819, 1]]);
  } finally {
    Math.random = random;
    TaskManager.process();
  }
});
