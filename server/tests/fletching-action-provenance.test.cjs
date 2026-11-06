// Run after `yarn build`: node --test tests/fletching-action-provenance.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Fletching = require("../plugins/skills/Fletching.plugin");
const core = PluginManager.getCoreApi();
const tasks = [];
const made = [];
const produced = [];
let shared;
let taskManager = { submit: (task) => tasks.push(task) };

const api = new Proxy({
  core,
  getTaskManager: () => taskManager,
  emitCustomEvent(name, event) {
    if (name === "fletching:made") made.push(event);
    if (name === "skills:produced") produced.push(event);
  },
}, { get: (target, key) => target[key] ?? (() => {}) });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Fletching.register(api);
  shared = require("../plugins/skills/fletching/Shared.Fletching");
});

test("rune crossbow stringing reports consumed inputs and its production location after the delay", () => {
  const inventoryCounts = new Map([[I.RUNITE_CROSSBOW_U_, 1], [I.CROSSBOW_STRING, 1]]);
  let position = new core.Location(2560, 3210, 0);
  const inventory = {
    contains: (id) => (inventoryCounts.get(id) ?? 0) > 0,
    getAmount: (id) => inventoryCounts.get(id) ?? 0,
    deleteNumber(id, amount) {
      const next = (inventoryCounts.get(id) ?? 0) - amount;
      if (next > 0) inventoryCounts.set(id, next);
      else inventoryCounts.delete(id);
    },
    addItem(item) { inventoryCounts.set(item.getId(), (inventoryCounts.get(item.getId()) ?? 0) + item.getAmount()); },
    getFreeSlots: () => 28 - inventoryCounts.size,
  };
  const player = {
    getInventory: () => inventory,
    getEquipment: () => ({ contains: () => false }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences() {} }),
    getPacketSender: () => new Proxy({}, { get: () => () => {} }),
    getLocation: () => position,
    getForceMovement: () => null,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getIndex: () => 1,
    performAnimation() {},
    sendMessage() {},
  };

  assert.equal(shared.handlePair(player, I.RUNITE_CROSSBOW_U_, I.CROSSBOW_STRING), true);
  position = new core.Location(3000, 3000, 0);
  tasks.at(-1).execute();

  assert.equal(inventoryCounts.get(I.RUNE_CROSSBOW), 1);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].inputItemIds, [I.RUNITE_CROSSBOW_U_, I.CROSSBOW_STRING]);
  assert.deepEqual(made[0].inputs, [
    { itemId: I.RUNITE_CROSSBOW_U_, amount: 1 },
    { itemId: I.CROSSBOW_STRING, amount: 1 },
  ]);
  assert.equal(made[0].outputItemId, I.RUNE_CROSSBOW);
  assert.equal(made[0].stationObjectId, null);
  assert.deepEqual(made[0].location, { x: 3000, y: 3000, z: 0 });
  assert.deepEqual(made[0].startLocation, { x: 2560, y: 3210, z: 0 });
});

function dartInventoryPlayer(outputMeta = null) {
  const player = {
    getUsername: () => "provenance-test",
    getEquipment: () => ({ contains: () => false }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences() {} }),
    getPacketSender: () => new Proxy({ getVarbit: () => 0 }, { get: (target, name) => target[name] ?? (() => {}) }),
    getLocation: () => new core.Location(3000, 3000, 0),
    getForceMovement: () => null,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getIndex: () => 2,
    performAnimation() {},
    sendMessage() {},
  };
  const inventory = new core.Inventory(player);
  const items = Array.from({ length: 28 }, () => new core.Item(-1, 0));
  items[0] = new core.Item(I.RUNE_DART, 0x7fffffff, outputMeta);
  items[1] = new core.Item(I.RUNE_DART_TIP, 10);
  items[2] = new core.Item(I.FEATHER, 10);
  for (let slot = 3; slot < items.length; slot++) items[slot] = new core.Item(I.BRONZE_BAR, 1);
  inventory.setItems(items);
  player.getInventory = () => inventory;
  return { player, inventory };
}

