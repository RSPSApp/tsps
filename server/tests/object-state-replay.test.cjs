// Run after `yarn build`: node --test tests/object-state-replay.test.cjs
// Shared object state across a region (re)load: map objects removed at runtime stay out and
// runtime objects stay in, clipping included, as clients are shown them; objects remember the
// plugin that spawned them (from its hooks or its tasks) and go when the server shuts down; and
// two players can't both act on one loc, so no shared state is made twice.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { Task } = require("../dist/game/task/Task");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PluginContext } = require("../dist/plugins/PluginContext");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

// Lumbridge's staircase (56230) is a solid map object; 3200,3226 is open ground nearby.
const STAIRS = 56230;
const STAIRS_TILE = new Location(3204, 3229, 0);
const OPEN_TILE = new Location(3200, 3226, 0);
const REGION = ((3204 >> 6) << 8) | (3229 >> 6);
const SOLID = 0x100;

const clip = (location) => RegionManager.getClipping(location.getX(), location.getY(), location.getZ(), null);
const stairs = () => MapObjects.get(STAIRS, STAIRS_TILE.clone(), null);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  RegionManager.loadMapFiles(3204, 3229);
});

test("a region reload keeps a removed map object out, with its clipping", () => {
  const original = stairs();
  assert.ok(original?.isMapOriginal());
  assert.equal(clip(STAIRS_TILE) & SOLID, SOLID, "the stairs block their tile");

  ObjectManager.deregister(original, true);
  assert.equal(clip(STAIRS_TILE) & SOLID, 0);
  assert.ok(RegionManager.reloadRegion(REGION));
  assert.equal(stairs(), null, "the reload must not bring back what clients are told is gone");
  assert.equal(clip(STAIRS_TILE) & SOLID, 0, "nor its clipping");

  ObjectManager.register(original, true);
  assert.ok(RegionManager.reloadRegion(REGION));
  assert.ok(stairs(), "put back, it is the map again");
  assert.equal(clip(STAIRS_TILE) & SOLID, SOLID);
});

test("a region reload keeps a runtime object in, with its clipping", () => {
  assert.equal(clip(OPEN_TILE) & SOLID, 0, "open ground");
  const placed = new GameObject(STAIRS, OPEN_TILE.clone(), 10, 0, null);
  ObjectManager.register(placed, true);
  assert.equal(clip(OPEN_TILE) & SOLID, SOLID);

  assert.ok(RegionManager.reloadRegion(REGION));
  assert.equal(MapObjects.get(STAIRS, OPEN_TILE.clone(), null), placed);
  assert.equal(clip(OPEN_TILE) & SOLID, SOLID, "collision matches what clients are sent");

  ObjectManager.deregister(placed, true);
  assert.equal(clip(OPEN_TILE) & SOLID, 0);
});

test("a removal the reloaded map no longer has clears no one else's clipping", () => {
  // Recorded against a tile whose map (as if replaced) holds something else there.
  const ghost = new GameObject(STAIRS, OPEN_TILE.clone(), 10, 0, null).markBaseMap();
  const blocker = new GameObject(STAIRS, OPEN_TILE.clone(), 10, 1, null);
  World.getRemovedObjects().push(ghost);
  ObjectManager.register(blocker, true);
  try {
    assert.ok(RegionManager.reloadRegion(REGION));
    assert.equal(clip(OPEN_TILE) & SOLID, SOLID, "the runtime object's clipping stays");
  } finally {
    World.getRemovedObjects().splice(World.getRemovedObjects().indexOf(ghost), 1);
    ObjectManager.deregister(blocker, true);
  }
});

test("an object remembers the plugin that spawned it, from its hooks and from its tasks", () => {
  const api = PluginManager.createApi("Owner test");
  const spawned = [];
  api.onCustomEvent("owner-test:spawn", ({ x }) => {
    const object = new GameObject(STAIRS, new Location(x, 3226, 0), 10, 0, null);
    ObjectManager.register(object, true);
    spawned.push(object);
    // Later, from a task the hook submitted.
    const task = new (class extends Task {
      execute() {
        this.stop();
        const later = new GameObject(STAIRS, new Location(x + 1, 3226, 0), 10, 0, null);
        ObjectManager.register(later, true);
        spawned.push(later);
      }
    })(1);
    TaskManager.submit(task);
  });
  PluginManager.emitCustomEvent("owner-test:spawn", { x: 3196 });
  TaskManager.process();
  const core = new GameObject(STAIRS, new Location(3196, 3224, 0), 10, 0, null);
  ObjectManager.register(core, true);

  assert.deepEqual(spawned.map((object) => object.getSpawnedBy()), ["Owner test", "Owner test"]);
  assert.equal(core.getSpawnedBy(), null, "core's own objects have no plugin");
  assert.equal(PluginContext.current(), null, "the context ends with the hook and the task");

  // Shutdown: the plugin's objects go, clipping too; core's stay.
  const removed = ObjectManager.removePluginObjects();
  assert.ok(removed >= 2);
  for (const object of spawned) {
    assert.ok(!World.getObjects().includes(object));
    assert.equal(clip(object.getLocation()) & SOLID, 0);
  }
  assert.ok(World.getObjects().includes(core));
  ObjectManager.deregister(core, true);
});

