// Run after `yarn build`: node --test tests/bone-altars.test.cjs
// Bones offered on the Chaos Temple altar: which altar, the two keep-the-bone rolls, the graphic's
// tile (docs/bone-altars.md); and Prayer's "prayer:bone" lookup it reads the bones from. House
// altars (Construction) offer through the same loop: bones from Prayer's table, the altar's and
// burners' bonus, the message by burners lit, the 4-tick repeat and the Zealot's robes.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const BoneAltars = require("../plugins/skills/BoneAltars.plugin");
const DATA = require("../plugins/skills/data/bone-altars.json");
const { altarAt, spared, zealotPieces, graphicTile } = BoneAltars._test;

const { PluginManager } = require("../dist/plugins/PluginManager");

const submitted = [];
const handlers = new Map();
const api = {
  core: { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => { task.setRunning(true); submitted.push(task); } } },
  emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  persistAttribute() {},
  onGroundItemPickup() {},
  onGroundItemClick() {},
  onItemFirstAction() {},
  onItemOnObject() {},
  onCanUseItem() {},
  onPlayerLogout() {},
  onPlayerDisconnect() {},
  onPlayerDeath() {},
};
const CHAOS_ALTAR = { x: 2947, y: 3820, z: 0 };
const random = Math.random;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/Prayer.plugin").register(api);
  BoneAltars.register(api);
  require("../plugins/skills/construction/Core.Construction").init(api);
});

afterEach(() => {
  Math.random = random;
  submitted.length = 0;
});

const wearing = (...names) => ({
  getEquipment: () => ({ getItems: () => names.map((name) => ({ getId: () => CacheDefinitions.getObjId(name) })) }),
});

test("prayer:bone gives the bone's row, and nothing for other items", () => {
  const request = { itemId: CacheDefinitions.getObjId("dragon_bones"), bone: null };
  api.emitCustomEvent("prayer:bone", request);
  assert.equal(request.bone.xp, 72);
  const logs = { itemId: CacheDefinitions.getObjId("logs"), bone: null };
  api.emitCustomEvent("prayer:bone", logs);
  assert.equal(logs.bone, null);
  for (const name of ["bull_bones", "giant_bones"]) {
    const groundOnly = { itemId: CacheDefinitions.getObjId(name), bone: null };
    api.emitCustomEvent("prayer:bone", groundOnly);
    assert.equal(groundOnly.bone, null, name);
  }
});

test("only the Chaos Temple's altar takes bones", () => {
  const id = CacheDefinitions.getLocId("chaosaltar");
  assert.equal(altarAt(id, CHAOS_ALTAR).name, "Chaos altar");
  // The same altar elsewhere (the Wilderness chaos temple at 3239, 3608) does not.
  assert.equal(altarAt(id, { x: 3239, y: 3608, z: 0 }), null);
  assert.equal(altarAt(CacheDefinitions.getLocId("trappedchaosaltar"), CHAOS_ALTAR), null);
});

test("the altar spares half, then the Zealot's robes roll 1.25% a piece", () => {
  const altar = DATA.altars[0];
  const none = wearing();
  Math.random = () => 0.49;
  assert.equal(spared(none, altar), "altar");
  Math.random = () => 0.5;
  assert.equal(spared(none, altar), null);

  const full = wearing("shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots");
  assert.equal(zealotPieces(full), 4);
  const rolls = [0.9, 0.049];
  Math.random = () => rolls.shift();
  assert.equal(spared(full, altar), "robes");
  const misses = [0.9, 0.05];
  Math.random = () => misses.shift();
  assert.equal(spared(full, altar), null);
  assert.equal(zealotPieces(wearing("shades_prayer_helm", "logs")), 1);
});

test("the offering graphic plays on the altar tile nearest the player", () => {
  const object = {
    getLocation: () => new Location(CHAOS_ALTAR.x, CHAOS_ALTAR.y, 0),
    getDefinition: () => ({ sizeX: 2, sizeY: 1 }),
    getFace: () => 0,
  };
  const at = (x, y) => ({ getLocation: () => new Location(x, y, 0) });
  const tile = (player) => { const t = graphicTile(player, object); return [t.getX(), t.getY()]; };
  assert.deepEqual(tile(at(2950, 3821)), [2948, 3820]);
  assert.deepEqual(tile(at(2946, 3819)), [2947, 3820]);
});

// A player in `house` carrying `bones` (gamevals), recording what an offering sends.
function housePlayer(house, bones, { prayer = 99, worn = [] } = {}) {
  const inventory = bones.map((name) => CacheDefinitions.getObjId(name));
  const sent = { messages: [], xp: [], animations: 0 };
  const packets = {
    sendTypedMessage: (_type, message) => sent.messages.push(message),
    sendSound: () => packets,
    sendGlobalGraphic: () => packets,
  };
  const player = {
    sent,
    inventory,
    getPrivateArea: () => house,
    getIndex: () => 1,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getLocation: () => new Location(100, 101, 0),
    setPositionToFace() {},
    performAnimation: () => sent.animations++,
    sendMessage: (message) => sent.messages.push(message),
    getPacketSender: () => packets,
    getEquipment: () => ({ getItems: () => worn.map((name) => ({ getId: () => CacheDefinitions.getObjId(name) })) }),
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getInventory: () => ({
      getSlotForItemId: (id) => inventory.indexOf(id),
      deleteAtSlot: (slot) => inventory.splice(slot, 1),
      getItems: () => inventory.map((id) => ({ getId: () => id })),
      getAmount: (id) => inventory.filter((item) => item === id).length,
      delete: (id) => inventory.splice(inventory.indexOf(id), 1),
    }),
    getSkillManager: () => ({ getMaxLevel: () => prayer, addExperiences: (_skill, xp) => sent.xp.push(xp) }),
  };
  return player;
}

