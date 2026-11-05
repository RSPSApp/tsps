const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Doors = require("../plugins/objects/Doors.plugin");
const Thieving = require("../plugins/skills/Thieving.plugin");
const CastleChestDiary = require("../plugins/achievements/diaries/ArdougneCastleChestDiary.plugin");
const core = PluginManager.getCoreApi();
const O = core.ObjectIdentifiers;
const SOUTH = { id: O.DOOR_283, x: 2572, y: 3288, z: 1, insideY: 3287, outsideY: 3289 };
const NORTH = { id: O.DOOR_283, x: 2572, y: 3305, z: 1, insideY: 3306, outsideY: 3304 };
const diaryCredits = [];
const cacheDoors = new Map();
const savedHooks = {
  before: PluginManager.beforeObjectInteractionHooks,
  named: PluginManager.objectHooksByName,
  byId: PluginManager.objectHooksById,
  generic: PluginManager.objectInteractionHooks,
  custom: PluginManager.customEventHooks,
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SOUTH.x, SOUTH.y);
  for (const door of [SOUTH, NORTH]) {
    const object = core.MapObjects.get(door.id, new core.Location(door.x, door.y, door.z), null);
    assert.ok(object, `the map cache places door ${door.id} at ${door.x},${door.y},${door.z}`);
    assert.equal(object.getFace(), door === SOUTH ? 3 : 1, "the cache object has the researched wall orientation");
    cacheDoors.set(`${door.x},${door.y},${door.z}`, object);
  }
  PluginManager.beforeObjectInteractionHooks = [];
  PluginManager.objectHooksByName = new Map();
  PluginManager.objectHooksById = new Map();
  PluginManager.objectInteractionHooks = [];
  PluginManager.customEventHooks = new Map();
  const doorApi = PluginManager.createApi("Doors");
  Doors.register({ ...doorApi, onServerStartup() {}, onRegionLoaded() {} });
  Thieving.register(PluginManager.createApi("Thieving"));
  CastleChestDiary.register(PluginManager.createApi("ArdougneCastleChestDiary"));
  PluginManager.createApi("ArdougneCastleDiaryCreditTest").onCustomEvent("diary:task", (event) => diaryCredits.push(event));
});

after(() => {
  PluginManager.beforeObjectInteractionHooks = savedHooks.before;
  PluginManager.objectHooksByName = savedHooks.named;
  PluginManager.objectHooksById = savedHooks.byId;
  PluginManager.objectInteractionHooks = savedHooks.generic;
  PluginManager.customEventHooks = savedHooks.custom;
});

function actor(x, y, thieving = 61, hitpoints = 10, baseThieving = thieving) {
  const player = new Player(null, new core.Location(x, y, 1));
  player.setIndex(81000 + Math.floor(Math.random() * 10000));
  player.setUsername("ardougne-lockpick-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.getSkillManager().setMaxLevels(core.Skill.THIEVING, baseThieving, false);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, thieving, false);
  player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, hitpoints, false);
  player.getSkillManager().addExperiences = (skill, amount) => {
    (player.xp ??= []).push([skill, amount]);
  };
  player.damagePackets = [];
  const combat = player.getCombat();
  combat.getHitQueue = () => ({ addPendingDamage: (hits) => player.damagePackets.push(hits) });
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  return player;
}

function click(player, door, option, selectedObject = null) {
  const object = selectedObject ?? cacheDoors.get(`${door.x},${door.y},${door.z}`);
  assert.ok(object, `the cache map places door ${door.id} at ${door.x},${door.y},${door.z}`);
  const definition = core.ObjectDefinition.forId(door.id);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `the cache definition offers ${option}`);
  const location = object.getLocation();
  new ObjectActionPacketListener().executeAction(player, object.getId(), location.getX(), location.getY(), clickType);
  for (let tick = 0; tick < 6; tick++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    player.getMovementQueue().beginCycle();
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
  }
  return { event: { object }, handled: true };
}

function walk(player, x, y) {
  const route = PathFinder.calculateWalkRoute(player, x, y);
  const movement = player.getMovementQueue();
  for (let tick = 0; movement.points.length && tick < 20; tick++) movement.process();
  assert.equal(movement.points.length, 0, "the collision-aware movement queue finishes its route");
  return route;
}

function withRandom(value, callback) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

