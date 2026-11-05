const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const diary = require("../plugins/achievements/diaries/ArdougneMagicGuildDiary.plugin");
const core = PluginManager.getCoreApi();

const savedAreas = [...AreaManager.areas];
const customHooks = PluginManager.customEventHooks;
const objectHooks = PluginManager.objectHooksByName;
const objectHooksById = PluginManager.objectHooksById;
const objectInteractionHooks = PluginManager.objectInteractionHooks;
const doorIds = new Set([core.ObjectIdentifiers.MAGIC_GUILD_DOOR, core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2]);
const credits = [];
let api;
let playerIndex = 26800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2584, 3087);
  PluginManager.customEventHooks = new Map();
  PluginManager.objectHooksByName = new Map();
  PluginManager.objectHooksById = new Map();
  PluginManager.objectInteractionHooks = [];
  api = PluginManager.createApi("ArdougneMagicGuildDiaryTest");
  require("../plugins/objects/Doors.plugin").register({ ...api, onServerStartup() {}, onRegionLoaded() {} });
  diary.register(api);
  api.onCustomEvent("diary:task", (event) => credits.push(event));
});

after(() => {
  AreaManager.areas.splice(0, AreaManager.areas.length, ...savedAreas);
  PluginManager.customEventHooks = customHooks;
  PluginManager.objectHooksByName = objectHooks;
  PluginManager.objectHooksById = objectHooksById;
  PluginManager.objectInteractionHooks = objectInteractionHooks;
});

function actor(x, y, magic = 66, baseMagic = magic) {
  const player = new Player(null, new core.Location(x, y, 0));
  player.setIndex(playerIndex++);
  player.setUsername("ardougne-magic-guild-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setRunEnergy(100);
  player.setMultiIcon = () => {};
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getSkillManager().setMaxLevels(core.Skill.MAGIC, baseMagic, false);
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, magic, false);
  AreaManager.process(player);
  return player;
}

function moveAlong(player, steps, run = false) {
  const movement = player.getMovementQueue();
  movement.beginCycle();
  player.setRunning(run);
  for (const [x, y] of steps) movement.addSteps(new core.Location(x, y, 0));
  movement.process();
  AreaManager.process(player);
}

function move(player, x, y, run = false) {
  moveAlong(player, [[x, y]], run);
}

function clickDoor(player, id, x, y) {
  const definition = core.ObjectDefinition.forId(id);
  const object = core.MapObjects.get(id, new core.Location(x, y, 0), null);
  assert.ok(object, `cache map has Magic guild door ${id} at ${x},${y}`);
  const event = {
    player,
    object,
    objectId: id,
    definition,
    location: { x, y, z: 0 },
    clickType: 1,
    option: "open",
    handled: false,
  };
  return PluginManager.emitObjectInteraction(event);
}

function toggleRequest(player, id, x, y) {
  const event = {
    player,
    objectId: id,
    definition: core.ObjectDefinition.forId(id),
    location: { x, y, z: 0 },
    handled: false,
  };
  PluginManager.emitCustomEvent("door:toggle", event);
  return event;
}

function isCredited(player) {
  return credits.some((event) => event.player === player && event.task === "enter-the-magic-guild");
}

