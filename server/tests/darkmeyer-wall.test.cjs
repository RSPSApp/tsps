// Run after `yarn build`: node --test tests/darkmeyer-wall.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

const DarkmeyerWall = require("../plugins/areas/DarkmeyerWall.plugin");
const Agility = require("../plugins/skills/Agility.plugin");

const tasks = [];
const taskManager = {
  submit(task) {
    if (task.isRunning()) return;
    task.setRunning(true);
    if (task.isImmediate()) task.execute();
    tasks.push(task);
  },
};
function tick() {
  for (const task of tasks.splice(0)) {
    if (task.tick()) tasks.push(task);
  }
}

const hooks = { route: [], click: new Map(), itemOnObject: [], login: [], persisted: {} };
const core = PluginManager.getCoreApi();
const api = {
  core,
  getTaskManager: () => taskManager,
  getItemOnGroundManager: () => ({ registerLocation() {}, ownedBy: () => [], inventoryCapacity: () => 1 }),
  onGroundItemPickup() {},
  persistAttribute: (key, value) => { hooks.persisted[key] = value; },
  onObjectRoute: (handler) => hooks.route.push(handler),
  onObjectFirstClick: (ids, handler) => ids.forEach((id) => hooks.click.set(id, handler)),
  onObjectInteraction() {},
  onCanTeleport() {},
  registerRunEnergyRestoreModifier() {},
  registerArea() {},
  onPlayerLogout() {},
  onPlayerLogin: (handler) => hooks.login.push(handler),
  onPlayerProcess() {},
  onNpcInteraction() {},
  onCustomEvent() {},
  emitCustomEvent() {},
  onItemOnObject: (item, object, handler, filter) => hooks.itemOnObject.push({ item, object, handler, filter }),
  log() {},
};

let INNER, OUTER, INNER_VARBIT, OUTER_VARBIT, LONG_ROPE;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  Agility.register(api);
  DarkmeyerWall.register(api);
  INNER = CacheDefinitions.getLocId("darkm_outer_wall_2h_shortcut");
  OUTER = CacheDefinitions.getLocId("darkm_outer_wall_3h_shortcut");
  INNER_VARBIT = CacheDefinitions.getVarbitId("darkm_shortcut_inner");
  OUTER_VARBIT = CacheDefinitions.getVarbitId("darkm_shortcut_outer");
  LONG_ROPE = CacheDefinitions.getObjId("long_rope");
  assert.deepEqual([INNER, OUTER, INNER_VARBIT, OUTER_VARBIT, LONG_ROPE], [39542, 39541, 10449, 10450, 24790]);
});

function createPlayer(at, { agility = 63, ropes = 0, attributes = {} } = {}) {
  let location = new Location(...at);
  const attrs = new Map(Object.entries(attributes));
  const varbits = new Map();
  const state = { animations: [], messages: [], mesboxes: [], held: ropes, moves: [], faces: [] };
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    getVarp: () => 0,
    sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
    sendSound() { return sender; },
    sendSoundEffect() { return sender; },
    sendTypedMessage: (type, message) => state.messages.push(message),
    sendClientScript() { return sender; },
  };
  const player = {
    state,
    varbits,
    getLocation: () => location,
    setLocation: (next) => { location = next.clone(); return player; },
    moveTo: (next) => { location = next.clone(); state.moves.push([next.getX(), next.getY(), next.getZ()]); return player; },
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, handleRegionChange() {} }),
    getForceMovement: () => null,
    setForceMovement() { return player; },
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    performAnimation: (animation) => state.animations.push(animation.getId()),
    performGraphic() {},
    setPositionToFace: (tile) => state.faces.push(tile && [tile.getX(), tile.getY()]),
    forceChat() {},
    sendMessage: (message) => state.messages.push(message),
    getDialogueManager: () => ({
      startDialogues: (chain) => state.mesboxes.push(chain),
    }),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.AGILITY ? agility : 99),
      getMaxLevel: () => 99,
      addExperiences() {},
      getExperience: () => 0,
    }),
    getPacketSender: () => sender,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() {} }) }),
    getInventory: () => ({
      contains: (id) => id === LONG_ROPE && state.held > 0,
      getAmount: (id) => (id === LONG_ROPE ? state.held : 0),
      delete: (id, amount) => { if (id === LONG_ROPE) state.held -= amount; },
      isFull: () => false,
      addItem() {},
    }),
    getEquipment: () => ({ getItems: () => [] }),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getUsername: () => "wall tester",
    getPrivateArea: () => null,
  };
  return player;
}