test("a capped matching output stack leaves fletching inputs untouched and emits no success", () => {
  made.length = 0;
  produced.length = 0;
  const { player, inventory } = dartInventoryPlayer();
  assert.equal(shared.handlePair(player, I.RUNE_DART_TIP, I.FEATHER), true);
  assert.equal(inventory.getAmount(I.RUNE_DART_TIP), 10);
  assert.equal(inventory.getAmount(I.FEATHER), 10);
  assert.equal(inventory.getAmount(I.RUNE_DART), 0x7fffffff);
  assert.equal(made.length, 0);
  assert.equal(produced.length, 0);
});

test("output metadata gets its own stack when inputs free a slot", () => {
  made.length = 0;
  produced.length = 0;
  const { player, inventory } = dartInventoryPlayer({ source: "existing" });
  assert.equal(shared.handlePair(player, I.RUNE_DART_TIP, I.FEATHER), true);
  assert.equal(inventory.getAmount(I.RUNE_DART_TIP), 0);
  assert.equal(inventory.getAmount(I.FEATHER), 0);
  assert.equal(inventory.getAmount(I.RUNE_DART), 0x7fffffff + 10);
  assert.equal(made.length, 1);
  assert.equal(made[0].amount, 10);
  assert.equal(produced.length, 1);
});

function liveFletchingPlayer(index) {
  const player = new Player({ sendClientPacket: () => true, write() {} });
  player.setIndex(index);
  player.setUsername(`fletching-origin-${index}`);
  player.setLocation(new core.Location(2560, 3210, 0));
  player.setRegistered(true);
  player.getSkillManager().setCurrentLevel(core.Skill.FLETCHING, 99, false);
  player.getInventory().setItems(Array.from({ length: 28 }, (_, slot) => {
    if (slot === 0) return new core.Item(I.RUNITE_CROSSBOW_U_, 1);
    if (slot === 1) return new core.Item(I.CROSSBOW_STRING, 1);
    return new core.Item(-1, 0);
  }));
  return player;
}

test("the real scheduler uses production location after teleport and cancels queued walking", () => {
  const oldTaskManager = taskManager;
  taskManager = core.TaskManager;
  made.length = 0;
  produced.length = 0;
  try {
    const teleported = liveFletchingPlayer(61001);
    assert.equal(shared.handlePair(teleported, I.RUNITE_CROSSBOW_U_, I.CROSSBOW_STRING), true);
    teleported.moveTo(new core.Location(3000, 3000, 0));
    core.TaskManager.process();
    assert.equal(teleported.getInventory().getAmount(I.RUNE_CROSSBOW), 1);
    const teleportedAction = made.find((event) => event.player === teleported);
    assert.deepEqual(teleportedAction.location, { x: 3000, y: 3000, z: 0 });
    assert.deepEqual(teleportedAction.startLocation, { x: 2560, y: 3210, z: 0 });
    const producedAction = produced.find((event) => event.player === teleported);
    assert.deepEqual(producedAction.location, teleportedAction.location);
    assert.notDeepEqual(producedAction.location, teleportedAction.startLocation);

    const walking = liveFletchingPlayer(61002);
    assert.equal(shared.handlePair(walking, I.RUNITE_CROSSBOW_U_, I.CROSSBOW_STRING), true);
    walking.getMovementQueue().walkToReset();
    walking.getMovementQueue().addSteps(new core.Location(2561, 3210, 0));
    core.TaskManager.process();
    assert.equal(walking.getInventory().getAmount(I.RUNITE_CROSSBOW_U_), 1);
    assert.equal(walking.getInventory().getAmount(I.CROSSBOW_STRING), 1);
    assert.equal(made.some((event) => event.player === walking), false);
    assert.equal(produced.some((event) => event.player === walking), false);
    shared.stopFletching(walking);
  } finally {
    taskManager = oldTaskManager;
  }
});