test("Magic Guild entry requires 66 boosted Magic and credits only a live inward door crossing", () => {
  assert.equal(core.ObjectDefinition.forId(core.ObjectIdentifiers.MAGIC_GUILD_DOOR).getName(), "Magic guild door");
  assert.equal(core.ObjectDefinition.forId(core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2).getName(), "Magic guild door");
  for (const [id, x, y] of [
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2584, 3088],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2584, 3087],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2597, 3087],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2597, 3088],
  ]) {
    assert.equal(core.MapObjects.get(id, new core.Location(x, y, 0))?.getId(), id,
      `cache map has object ${id} at ${x},${y}`);
  }

  credits.length = 0;
  const lowWest = actor(2584, 3087, 65);
  assert.equal(clickDoor(lowWest, core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2584, 3087), true);
  move(lowWest, 2584, 3087);
  assert.equal(isCredited(lowWest), false, "65 Magic cannot open the west entrance");

  const unboostedEast = actor(2597, 3087, 65);
  assert.equal(clickDoor(unboostedEast, core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2597, 3087), true);
  move(unboostedEast, 2597, 3087);
  assert.equal(isCredited(unboostedEast), false, "65 Magic cannot open the east entrance");

  for (const [id, x, y, startX] of [
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2584, 3088, 2584],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2584, 3087, 2584],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2597, 3087, 2597],
    [core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2597, 3088, 2597],
  ]) {
    const thresholdPlayer = actor(startX, y, 1);
    assert.equal(toggleRequest(thresholdPlayer, id, x, y).handled, true,
      `level 1 is denied at threshold ${x},${y}`);
  }

  const boostedWest = actor(2583, 3087, 66, 65);
  assert.equal(clickDoor(boostedWest, core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2584, 3087), true);
  assert.equal(isCredited(boostedWest), false, "opening the west door does not count as entry");
  move(boostedWest, 2584, 3087);
  assert.equal(isCredited(boostedWest), false, "reaching the doorway does not count as entry");
  move(boostedWest, 2585, 3087);
  assert.equal(isCredited(boostedWest), true, "66 boosted Magic can enter from the west");
  assert.equal(credits.filter((event) => event.player === boostedWest).length, 1, "a crossing credits once");
  move(boostedWest, 2584, 3087);
  assert.equal(credits.filter((event) => event.player === boostedWest).length, 1, "leaving does not repeat the credit");

  const follower = actor(2583, 3087, 1);
  const movement = follower.getMovementQueue();
  const guard = diary._test.movementGuards.get(follower);
  assert.ok(guard, "the area installs the follower's movement guard");
  assert.equal(guard.original.call(movement, new core.Location(2585, 3087, 0), new core.Location(2584, 3087, 0)), true,
    "the opened cache door is passable through normal collision routing");
  assert.equal(movement.canWalkTo(new core.Location(2585, 3087, 0), new core.Location(2584, 3087, 0)), false,
    "the area blocks the west threshold for the low-level follower");
  move(follower, 2585, 3087);
  move(follower, 2585, 3087);
  assert.equal(follower.getLocation().getX() <= 2584, true,
    "an underlevelled follower stays outside after another player opens the west door");
  assert.equal(isCredited(follower), false);

  const eastFollower = actor(2597, 3088, 1);
  const eastMovement = eastFollower.getMovementQueue();
  assert.equal(eastMovement.canWalkTo(new core.Location(2596, 3088, 0), new core.Location(2597, 3088, 0)), false,
    "the area blocks the east threshold for a low-level follower");

  const boostedEast = actor(2598, 3088, 66, 65);
  assert.equal(clickDoor(boostedEast, core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2, 2597, 3088), true);
  assert.equal(isCredited(boostedEast), false, "opening the east door does not count as entry");
  move(boostedEast, 2597, 3088);
  assert.equal(isCredited(boostedEast), false, "reaching the east doorway does not count as entry");
  move(boostedEast, 2596, 3088);
  assert.equal(isCredited(boostedEast), true, "66 boosted Magic can enter from the east");

  const lowExit = actor(2585, 3088, 1);
  const exitRequest = toggleRequest(lowExit, core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2584, 3088);
  assert.equal(exitRequest.handled, false, "leaving the guild does not require Magic");
  const closeRequest = toggleRequest(lowExit, core.ObjectIdentifiers.MAGIC_GUILD_DOOR, 2584, 3088);
  closeRequest.option = "close";
  PluginManager.emitCustomEvent("door:toggle", closeRequest);
  assert.equal(closeRequest.handled, false, "closing a door does not require Magic");
  move(lowExit, 2584, 3088);
  assert.equal(isCredited(lowExit), false, "leaving through the doorway does not credit entry");

  credits.length = 0;
  const runner = actor(2583, 3087, 66);
  moveAlong(runner, [[2584, 3087], [2585, 3088]], true);
  assert.equal(isCredited(runner), true, "a diagonal running step through the doorway counts");

  const diagonal = actor(2583, 3086, 66);
  move(diagonal, 2584, 3087);
  assert.equal(isCredited(diagonal), false, "a diagonal step outside the door lane does not count");

  const wrongY = actor(2583, 3089, 66);
  move(wrongY, 2584, 3089);
  assert.equal(isCredited(wrongY), false, "crossing outside the two door tiles does not count");

  const teleported = actor(2583, 3087, 66);
  teleported.moveTo(new core.Location(2584, 3087, 0));
  AreaManager.process(teleported);
  assert.equal(isCredited(teleported), false, "teleporting through a doorway does not count");

  const loggedInside = actor(2584, 3087, 66);
  AreaManager.process(loggedInside);
  assert.equal(isCredited(loggedInside), false, "logging in inside the guild does not count");

  const privateInstance = actor(2583, 3087, 66);
  privateInstance.getPrivateArea = () => ({ id: "magic-guild-diary-test" });
  move(privateInstance, 2584, 3087);
  move(privateInstance, 2585, 3087);
  assert.equal(isCredited(privateInstance), false, "a private instance does not count");

  const dead = actor(2583, 3087, 66);
  dead.getHitpoints = () => 0;
  move(dead, 2584, 3087);
  move(dead, 2585, 3087);
  assert.equal(isCredited(dead), false, "a dead player does not receive credit");
});
