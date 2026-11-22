// Run after `yarn build`: node --test tests/brain-living-lower-door.test.cjs
// rsprox 3032 (rev 231), ticks 4905-4910: Open on brain_living_lower_door at
// 3817,2841 adds inviswall on the doorway and brain_living_lower_door_secureopen
// one tile west with sound 62; the original door returns two ticks later.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { Player } = require("../dist/game/entity/impl/player/Player");

const core = PluginManager.getCoreApi();
const DOOR = { x: 3817, y: 2841, z: 0 };
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOOR.x, DOOR.y);
});

function visitor(x, y) {
  const interactions = new Map(), tasks = [], sounds = [];
  let route;
  const doorCore = { ...core, TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); }, cancelTasks: noop } };
  const api = new Proxy({
    core: doorCore,
    getTaskManager: () => doorCore.TaskManager,
    onCustomEvent: noop,
    emitCustomEvent: noop,
    onObjectInteraction: (name, handlers) => interactions.set(name, handlers),
    onObjectRoute: (handler) => { route = handler; },
    onServerStartup: (handler) => handler(),
  }, { get: (target, key) => target[key] ?? noop });
  require("../plugins/objects/Doors.plugin").register(api);

  const player = new Player(new BotPlayerSession());
  player.setUsername("livinglowerdoor");
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, DOOR.z));
  player.isUnwatchedBot = () => false;
  player.getPacketSender = () => new Proxy({ sendSoundEffect: (id) => sounds.push(id) }, { get: (target, key) => target[key] ?? noop });

  function click(object) {
    const at = object.getLocation(), definition = object.getDefinition();
    return interactions.get(definition.getName()).Open({
      player, object, objectId: object.getId(), definition,
      location: { x: at.getX(), y: at.getY(), z: at.getZ() }, clickType: 1,
    });
  }
  function tick() {
    player.getMovementQueue().process();
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
  function routeOpen(object) {
    const event = { player, object, objectId: object.getId(), definition: object.getDefinition(), clickType: 1,
      sourceLocation: { x: player.getLocation().getX(), y: player.getLocation().getY(), z: DOOR.z } };
    route(event);
    return event;
  }
  return { player, click, tick, routeOpen, sounds };
}

const locsAt = (x, y) => MapObjects.getObjectsAt(new core.Location(x, y, DOOR.z), null);
const idsAt = (x, y) => locsAt(x, y).map((object) => object.getId());

test("Living lower door: Open adds the captured blocker and west leaf, then restores after two ticks", () => {
  const doorId = core.CacheDefinitions.getLocId("brain_living_lower_door");
  const openId = core.CacheDefinitions.getLocId("brain_living_lower_door_secureopen");
  const inviswallId = core.CacheDefinitions.getLocId("inviswall");
  const door = locsAt(DOOR.x, DOOR.y).find((object) => object.getId() === doorId);
  assert.ok(door, "the closed door is placed on the live map");
  assert.equal(door.getFace(), 0);

  const visitorState = visitor(DOOR.x, DOOR.y + 1);
  assert.equal(visitorState.routeOpen(door).operateBeforeMovement, true,
    "Open is processed before movement across the door");
  assert.equal(visitorState.click(door), true, "the door takes Open");
  assert.deepEqual(visitorState.sounds, [62], "door_open plays on the click");
  assert.ok(idsAt(DOOR.x, DOOR.y).includes(inviswallId), "the doorway stays blocked while open");
  assert.ok(idsAt(DOOR.x - 1, DOOR.y).includes(openId), "the secure open leaf swings one tile west");
  assert.ok(!idsAt(DOOR.x, DOOR.y).includes(doorId), "the closed door is replaced");

  visitorState.tick();
  assert.ok(idsAt(DOOR.x, DOOR.y).includes(inviswallId), "still open after one tick");
  visitorState.tick();
  assert.deepEqual([visitorState.player.getLocation().getX(), visitorState.player.getLocation().getY()], [DOOR.x, DOOR.y - 1],
    "the opener crosses to the south side");
  assert.ok(idsAt(DOOR.x, DOOR.y).includes(doorId), "the original door returns after two ticks");
  assert.ok(!idsAt(DOOR.x, DOOR.y).includes(inviswallId));
  assert.ok(!idsAt(DOOR.x - 1, DOOR.y).includes(openId));
  assert.deepEqual(visitorState.sounds, [62], "the timed close is silent");
});