test("a plugin's stand-in for a map object (a door closed again) survives the shutdown clean-up", () => {
  const original = stairs();
  const previous = PluginContext.enter("Stand-in test");
  try {
    ObjectManager.deregister(original, true);
    const standIn = new GameObject(STAIRS, STAIRS_TILE.clone(), original.getType(), original.getFace(), null);
    ObjectManager.register(standIn, true);
    assert.ok(standIn.isBaseMap());
  } finally {
    PluginContext.exit(previous);
  }
  ObjectManager.removePluginObjects();
  assert.ok(stairs(), "the staircase still stands");
  assert.equal(clip(STAIRS_TILE) & SOLID, SOLID);
});

function createPlayer(name) {
  const queue = { pending: null, reset() {}, walkToReset() {} };
  queue.walkToObject = (_object, action) => { queue.pending = action.execute; };
  return {
    name,
    queue,
    getHitpoints: () => 10,
    busy: () => false,
    getLocation: () => new Location(3197, 3227, 0),
    getMovementQueue: () => queue,
    getPrivateArea: () => null,
    getRights: () => null,
    setPositionToFace() {},
    getVarbitValue: () => 0,
    getVarpValue: () => 0,
  };
}

test("two players walking to one loc: only the first changes it, the second finds it gone", () => {
  const door = new GameObject(STAIRS, new Location(3198, 3226, 0), 10, 0, null);
  ObjectManager.register(door, true);
  const api = PluginManager.createApi("Race test");
  const opened = [];
  api.onObjectFirstClick([STAIRS], ({ player, object }) => {
    if (!object.getLocation().equals(door.getLocation())) return false;
    // Replaced by its "open" form on the next tile, as a door swings.
    ObjectManager.deregister(object, true);
    const open = new GameObject(STAIRS, new Location(3198, 3227, 0), 10, 1, null);
    ObjectManager.register(open, true);
    opened.push({ player: player.name, open });
    return true;
  });

  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const listener = new ObjectActionPacketListener();
  listener.executeAction(alice, STAIRS, 3198, 3226, 1);
  listener.executeAction(bob, STAIRS, 3198, 3226, 1);
  assert.ok(alice.queue.pending && bob.queue.pending, "both set off towards it");

  alice.queue.pending();
  bob.queue.pending();
  assert.deepEqual(opened.map((entry) => entry.player), ["alice"]);
  const atOpenTile = World.getObjects().filter((object) => object.getLocation().equals(new Location(3198, 3227, 0)));
  assert.equal(atOpenTile.length, 1, "one open form, not two");

  // A loc replaced by one just like it (a region reload's fresh copy) still counts.
  const again = new GameObject(STAIRS, new Location(3198, 3226, 0), 10, 0, null);
  ObjectManager.register(again, true);
  listener.executeAction(bob, STAIRS, 3198, 3226, 1);
  ObjectManager.register(new GameObject(STAIRS, new Location(3198, 3226, 0), 10, 0, null), true);
  bob.queue.pending();
  assert.deepEqual(opened.map((entry) => entry.player), ["alice", "bob"]);

  for (const object of [...World.getObjects()]) {
    if (object.getId() === STAIRS && object.getLocation().getY() >= 3226 && object.getLocation().getX() === 3198) {
      ObjectManager.deregister(object, true);
    }
  }
});

test("two registrations of one shared object on a tile leave one", () => {
  const at = new Location(3199, 3224, 0);
  ObjectManager.register(new GameObject(STAIRS, at.clone(), 10, 0, null), true);
  ObjectManager.register(new GameObject(STAIRS, at.clone(), 10, 0, null), true);
  assert.equal(ObjectManager.objectsAt(at).length, 1);
  ObjectManager.deregister(ObjectManager.objectsAt(at)[0], true);
});


test("generic chest Open, Search and Shut use shared object state", () => {
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const closedId = CacheDefinitions.getLocId("chestclosed");
  const openId = CacheDefinitions.getLocId("chestopen");
  const at = new Location(3200, 3226, 0);
  const messages = [];
  const player = { sendMessage: text => messages.push(text) };
  require("../plugins/objects/Chests.plugin").register(PluginManager.createApi("Chests"));
  const interact = (id, option) => {
    const object = MapObjects.get(id, at.clone(), null);
    assert.ok(object);
    const clickType = object.getDefinition().getInteractions().indexOf(option) + 1;
    assert.ok(clickType > 0, option);
    assert.equal(PluginManager.emitObjectInteraction({ player, object, objectId: id, clickType }), true);
  };
  ObjectManager.register(new GameObject(closedId, at.clone(), 10, 0, null), true);
  try {
    interact(closedId, "Open");
    assert.equal(MapObjects.get(closedId, at.clone(), null), null);
    assert.ok(RegionManager.reloadRegion(REGION));
    interact(openId, "Search");
    assert.deepEqual(messages, ["You search the chest, but find nothing of interest."]);
    interact(openId, "Shut");
    assert.equal(MapObjects.get(openId, at.clone(), null), null);
    assert.ok(MapObjects.get(closedId, at.clone(), null));
  } finally {
    for (const object of [...ObjectManager.objectsAt(at)]) ObjectManager.deregister(object, true);
  }
});