// A house whose room holds `altar` (a buildable key) and two burners, `lit` of them burning.
function houseWith(altar, lit) {
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const { World } = api.core;
  const furniture = { buildableKey: altar };
  const burners = [{ buildableKey: "MARBLE_BURNER" }, { buildableKey: "MARBLE_BURNER" }];
  const house = Object.create(Instance.PlayerHouseInstance.prototype);
  house.litBurners = new Map(burners.slice(0, lit).map((burner) => [burner, World.getProcessCycle() + 100]));
  house.room = { furnitureByLocation: { a: furniture, b: burners[0], c: burners[1] } };
  house.getFurnitureAt = () => house.room.furnitureByLocation.a;
  house.getRoomPositionAt = () => ({ x: 1, y: 1, plane: 0 });
  house.getRoom = () => house.room;
  return house;
}

function useOnHouseAltar(player, bone) {
  const Altars = require("../plugins/skills/construction/Altars.Construction");
  const object = {
    getLocation: () => new Location(100, 100, 0),
    getDefinition: () => ({ sizeX: 2, sizeY: 1 }),
    getFace: () => 0,
    getType: () => 10,
  };
  return Altars.offerHouseBones({ player, object, objectId: 13197, location: object.getLocation(), itemId: CacheDefinitions.getObjId(bone), itemSlot: player.inventory.indexOf(CacheDefinitions.getObjId(bone)) });
}

const runTicks = (ticks) => { for (let i = 0; i < ticks; i++) submitted.forEach((task) => task.tick()); };

test("a house altar gives the Wiki's experience for every buryable bone, with its message by burners lit", () => {
  Math.random = () => 0.99;
  const offered = (altar, lit, bone) => {
    const player = housePlayer(houseWith(altar, lit), [bone]);
    assert.equal(useOnHouseAltar(player, bone), true);
    return { xp: player.sent.xp[0], message: player.sent.messages[0], left: player.inventory.length };
  };
  // Wiki, Gilded altar: bones 11.25 / 13.5 / 15.75, superior dragon bones 375 / 450 / 525.
  assert.deepEqual(offered("GILDED_ALTAR", 0, "bones"), { xp: 11.25, message: "The gods accept your offering.", left: 0 });
  assert.deepEqual(offered("GILDED_ALTAR", 1, "bones"), { xp: 13.5, message: "The gods are pleased with your offering.", left: 0 });
  assert.deepEqual(offered("GILDED_ALTAR", 2, "bones"), { xp: 15.75, message: "The gods are very pleased with your offering.", left: 0 });
  assert.equal(offered("GILDED_ALTAR", 2, "dragon_bones_superior").xp, 525);
  assert.equal(offered("GILDED_ALTAR", 0, "dragon_bones_superior").xp, 375);
  // Wiki, Chapel: an oak altar is 100%, 200% with both burners.
  assert.equal(offered("OAK_ALTAR", 0, "big_bones").xp, 15);
  assert.equal(offered("OAK_ALTAR", 2, "big_bones").xp, 30);
});

test("a house altar keeps offering every 4 ticks until that bone runs out, and burners count as they are now", () => {
  Math.random = () => 0.99;
  const house = houseWith("GILDED_ALTAR", 2);
  const player = housePlayer(house, ["bones", "big_bones", "bones", "bones"]);
  useOnHouseAltar(player, "bones");
  assert.equal(player.sent.xp.length, 1, "the first offering is immediate");
  runTicks(3);
  assert.equal(player.sent.xp.length, 1);
  house.litBurners.clear();
  runTicks(1);
  assert.deepEqual(player.sent.xp, [15.75, 11.25]);
  assert.deepEqual(player.sent.messages, ["The gods are very pleased with your offering.", "The gods accept your offering."]);
  runTicks(8);
  assert.equal(player.sent.xp.length, 3);
  assert.equal(player.sent.animations, 3);
  assert.deepEqual(player.inventory, [CacheDefinitions.getObjId("big_bones")], "other bones are left alone");
  assert.equal(submitted[0].isRunning(), false);
});

test("using a bone again offers at once instead of waiting for the loop", () => {
  Math.random = () => 0.99;
  const player = housePlayer(houseWith("GILDED_ALTAR", 0), ["bones", "bones", "bones"]);
  useOnHouseAltar(player, "bones");
  runTicks(1);
  useOnHouseAltar(player, "bones");
  assert.equal(player.sent.xp.length, 2);
  assert.equal(submitted[0].isRunning(), false, "the old loop stopped");
});

test("a house altar stops when the player leaves, refuses low Prayer, and lets the Zealot's robes keep a bone", () => {
  const house = houseWith("GILDED_ALTAR", 0);
  const player = housePlayer(house, ["bones", "bones"]);
  Math.random = () => 0.99;
  useOnHouseAltar(player, "bones");
  player.getPrivateArea = () => null;
  runTicks(4);
  assert.equal(player.sent.xp.length, 1);

  const low = housePlayer(house, ["dragon_bones_superior"], { prayer: 69 });
  assert.equal(useOnHouseAltar(low, "dragon_bones_superior"), true);
  assert.deepEqual(low.sent.messages, ["You need a Prayer level of 70 to offer these bones."]);
  assert.equal(low.inventory.length, 1);

  const zealot = housePlayer(house, ["bones"], { worn: ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"] });
  Math.random = () => 0.049;
  useOnHouseAltar(zealot, "bones");
  assert.equal(zealot.inventory.length, 1, "kept by the robes");
  assert.equal(zealot.sent.xp[0], 11.25);

  const logs = housePlayer(house, ["logs"]);
  assert.equal(useOnHouseAltar(logs, "logs"), false);
});
