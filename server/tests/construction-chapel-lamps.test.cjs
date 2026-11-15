// Run after `yarn build`: node --test tests/construction-chapel-lamps.test.cjs
// Chapel lamps in a player-owned house (docs/construction.md, "Chapel lamps"): torches and
// candlesticks lit with a tinderbox, incense burners with one clean marrentill, their messages,
// sounds and refusals, and no experience (rsprox captures 230/2850, 227/86, 227/572).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");

const api = { core: PluginManager.getCoreApi() };
let Altars;
let Instance;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/construction/Core.Construction").init(api);
  Altars = require("../plugins/skills/construction/Altars.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
});

const TINDERBOX = CacheDefinitions.getObjId("tinderbox");
const MARRENTILL = CacheDefinitions.getObjId("marentill");

function houseWith(buildableKey, { buildingMode = false } = {}) {
  const house = Object.create(Instance.PlayerHouseInstance.prototype);
  house.buildingMode = buildingMode;
  house.litBurners = new Map();
  house.furniture = { buildableKey };
  house.redraws = 0;
  house.getFurnitureAt = () => house.furniture;
  house.redrawFurniture = () => house.redraws++;
  return house;
}

function playerIn(house, items, firemaking = 99) {
  const inventory = [...items];
  const sent = { messages: [], spam: [], sounds: [], animations: [], xp: [] };
  const packets = {
    sendTypedMessage: (_type, message) => { sent.spam.push(message); return packets; },
    sendSound: (id) => { sent.sounds.push(id); return packets; },
  };
  return {
    sent,
    inventory,
    getPrivateArea: () => house,
    sendMessage: (message) => sent.messages.push(message),
    getPacketSender: () => packets,
    performAnimation: (animation) => sent.animations.push(animation.getId()),
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => firemaking, addExperiences: (_skill, xp) => sent.xp.push(xp) }),
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      delete: (id) => inventory.splice(inventory.indexOf(id), 1),
    }),
  };
}

const light = (player, objectId, itemId) => Altars.lightHouseBurner({
  player, objectId, itemId, location: new Location(100, 100, 0), object: { getType: () => 10 },
});
const LIGHT_TORCH = () => require("../plugins/skills/construction/Ids.Construction").seq("human_light_torch");

test("a burner takes one marrentill: the captured spam line, synth 2066, the lighting pose, no experience", () => {
  const house = houseWith("INCENSE_BURNER");
  const player = playerIn(house, [TINDERBOX, MARRENTILL, MARRENTILL]);
  assert.equal(light(player, 13208), true);
  assert.deepEqual(player.sent.spam, ["You burn some marrentill in the incense burner."]);
  assert.deepEqual(player.sent.messages, []);
  assert.deepEqual(player.sent.sounds, [2066]);
  assert.deepEqual(player.sent.animations, [LIGHT_TORCH()]);
  assert.deepEqual(player.sent.xp, []);
  assert.deepEqual(player.inventory, [TINDERBOX, MARRENTILL]);
  assert.ok(Number.isFinite(house.litBurners.get(house.furniture)));
  assert.equal(house.redraws, 1);
  // Re-light while it burns uses another.
  assert.equal(light(player, 13209), true);
  assert.deepEqual(player.inventory, [TINDERBOX]);
});

test("a burner without marrentill, or without a tinderbox, is refused with the captured line", () => {
  const house = houseWith("MARBLE_BURNER");
  const noHerb = playerIn(house, [TINDERBOX]);
  assert.equal(light(noHerb, 13212), true);
  assert.deepEqual(noHerb.sent.messages, ["Incense burners must be lit with Marrentill."]);
  const noTinderbox = playerIn(house, [MARRENTILL]);
  assert.equal(light(noTinderbox, 13212), true);
  assert.deepEqual(noTinderbox.sent.messages, ["You need a tinderbox to light the fire."]);
  assert.deepEqual(noTinderbox.inventory, [MARRENTILL]);
  assert.equal(house.litBurners.size, 0);
});

test("torches and candlesticks need only a tinderbox, say 'You light the torch.' with synth 2596 and stay lit", () => {
  for (const [key, objectId] of [["WOODEN_TORCHES", 13200], ["STEEL_TORCHES", 13202], ["STEEL_CANDLESTICKS", 13204], ["GOLD_CANDLESTICKS", 13206]]) {
    const house = houseWith(key);
    const player = playerIn(house, [TINDERBOX, MARRENTILL]);
    assert.equal(light(player, objectId), true, key);
    assert.deepEqual(player.sent.messages, ["You light the torch."], key);
    assert.deepEqual(player.sent.sounds, [2596], key);
    assert.deepEqual(player.sent.xp, [], key);
    assert.deepEqual(player.inventory, [TINDERBOX, MARRENTILL], key);
    assert.equal(house.litBurners.get(house.furniture), Infinity, key);
    Altars.expireHouseBurners(house, 1e12);
    assert.equal(house.litBurners.has(house.furniture), true, key);
  }
  const house = houseWith("STEEL_TORCHES");
  const player = playerIn(house, []);
  assert.equal(light(player, 13202), true);
  assert.deepEqual(player.sent.messages, ["You need a tinderbox to light the fire."]);
  // Marrentill used on a torch isn't a way to light it.
  assert.equal(light(playerIn(house, [TINDERBOX, MARRENTILL]), 13202, MARRENTILL), false);
});

test("nothing is lit in building mode", () => {
  for (const key of ["INCENSE_BURNER", "WOODEN_TORCHES"]) {
    const house = houseWith(key, { buildingMode: true });
    const player = playerIn(house, [TINDERBOX, MARRENTILL]);
    assert.equal(light(player, 13208), true);
    assert.deepEqual(player.sent.messages, ["You can't light that in building mode."]);
    assert.deepEqual(player.inventory, [TINDERBOX, MARRENTILL]);
    assert.equal(house.litBurners.size, 0);
  }
});

test("other furniture isn't a lamp", () => {
  const house = houseWith("OAK_ALTAR");
  assert.equal(light(playerIn(house, [TINDERBOX, MARRENTILL]), 13179), false);
});
