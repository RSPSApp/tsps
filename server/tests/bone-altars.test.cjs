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

test("the Chaos altar keeps the experience's tenths, as the Wiki lists them", () => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { GameConstants } = require("../dist/game/GameConstants");
  const { Skill } = require("../dist/game/model/Skill");
  const altar = DATA.altars[0];
  const blessing = BoneAltars._test.dataBlessing(altar);
  const multiplier = GameConstants.EXPERIENCE_MULTIPLIER;
  GameConstants.EXPERIENCE_MULTIPLIER = 1;
  try {
    // Wiki: bones 15.7, bat bones 18.5, monkey bones 17.5 at the Chaos altar (350%).
    for (const [bury, expected] of [[4.5, 15.7], [5.3, 18.5], [5, 17.5]]) {
      const p = new Player(null);
      p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
      const skills = p.getSkillManager();
      skills.addExperiences(Skill.PRAYER, blessing({ xp: bury }).experience);
      // The stored total keeps its tenths (getExperience shows the whole part, as the client does).
      assert.equal(skills.skills.experience[Skill.PRAYER.getIndex()], expected, `${bury} buried`);
    }
  } finally {
    GameConstants.EXPERIENCE_MULTIPLIER = multiplier;
  }
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

// A tick also moves the game cycle on, as World.process does: offerings are one a tick.
let cycle = 0;
api.core.World = Object.assign(Object.create(api.core.World), { getProcessCycle: () => cycle });
const runTicks = (ticks) => { for (let i = 0; i < ticks; i++) { cycle++; submitted.forEach((task) => task.tick()); } };

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

test("several uses in one tick offer one bone, not one each", () => {
  Math.random = () => 0.99;
  const player = housePlayer(houseWith("GILDED_ALTAR", 0), ["bones", "bones", "bones", "bones"]);
  for (let i = 0; i < 4; i++) useOnHouseAltar(player, "bones");
  assert.equal(player.sent.xp.length, 1, "one offering this tick");
  assert.equal(player.inventory.length, 3);
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

// Seeded players at the real Chaos altar; queued client actions and selected engine phases,
// not a natural login, item acquisition or full World.step.
test("native altar offerings stop when an inventory burial interrupts them", async (t) => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const core = PluginManager.getCoreApi();
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.notEqual(PluginManager.getPluginConfig("Prayer:sequentialBurying", false), true);
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(CHAOS_ALTAR.x, CHAOS_ALTAR.y);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const boneId = CacheDefinitions.getObjId("bones");
  const altarId = CacheDefinitions.getLocId("chaosaltar");
  let index = 1770;
  for (const mode of ["repeat", "walk", "bury", "widget-bury", "widget-examine"]) await t.test(mode, async (t) => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    player.setIndex(index++);
    player.setUsername("prayerinterrupt" + index);
    player.setRegistered(true);
    player.setLocation(new core.Location(CHAOS_ALTAR.x - 1, CHAOS_ALTAR.y, 0));
    player.needsPlacement = false;
    const connection = new ClientConnection(channel);
    connection.player = player;
    t.after(() => {
      PluginManager.emitPlayerDisconnect({ player, username: player.getUsername() });
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
      player.setRegistered(false);
      core.TaskManager.cancelTasks(player.getIndex());
      core.TaskManager.cancelTasks(player);
      assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
      assert.equal(core.TaskManager.hasActiveTask(player), false);
    });
    assert.equal(player.getEquipment().getItems().some(item => item?.getId() > 0), false);
    const skills = player.getSkillManager();
    skills.setCurrentLevel(core.Skill.PRAYER, 99, false).setMaxLevels(core.Skill.PRAYER, 99, false);
    skills.setExperience(core.Skill.PRAYER, core.SkillManager.getExperienceForLevel(99));
    const gains = [];
    const add = skills.addExperiences.bind(skills);
    t.mock.method(skills, "addExperiences", (skill, amount) => {
      if (skill === core.Skill.PRAYER) gains.push(amount);
      return add(skill, amount);
    });
    for (let i = 0; i < 8; i++) player.getInventory().add(new core.Item(boneId, 1), false);
    const amount = () => player.getInventory().getAmount(boneId);
    assert.equal(amount(), 8);
    const location = new core.Location(CHAOS_ALTAR.x, CHAOS_ALTAR.y, 0);
    const altar = core.MapObjects.getPrivateArea(player, altarId, location);
    assert.ok(altar, "the active map supplies the lawful Chaos altar");
    assert.equal(BoneAltars._test.altarAt(altar.getId(), CHAOS_ALTAR)?.xpScale, 3.5);
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 20, "bounded selected engine turns");
      player.resetUpdating();
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process();
      connection.processTurnPackets();
      const movement = player.getMovementQueue();
      movement.beginCycle();
      movement.processEntityPursuit();
      if (movement.hasPendingWork()) movement.process();
      core.TaskManager.processWalkTo(player.getIndex());
    };
    await connection.dispatch([{ type: "item_on_object", objectId: altarId,
      x: CHAOS_ALTAR.x, y: CHAOS_ALTAR.y, itemId: boneId,
      slot: player.getInventory().getSlotForItemId(boneId), widgetId: 149 << 16 }]);
    for (let i = 0; i < 8 && gains.length === 0; i++) turn();
    assert.deepEqual(gains, [15.75], "a real queued item use admitted the first offering");
    assert.ok([7, 8].includes(amount()), "the Chaos altar can spare the first bone");
    assert.equal(player.getMovementQueue().size(), 0);
    assert.ok(core.TaskManager.hasActiveTask(player.getIndex()), "the repeating offering is live");
    const before = amount();
    console.log("PRAYER_OFFERING_ADMISSION " + JSON.stringify({ mode, turns, before, gains,
      location: [player.getLocation().getX(), player.getLocation().getY()] }));
    async function inventoryWidget(option) {
      const widgetId = CacheDefinitions.getComponentId("inventory:items");
      assert.ok(Number.isInteger(widgetId) && widgetId >= 0, "the cache resolves the inventory component");
      const op = Array.from({ length: 10 }, (_, i) => i + 1).find(candidate =>
        core.ItemActionPacketListener.resolveInventoryWidgetAction(boneId, candidate)?.option === option);
      assert.ok(Number.isInteger(op), `the real inventory resolver supplies ${option}`);
      const slot = player.getInventory().getSlotForItemId(boneId);
      console.log("PRAYER_INVENTORY_WIDGET " + JSON.stringify({ mode, widgetId, op, slot, option }));
      await connection.dispatch([{ type: "widget_action", widgetId, groupId: widgetId >>> 16,
        childId: widgetId & 0xffff, buttonNum: op, itemId: boneId, slot }]);
    }
    if (mode === "repeat" || mode === "widget-examine") {
      if (mode === "widget-examine") {
        await inventoryWidget("Examine");
        turn();
        assert.deepEqual(gains, [15.75], "Examine awards no burial experience");
        assert.equal(amount(), before, "Examine consumes no bone");
      }
      for (let i = 0; i < (mode === "widget-examine" ? 3 : 4); i++) turn();
      assert.deepEqual(gains, [15.75, 15.75], "automatic offering remains functional");
      assert.ok([before - 1, before].includes(amount()));
      return;
    }
    if (mode === "walk") {
      await connection.dispatch([{ type: "move", worldX: CHAOS_ALTAR.x - 2,
        worldY: CHAOS_ALTAR.y, modifierFlags: 0 }]);
    } else if (mode === "widget-bury") {
      await inventoryWidget("Bury");
    } else {
      const slot = player.getInventory().getSlotForItemId(boneId);
      assert.equal(CacheDefinitions.getItem(boneId).inventoryActions[0], "Bury");
      await connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16,
        itemId: boneId, slot, option: "Bury", optionIndex: 1 }]);
    }
    turn();
    const buries = mode === "bury" || mode === "widget-bury";
    const expected = buries ? [15.75, 4.5] : [15.75];
    assert.deepEqual(gains, expected, "the interruption itself completed before the target boundary");
    assert.equal(amount(), before - (buries ? 1 : 0));
    for (let i = 0; i < 5; i++) turn();
    console.log("PRAYER_OFFERING_INTERRUPTED " + JSON.stringify({ mode, turns, before, after: amount(), gains }));
    assert.deepEqual(gains, expected, "an interrupted altar loop must not award another offering");
    assert.equal(amount(), before - (buries ? 1 : 0), "unresolved offerings preserve their bones");
  });
});
