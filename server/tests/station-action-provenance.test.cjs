// Run after `yarn build`: node --test tests/station-action-provenance.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const CraftingShared = require("../plugins/skills/crafting/Shared.Crafting");
const Spinning = require("../plugins/skills/crafting/Spinning.Crafting");
const Smithing = require("../plugins/skills/Smithing.plugin");
const core = PluginManager.getCoreApi();
const objectActions = new Map();
const buttonActions = new Map();
const startupActions = [];
const events = [];

const api = new Proxy({
  core,
  getTaskManager: () => core.TaskManager,
  onObjectInteraction(name, actions) { objectActions.set(name, actions); },
  onInterfaceActionButton(ids, handler) { for (const id of ids) buttonActions.set(id, handler); },
  onServerStartup(handler) { startupActions.push(handler); },
  onCustomEvent() {},
  emitCustomEvent(name, event) {
    if (name === "crafting:spun" || name === "smithing:success") events.push({ name, ...event });
    if (name === "smithing:anvil-access") event.denied = false;
  },
}, { get: (target, key) => target[key] ?? (() => {}) });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  CraftingShared.attach(api);
  Spinning(api);
  Smithing.register(api);
  for (const start of startupActions) start();
});

function livePlayer(index, entries, area) {
  const player = new Player({ sendClientPacket: () => true, write() {} });
  player.setIndex(index);
  player.setUsername(`station-action-${index}`);
  player.setLocation(new core.Location(2560, 3210, 0));
  if (area) player.setArea(area);
  player.setRegistered(true);
  player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 99, false);
  player.getSkillManager().setCurrentLevel(core.Skill.SMITHING, 99, false);
  const inventory = player.getInventory();
  const items = Array.from({ length: 28 }, () => new core.Item(-1, 0));
  entries.forEach(([id, amount], slot) => { items[slot] = new core.Item(id, amount); });
  inventory.setItems(items);
  let menu = null;
  const sender = new Proxy({ sendCreationMenu(value) { menu = value; return sender; } }, {
    get: (target, key) => target[key] ?? (() => sender),
  });
  player.getPacketSender = () => sender;
  return { player, inventory, menu: () => menu };
}

function station(id, x = 2561, y = 3210) {
  const location = new core.Location(x, y, 0);
  return { getId: () => id, getLocation: () => location, getDefinition: () => ({ getName: () => "Spinning wheel" }) };
}

const spinningWheelId = () => core.CacheDefinitions.getLocId("spinningwheel");
const anvilId = () => core.CacheDefinitions.getLocId("anvil");

function spin({ player, menu }, wheel) {
  objectActions.get("Spinning wheel").Spin({ player, object: wheel });
  menu().execute(I.BOW_STRING, 1);
}

function smith({ player }, anvil) {
  objectActions.get("Anvil").Smith({ player, object: anvil });
  const component = 9;
  const buttonId = (312 << 16) | component;
  buttonActions.get(buttonId)({ player, buttonId });
}

function tick(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

test("spinning reports its station and cancels after movement, teleport or instance change", () => {
  events.length = 0;
  const stationary = livePlayer(62000, [[I.FLAX, 1]]);
  const wheel = station(spinningWheelId());
  spin(stationary, wheel);
  tick(2);
  const spun = events.find((event) => event.player === stationary.player);
  assert.ok(spun);
  assert.equal(spun.stationObjectId, spinningWheelId());
  assert.deepEqual(spun.location, { x: 2561, y: 3210, z: 0 });

  const flax = livePlayer(62001, [[I.FLAX, 1]]);
  spin(flax, station(spinningWheelId()));
  flax.player.moveTo(new core.Location(3000, 3000, 0));
  tick(2);
  assert.equal(flax.inventory.getAmount(I.FLAX), 1);
  assert.equal(flax.inventory.getAmount(I.BOW_STRING), 0);
  assert.equal(events.some((event) => event.player === flax.player), false);

  const moving = livePlayer(62006, [[I.FLAX, 1]]);
  spin(moving, station(spinningWheelId()));
  moving.player.getMovementQueue().walkToReset();
  moving.player.getMovementQueue().addSteps(new core.Location(2562, 3210, 0));
  tick(2);
  assert.equal(moving.inventory.getAmount(I.FLAX), 1);
  assert.equal(moving.inventory.getAmount(I.BOW_STRING), 0);
  assert.equal(events.some((event) => event.player === moving.player), false);

  const firstInstance = {}, secondInstance = {};
  const instanced = livePlayer(62002, [[I.FLAX, 1]], firstInstance);
  spin(instanced, station(spinningWheelId()));
  instanced.player.setArea(secondInstance);
  tick(2);
  assert.equal(instanced.inventory.getAmount(I.FLAX), 1);
  assert.equal(instanced.inventory.getAmount(I.BOW_STRING), 0);
  assert.equal(events.some((event) => event.player === instanced.player), false);
});

test("anvil sessions report their station and cancel after movement, teleport or instance change", () => {
  events.length = 0;
  const stationary = livePlayer(62005, [[I.HAMMER, 1], [I.BRONZE_BAR, 1]]);
  smith(stationary, station(anvilId()));
  tick(5);
  const smithing = events.find((event) => event.player === stationary.player);
  assert.ok(smithing);
  assert.equal(smithing.stationObjectId, anvilId());
  assert.deepEqual(smithing.location, { x: 2561, y: 3210, z: 0 });

  const bars = livePlayer(62003, [[I.HAMMER, 1], [I.BRONZE_BAR, 1]]);
  smith(bars, station(anvilId()));
  bars.player.moveTo(new core.Location(3000, 3000, 0));
  tick(6);
  assert.equal(bars.inventory.getAmount(I.BRONZE_BAR), 1);
  assert.equal(bars.inventory.getAmount(I.BRONZE_DAGGER), 0);
  assert.equal(events.some((event) => event.player === bars.player), false);

  const moving = livePlayer(62007, [[I.HAMMER, 1], [I.BRONZE_BAR, 1]]);
  smith(moving, station(anvilId()));
  moving.player.getMovementQueue().walkToReset();
  moving.player.getMovementQueue().addSteps(new core.Location(2562, 3210, 0));
  tick(6);
  assert.equal(moving.inventory.getAmount(I.BRONZE_BAR), 1);
  assert.equal(moving.inventory.getAmount(I.BRONZE_DAGGER), 0);
  assert.equal(events.some((event) => event.player === moving.player), false);

  const firstInstance = {}, secondInstance = {};
  const instanced = livePlayer(62004, [[I.HAMMER, 1], [I.BRONZE_BAR, 1]], firstInstance);
  smith(instanced, station(anvilId()));
  instanced.player.setArea(secondInstance);
  tick(6);
  assert.equal(instanced.inventory.getAmount(I.BRONZE_BAR), 1);
  assert.equal(instanced.inventory.getAmount(I.BRONZE_DAGGER), 0);
  assert.equal(events.some((event) => event.player === instanced.player), false);
});