const WALL_TILES = { inner: [3668, 3375, 0], outer: [3671, 3375, 0] };

function wallObject(id, tile) {
  return { getId: () => id, getFace: () => 0, getLocation: () => new Location(...tile) };
}

/** Uses a long rope on the wall the way the named hook does: only when the player's variant is a "Wall". */
function useRope(player, id, tile) {
  const hook = hooks.itemOnObject.find((entry) => entry.item === "Long rope");
  assert.ok(hook, "the plugin hooks Long rope on Wall");
  assert.equal(hook.object, "Wall");
  assert.equal(ObjectDefinition.forPlayer(id, player)?.getName(), hook.object);
  const event = { player, object: wallObject(id, tile), objectId: id, itemId: LONG_ROPE, itemSlot: 0, location: { x: tile[0], y: tile[1], z: tile[2] }, handled: false };
  return hook.handler(event);
}

/** Clicks Climb the way the object packet would: routed, with the definition the player sees. */
function climb(player, id, tile) {
  const object = wallObject(id, tile);
  const definition = ObjectDefinition.forPlayer(id, player);
  const route = { player, object, definition, objectId: id, clickType: 1, destination: null };
  hooks.route.forEach((handler) => handler(route));
  if (route.destination) player.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  const handled = hooks.click.get(id)({ player, object, definition, objectId: id, clickType: 1, location: { x: tile[0], y: tile[1], z: tile[2] }, handled: false });
  let ticks = 0;
  const landed = [];
  for (; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 20, "the climb never finished");
    const moves = player.state.moves.length;
    tick();
    if (player.state.moves.length > moves) landed.push(ticks + 1);
  }
  return { handled, landed };
}

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

test("the walls stand where the shortcut's ends are, and the three ends are open tiles", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  RegionManager.init();
  RegionManager.loadMapFiles(3670, 3375, true);
  assert.ok(MapObjects.get(INNER, new Location(...WALL_TILES.inner), null), "inner wall at (3668, 3375)");
  assert.ok(MapObjects.get(OUTER, new Location(...WALL_TILES.outer), null), "outer wall at (3671, 3375)");
  for (const x of [3667, 3670, 3673]) assert.equal(RegionManager.blocked(new Location(x, 3375, 0), null), false, `${x} is open`);
});

test("each wall shows no option until its rope is attached, then Climb (cache multilocs)", () => {
  const player = createPlayer([3667, 3375, 0]);
  assert.equal(ObjectDefinition.forPlayer(INNER, player).getActions()?.[0] ?? null, null);
  assert.equal(ObjectDefinition.forPlayer(OUTER, player).getActions()?.[0] ?? null, null);
  player.varbits.set(INNER_VARBIT, 1);
  player.varbits.set(OUTER_VARBIT, 1);
  assert.equal(ObjectDefinition.forPlayer(INNER, player).getActions()[0], "Climb");
  assert.equal(ObjectDefinition.forPlayer(OUTER, player).getActions()[0], "Climb");
});

