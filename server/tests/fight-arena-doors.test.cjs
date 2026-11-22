// Run after `yarn build`: node --test tests/fight-arena-doors.test.cjs
//
// Fight Arena's plain doors (fightarena_door1 81) pass the player through and shut again, as the
// user's rsprox captures play them (local 1001680 ticks 7032-7036 and 7335-7337, local 1002138
// ticks 11377-11380 and 11676-11678): inviswall on the doorway, inactivepoordoor on the tile
// outside, sound 62, the player steps onto the doorway tile and the door is back two ticks later.
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
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.RegionManager.init();
});

/** One player driving the real Doors plugin, with its tasks run by hand. */
function visitor(x, y) {
  const hooks = new Map(), interactions = new Map(), tasks = [], sounds = [];
  let route = null;
  const doorCore = { ...core, TaskManager: { submit: task => { task.setRunning(true); tasks.push(task); }, cancelTasks: noop } };
  const api = new Proxy({ core: doorCore, getTaskManager: () => doorCore.TaskManager,
    onCustomEvent(name, handler) {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name).push(handler);
    },
    emitCustomEvent(name, event) { for (const handler of hooks.get(name) ?? []) handler(event); },
    onObjectInteraction(name, handlers) { interactions.set(name, handlers); },
    onObjectRoute(handler) { route = handler; },
    onServerStartup(handler) { handler(); },
  }, { get: (target, key) => target[key] ?? noop });
  require("../plugins/objects/Doors.plugin").register(api);
  const player = new Player(new BotPlayerSession());
  player.setUsername("arenadoor");
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.isUnwatchedBot = () => false;
  player.getPacketSender = () => new Proxy({
    sendSoundEffect: (id) => sounds.push(id),
  }, { get: (target, key) => target[key] ?? noop });
  function click(object) {
    const location = object.getLocation(), definition = object.getDefinition();
    return interactions.get(definition.getName()).Open({ player, object, objectId: object.getId(),
      definition, location: { x: location.getX(), y: location.getY(), z: location.getZ() }, clickType: 1 });
  }
  function tick() {
    player.getMovementQueue().process();
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
  /** The route event the movement queue would build for an Open click on `object`. */
  function routeOpen(object) {
    const event = { player, object, objectId: object.getId(), definition: object.getDefinition(), clickType: 1,
      sourceLocation: { x: player.getLocation().getX(), y: player.getLocation().getY(), z: 0 } };
    route(event);
    return event;
  }
  return { player, click, tick, sounds, routeOpen };
}

const locsAt = (x, y) => MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? [];

function arenaDoor(x, y) {
  core.RegionManager.loadMapFiles(x, y);
  const door = locsAt(x, y).find(object => object.getId() === core.CacheDefinitions.getLocId("fightarena_door1"));
  assert.ok(door, `fightarena_door1 at ${x},${y} must exist in the active cache`);
  return door;
}

// [door x, y, cached face, the outside tile (where the open leaf stands and the player starts),
//  the open leaf's rotation]
const DOORS = [
  [2617, 3171, 1, [2617, 3172], 2],
  [2585, 3141, 0, [2584, 3141], 1],
];

test("Fight Arena doors: Open swaps in the doorway blocker and the open leaf, steps the player in and shuts", (t) => {
  const inviswall = core.CacheDefinitions.getLocId("inviswall");
  const leaf = core.CacheDefinitions.getLocId("inactivepoordoor");
  for (const [x, y, face, [ox, oy], leafFace] of DOORS) {
    const door = arenaDoor(x, y);
    assert.equal(door.getFace(), face, "the cached doorway's rotation");
    const registered = [], deregistered = [];
    const { register: realRegister, deregister: realDeregister } = core.ObjectManager;
    const register = t.mock.method(core.ObjectManager, "register", function (object, update) {
      registered.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]);
      return realRegister.call(this, object, update);
    });
    const deregister = t.mock.method(core.ObjectManager, "deregister", function (object, update) {
      deregistered.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]);
      return realDeregister.call(this, object, update);
    });

    const v = visitor(ox, oy);
    assert.equal(v.click(door), true, "the door takes the click");
    assert.deepEqual(registered, [[inviswall, x, y, face], [leaf, ox, oy, leafFace]]);
    assert.deepEqual(deregistered, [[door.getId(), x, y, face]]);
    assert.deepEqual(v.sounds, [62], "door_open, once");

    v.tick();
    assert.deepEqual([v.player.getLocation().getX(), v.player.getLocation().getY()], [x, y],
      "the player is on the doorway tile");
    assert.ok(!locsAt(x, y).some(object => object.getId() === door.getId()), "still open after one tick");
    v.tick();
    assert.deepEqual(registered.at(-1), [door.getId(), x, y, face], "the door is back two ticks later");
    assert.ok(locsAt(x, y).some(object => object.getId() === door.getId()));
    assert.ok(!locsAt(x, y).some(object => object.getId() === inviswall));
    assert.ok(!locsAt(ox, oy).some(object => object.getId() === leaf));
    register.mock.restore();
    deregister.mock.restore();
  }
});

test("Fight Arena doors: from the doorway tile the same door lets the player back out", () => {
  for (const [x, y, , [ox, oy]] of DOORS) {
    const door = arenaDoor(x, y);
    const v = visitor(x, y);
    v.click(door);
    for (let i = 0; i < 4; i++) v.tick();
    assert.deepEqual([v.player.getLocation().getX(), v.player.getLocation().getY()], [ox, oy]);
    assert.ok(locsAt(x, y).some(object => object.getId() === door.getId()), "shut again behind them");
  }
});

test("Fight Arena doors: Open operates before the opener's movement, so the swap and the step share a tick", () => {
  for (const [x, y, , [ox, oy]] of DOORS) {
    const door = arenaDoor(x, y);
    const event = visitor(ox, oy).routeOpen(door);
    assert.equal(event.operateBeforeMovement, true, `door at ${x},${y}`);
  }
});
