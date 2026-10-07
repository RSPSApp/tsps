// Run after `yarn build`: node --test tests/darkness.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("light sources and the darkness timer follow the OSRS Wiki", () => {
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const Darkness = require("../plugins/world/Darkness.plugin");
  const {
    hasLightSource,
    darknessTickMessage,
    takesDarknessDamage,
    DARKNESS_WARNING_TICKS,
    DARKNESS_SWARM_TICKS,
  } = Darkness;

  const fakePlayer = ({ inventory = [], equipment = [] } = {}) => ({
    getInventory: () => ({ getItems: () => inventory.map((id) => ({ getId: () => id })) }),
    getEquipment: () => ({ getItems: () => equipment.map((id) => ({ getId: () => id })) }),
  });

  // Carried lights work from the inventory; unlit variants never count.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_CANDLE] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.CANDLE] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_TORCH] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.UNLIT_TORCH] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_BLACK_CANDLE] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.OIL_LAMP] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.OIL_LAMP_3] })), true);

  // The firemaking cape is an inextinguishable light source equipped or carried.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.FIREMAKING_CAPE] })), true);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.FIREMAKING_CAPE_T_] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.FIREMAKING_HOOD] })), false);

  // Worn lamps only work while equipped.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.MINING_HELMET] })), false);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.MINING_HELMET] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.KANDARIN_HEADGEAR_1] })), false);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.KANDARIN_HEADGEAR_1] })), true);
  assert.equal(hasLightSource(fakePlayer()), false);

  // 9s warning, 18s swarm, then 1 damage per tick.
  assert.equal(darknessTickMessage(DARKNESS_WARNING_TICKS - 1), null);
  assert.equal(
    darknessTickMessage(DARKNESS_WARNING_TICKS),
    "You hear tiny insects skittering over the ground..."
  );
  assert.equal(darknessTickMessage(DARKNESS_SWARM_TICKS), "Tiny biting insects swarm all over you!");
  assert.equal(takesDarknessDamage(DARKNESS_WARNING_TICKS), false);
  assert.equal(takesDarknessDamage(DARKNESS_SWARM_TICKS - 1), false);
  assert.equal(takesDarknessDamage(DARKNESS_SWARM_TICKS), true);
});

test("the caves warn, swarm and damage an unlit player until a light is lit", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const Darkness = require("../plugins/world/Darkness.plugin");

  const core = PluginManager.getCoreApi();
  let area = null;
  Darkness.register({
    core,
    registerArea: (registered) => { area = registered; },
    log: () => {},
  });
  assert.ok(area, "dark area registered");

  const attributes = new Map();
  const messages = [];
  const damage = [];
  const inventory = [];
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ getItems: () => inventory.map((id) => ({ getId: () => id })) }),
    getEquipment: () => ({ getItems: () => [] }),
    sendMessage: (message) => messages.push(message),
    getCombat: () => ({
      getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(...hits) }),
    }),
  };

  for (let tick = 0; tick < 14; tick++) area.process(player);
  assert.equal(messages.length, 0, "silent for the first 9 seconds");
  assert.equal(damage.length, 0);

  area.process(player); // tick 15
  assert.deepEqual(messages, ["You hear tiny insects skittering over the ground..."]);

  for (let tick = 15; tick < 29; tick++) area.process(player);
  assert.equal(damage.length, 0, "no damage before 18 seconds");

  area.process(player); // tick 30
  assert.equal(messages[1], "Tiny biting insects swarm all over you!");
  assert.equal(damage.length, 1, "one damage on the swarm tick");
  area.process(player);
  assert.equal(damage.length, 2, "one damage per tick after");

  inventory.push(I.LIT_CANDLE);
  area.process(player);
  assert.equal(damage.length, 2, "lighting a source stops the damage");
  assert.equal(attributes.get("darkness:no-light-ticks"), undefined);

  inventory.length = 0;
  for (let tick = 0; tick < 30; tick++) area.process(player);
  assert.ok(damage.length > 2, "timer restarts when the light goes away");

  area.postLeave(player);
  assert.equal(attributes.get("darkness:no-light-ticks"), undefined);
});