test("a long rope on each wall is used up, sets its varbit and says so (rsprox 362, 1862)", () => {
  const player = createPlayer([3667, 3375, 0], { ropes: 2 });
  assert.equal(useRope(player, INNER, WALL_TILES.inner), true);
  assert.equal(player.state.held, 1);
  assert.equal(player.varbits.get(INNER_VARBIT), 1);
  assert.equal(player.varbits.get(OUTER_VARBIT), undefined, "only that wall gets its rope");
  assert.deepEqual(player.state.animations, [CacheDefinitions.getSeqId("human_pickuptable")]);
  assert.equal(player.state.mesboxes.length, 1);

  player.setLocation(new Location(3670, 3375, 0));
  assert.equal(useRope(player, OUTER, WALL_TILES.outer), true);
  assert.equal(player.state.held, 0);
  assert.equal(player.varbits.get(OUTER_VARBIT), 1);
  assert.equal(player.state.animations.at(-1), CacheDefinitions.getSeqId("human_pickupfloor"));
  assert.equal(player.getAttribute(DarkmeyerWall._test.ROPES_ATTRIBUTE), 3);
  assert.equal(hooks.persisted[DarkmeyerWall._test.ROPES_ATTRIBUTE], 0, "the ropes are saved, starting at none");
});

test("a wall that already has its rope keeps the long rope (rec 362: Nothing interesting happens)", () => {
  const player = createPlayer([3667, 3375, 0], { ropes: 1, attributes: { [DarkmeyerWall._test.ROPES_ATTRIBUTE]: 1 } });
  player.varbits.set(INNER_VARBIT, 1);
  assert.equal(useRope(player, INNER, WALL_TILES.inner), false, "left to the game's default line");
  assert.equal(player.state.held, 1);
  assert.equal(player.state.mesboxes.length, 0);
});

test("logging in restores the attached ropes' varbits", () => {
  const player = createPlayer([3667, 3375, 0], { attributes: { [DarkmeyerWall._test.ROPES_ATTRIBUTE]: 2 } });
  hooks.login.forEach((handler) => handler({ player }));
  assert.equal(player.varbits.get(OUTER_VARBIT), 1);
  assert.equal(player.varbits.get(INNER_VARBIT), undefined);
});

test("Climb crosses each wall both ways, up and down a tick after the click (rsprox 362)", () => {
  const UP = 828; // human_reachforladder
  const DOWN = 827; // human_pickupfloor
  assert.equal(CacheDefinitions.getSeqId("human_reachforladder"), UP);
  assert.equal(CacheDefinitions.getSeqId("human_pickupfloor"), DOWN);
  const player = createPlayer([3667, 3375, 0], { attributes: { [DarkmeyerWall._test.ROPES_ATTRIBUTE]: 3 } });
  player.varbits.set(INNER_VARBIT, 1);
  player.varbits.set(OUTER_VARBIT, 1);
  const legs = [
    [INNER, WALL_TILES.inner, [3670, 3375, 0], UP],
    [OUTER, WALL_TILES.outer, [3673, 3375, 0], DOWN],
    [OUTER, WALL_TILES.outer, [3670, 3375, 0], UP],
    [INNER, WALL_TILES.inner, [3667, 3375, 0], DOWN],
  ];
  for (const [id, tile, to, animation] of legs) {
    const before = player.state.animations.length;
    const result = climb(player, id, tile);
    assert.notEqual(result.handled, false);
    assert.deepEqual(tileOf(player), to);
    assert.deepEqual(result.landed, [1], "on the other side one tick after the click");
    assert.deepEqual(player.state.animations.slice(before), [animation], "the climb animation plays out (no reset)");
  }
});

test("Climb needs 63 Agility (Wiki), boosts count", () => {
  const player = createPlayer([3667, 3375, 0], { agility: 62, attributes: { [DarkmeyerWall._test.ROPES_ATTRIBUTE]: 1 } });
  player.varbits.set(INNER_VARBIT, 1);
  climb(player, INNER, WALL_TILES.inner);
  assert.deepEqual(tileOf(player), [3667, 3375, 0]);
  assert.match(player.state.messages.at(-1), /63/);
});

test("a wall without its rope can't be climbed, whatever the client sends", () => {
  const player = createPlayer([3667, 3375, 0]);
  const result = climb(player, INNER, WALL_TILES.inner);
  assert.equal(result.handled, false);
  assert.deepEqual(tileOf(player), [3667, 3375, 0]);
});