function withRandomSequence(values, callback) {
  const original = Math.random;
  let index = 0;
  Math.random = () => values[index++];
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

describe("Ardougne Castle lockpick doors", { concurrency: false }, () => {
test("the cache doors require lockpicking outside, then collision permits normal travel for both players", () => {
  assert.equal(core.ObjectDefinition.forId(O.DOOR_283).getName(), "Door");
  assert.deepEqual(core.ObjectDefinition.forId(O.DOOR_283).getInteractions().slice(0, 2), ["Open", "Pick-lock"]);

  const novice = actor(NORTH.x, NORTH.outsideY, 1, 10);
  withRandom(0.99, () => click(novice, NORTH, "Pick-lock"));
  assert.equal(novice.damagePackets.length, 1, "the trap roll has no 61 Thieving requirement");
  assert.equal(novice.damagePackets[0][0].getDamage(), 1, "10% of 10 maximum Hitpoints rounds down to one hitpoint");
  assert.equal(novice.xp, undefined, "the novice cannot unlock the door");
  assert.match(novice.messages.at(-1), /level 61 Thieving/);
  assert.equal(core.RegionManager.canMove(NORTH.x, NORTH.y, NORTH.x, NORTH.y + 1, NORTH.z, 1, 1, null), false);

  const inside = actor(NORTH.x, NORTH.insideY);
  const opened = withRandom(0, () => click(inside, NORTH, "Open"));
  assert.equal(inside.xp, undefined, "free inside opening does not award lockpicking XP");
  assert.equal(inside.damagePackets.length, 0, "free inside opening does not roll the trap");
  assert.equal(core.RegionManager.canMove(NORTH.x, NORTH.y, NORTH.x, NORTH.y + 1, NORTH.z, 1, 1, null), true);
  click(inside, NORTH, "Open", opened.event.object);
  assert.equal(core.RegionManager.canMove(NORTH.x, NORTH.y, NORTH.x, NORTH.y + 1, NORTH.z, 1, 1, null), true,
    "an inside click cannot close the threshold while someone may be exiting");

  const outside = actor(SOUTH.x, SOUTH.outsideY, 61, 10, 60);
  assert.equal(core.RegionManager.canMove(SOUTH.x, SOUTH.y, SOUTH.x, SOUTH.y - 1, SOUTH.z, 1, 1, null), false);
  assert.equal(walk(outside, SOUTH.x, SOUTH.insideY), 1, "ordinary routing stops at the closed south door");
  assert.equal(outside.getMovementQueue().pathY, SOUTH.y, "the route ends outside the locked door");
  const open = click(outside, SOUTH, "Open");
  assert.equal(open.handled, true, "the plugin claims outside Open before the generic door handler");
  assert.equal(core.RegionManager.canMove(SOUTH.x, SOUTH.y, SOUTH.x, SOUTH.y - 1, SOUTH.z, 1, 1, null), false,
    "outside Open cannot bypass the lock");

  withRandomSequence([0, 0.99], () => click(outside, SOUTH, "Pick-lock"));
  assert.equal(outside.xp, undefined, "a failed lock roll awards no Thieving XP");
  assert.equal(core.RegionManager.canMove(SOUTH.x, SOUTH.y, SOUTH.x, SOUTH.y - 1, SOUTH.z, 1, 1, null), false);

  withRandom(0, () => click(outside, SOUTH, "Pick-lock"));
  assert.deepEqual(outside.xp, [[core.Skill.THIEVING, 50]], "success grants the Wiki's 50 Thieving XP without requiring a lockpick item");
  assert.equal(core.RegionManager.canMove(SOUTH.x, SOUTH.y, SOUTH.x, SOUTH.y - 1, SOUTH.z, 1, 1, null), true,
    "the Doors plugin updates cache collision when the lock opens");
  const openLeaf = core.World.getObjects().find((candidate) => candidate.getId() === SOUTH.id &&
    Math.abs(candidate.getLocation().getX() - SOUTH.x) + Math.abs(candidate.getLocation().getY() - SOUTH.y) === 1);
  assert.ok(openLeaf, "opening swings the cache door leaf onto an adjacent tile");
  assert.equal(walk(outside, SOUTH.x, SOUTH.insideY), 1, "normal routing crosses the opened door");
  assert.equal(outside.getMovementQueue().pathY, SOUTH.insideY, "the route reaches the inside tile");
  assert.equal(outside.getLocation().getY(), SOUTH.insideY, "collision-aware movement lands inside");

  const secondPlayer = actor(SOUTH.x, SOUTH.insideY);
  assert.equal(walk(secondPlayer, SOUTH.x, SOUTH.outsideY), 1, "a second player can route out through the shared opening");
  assert.equal(secondPlayer.getMovementQueue().pathY, SOUTH.outsideY, "the second player's route exits the room");
  assert.equal(secondPlayer.getLocation().getY(), SOUTH.outsideY, "collision-aware movement exits the room");
  click(outside, SOUTH, "Open", openLeaf);
  assert.equal(core.RegionManager.canMove(SOUTH.x, SOUTH.y, SOUTH.x, SOUTH.y - 1, SOUTH.z, 1, 1, null), false,
    "clicking the swung leaf closes the door and restores collision");
  assert.ok(core.MapObjects.get(SOUTH.id, new core.Location(SOUTH.x, SOUTH.y, SOUTH.z), null),
    "closing restores the leaf to its cache tile");
  assert.deepEqual(diaryCredits, [], "unlocking the door does not credit the chest diary task");
});

test("the cache-chart rolls match Wiki success rates at levels 1 and 61", () => {
  assert.equal(Thieving._test.chanceNumerator(200, 270, 1), 201);
  assert.equal(Thieving._test.chanceNumerator(200, 270, 61), 244);
  assert.equal(Thieving._test.chanceNumerator(4, 40, 1), 5);
  assert.equal(Thieving._test.chanceNumerator(4, 40, 61), 27);
});

});
