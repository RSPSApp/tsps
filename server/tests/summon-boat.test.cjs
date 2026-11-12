// Run after `yarn build`: node --test tests/summon-boat.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Animation } = require("../dist/game/model/Animation");
const { Graphic } = require("../dist/game/model/Graphic");
const { Task } = require("../dist/game/task/Task");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const areaSounds = [];
let actions;
let plugin;

before(async () => {
  await CachePipeline.initialize();
  plugin = require("../plugins/skills/sailing/SummonBoat.Sailing");
  plugin.register({
    core: { Animation, Graphic, Task, TaskManager, Sounds: { playAreaSound: (sound) => areaSounds.push(sound) } },
    onItemAction: (name, handlers) => { if (name === "Summon boat") actions = handlers; },
    persistAttribute() {},
  });
});

const { facilityNamed, setFacility } = require("../plugins/skills/sailing/BoatFacilities.Sailing");

function clearTasks() {
  while (TaskManager.pendingTasks.shift() != null);
  TaskManager.activeTasks.length = 0;
}

function boat(slot, dock, { focus = "Teleport focus" } = {}) {
  const owned = { slot, type: "sloop", name: [], cargo: [], location: { kind: "docked", dock } };
  if (focus) setFacility(owned, 0, facilityNamed(focus));
  return owned;
}

/** A player at (x, y) with these boats and one tablet; records what the server sends. */
function createPlayer(x, y, boats) {
  const items = [ItemIdentifiers.SUMMON_BOAT];
  const log = [];
  const attributes = new Map();
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => {
      if (key === "sendVarbit" || key === "sendConfig") log.push(`${key} ${args[0]}=${args[1]}`);
      if (key === "sendSoundEffect") log.push(`sound ${args[0]}`);
      if (key === "sendSubInterface") log.push(`open ${args[1]}`);
      return sender;
    },
  });
  return {
    items,
    log,
    getLocation: () => new Location(x, y, 0),
    getSailing: () => ({ boats, activeBoatSlot: null }),
    getArea: () => null,
    getPrivateArea: () => null,
    getIndex: () => 1,
    getPacketSender: () => sender,
    setInterfaceId: () => {},
    getInterfaceId: () => -1,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
    performAnimation: (anim) => log.push(`seq ${anim.getId()}`),
    performGraphic: (graphic) => log.push(`spot ${graphic.id}`),
    sendMessage: (message) => log.push(`message ${message}`),
  };
}

const tablet = { itemId: ItemIdentifiers.SUMMON_BOAT };

test("Summon boat works near a dock or mooring point: as captured, 13 tiles from the Pandemonium's gangplank", () => {
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(3059, 2974, 0) })?.id, "the_pandemonium");
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(2657, 2673, 0) })?.id, "void_knights_outpost");
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(3222, 3218, 0) }), undefined, "Lumbridge");
  const far = createPlayer(3222, 3218, [boat(0, "port_sarim")]);
  actions.Break({ player: far, ...tablet });
  assert.deepEqual(far.log, ["message You need to be near a dock or mooring point to use this tablet."]);
  assert.equal(far.items.length, 1);
});

test("Break opens the boat selection in its Summon mode with the dock as the teleport dock (rsprox)", () => {
  const player = createPlayer(3059, 2974, [boat(0, "port_sarim")]);
  actions.Break({ player, ...tablet });
  const sent = player.log.filter((line) => /5006|18553|5005|12393|open/.test(line));
  assert.deepEqual(sent, ["sendConfig 5006=8588", "sendVarbit 18553=6", "sendConfig 5005=8588", "sendVarbit 12393=1", "open 934"]);
});

test("a summon moves the boat, breaks the tablet, then casts two ticks later and clears busy two after that", () => {
  clearTasks();
  const summoned = boat(2, "void_knights_outpost");
  const player = createPlayer(3059, 2974, [boat(0, "port_sarim", { focus: null }), summoned]);
  const pandemonium = plugin._test.nearbyDock(player);
  plugin._test.summon(player, ItemIdentifiers.SUMMON_BOAT, pandemonium, 2);
  assert.deepEqual(summoned.location, { kind: "docked", dock: "the_pandemonium" });
  assert.ok(player.log.includes("seq 4069") && player.log.includes("sound 965"), "the tablet broken at once");
  // Used up with the move: dropping it before the cast must not keep it (the captures show it leave at the cast).
  assert.equal(player.items.length, 0, "the tablet is used up with the move");
  player.log.length = 0;
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(player.log, ["message Your boat has been summoned to the Pandemonium.", "spot 343", "seq 1818"]);
  assert.equal(areaSounds.at(-1).soundId, 199);
  player.log.length = 0;
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(player.log, ["sendVarbit 12393=0"]);
  assert.equal(player.getAttribute(plugin._test.LAST_SUMMONED_ATTRIBUTE), 2);
  clearTasks();
});

test("only a boat with a teleport focus can be summoned; Last boat summons the last one", () => {
  clearTasks();
  const plain = boat(0, "port_sarim", { focus: null });
  const greater = boat(1, "port_sarim", { focus: "Greater teleport focus" });
  const player = createPlayer(3059, 2974, [plain, greater]);
  plugin._test.summon(player, ItemIdentifiers.SUMMON_BOAT, plugin._test.nearbyDock(player), 0);
  assert.equal(plain.location.dock, "port_sarim");
  assert.ok(player.log.includes("message That boat needs a teleport focus to be summoned."));
  assert.equal(player.items.length, 1);

  player.log.length = 0;
  actions["Last boat"]({ player, ...tablet });
  assert.deepEqual(player.log, ["message You haven't summoned a boat yet."]);
  player.setAttribute(plugin._test.LAST_SUMMONED_ATTRIBUTE, 1);
  actions["Last boat"]({ player, ...tablet });
  assert.equal(greater.location.dock, "the_pandemonium", "a greater focus counts too");
  clearTasks();
});
