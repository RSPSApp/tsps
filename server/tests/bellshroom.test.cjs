// Run after `yarn build`: node --test tests/bellshroom.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");

const Bellshroom = require("../plugins/world/Bellshroom.plugin");

const tasks = [];
const hooks = { objects: {}, itemOnObject: [] };
const core = { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => tasks.push(task) } };
Bellshroom.register({
  core,
  onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
  onItemOnObject: (itemName, objectName, handler) => hooks.itemOnObject.push({ itemName, objectName, handler }),
});

let ENTRANCE = null;
let EXIT = null;
let BREADCRUMBS = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  ENTRANCE = CacheDefinitions.getLocId("fossil_flora_swamp_bellshroom");
  EXIT = CacheDefinitions.getLocId("fossil_flora_swamp_bellshroom_return");
  BREADCRUMBS = CacheDefinitions.getObjId("hundred_pirate_breadcrumbs");
  assert.equal(ENTRANCE, 30670);
  assert.equal(EXIT, 30671);
  assert.equal(BREADCRUMBS, 7515);
});

function createPlayer({ breadcrumbs = 1, at = [3669, 3736, 0] } = {}) {
  const log = [];
  let location = new Location(...at);
  let count = breadcrumbs;
  const sender = {
    sendSound: (id, volume, delay) => { log.push(`sound ${id} delay ${delay}`); return sender; },
    sendSoundEffect: (id, loops, delay) => { log.push(`sound ${id} loops ${loops} delay ${delay}`); return sender; },
    sendObjectAnimation: (object, animation) => { log.push(`loc_anim ${object.getId()} ${animation.getId()}`); return sender; },
    sendSubInterface: (uid, id, type, { postScripts }) => {
      log.push(`overlay ${uid >> 16}:${uid & 0xffff}=${id} script ${postScripts[0].scriptId} [${postScripts[0].args}]`);
      return sender;
    },
    closeSubInterface: (uid) => { log.push(`close ${uid >> 16}:${uid & 0xffff}`); return sender; },
  };
  let blocked = false;
  const movement = {
    reset() { return movement; },
    isMovementBlocked: () => blocked,
    setBlockMovement: (value) => { blocked = value; log.push(value ? "lock" : "unlock"); return movement; },
  };
  return {
    log,
    dialogues: [],
    registered: true,
    get breadcrumbs() { return count; },
    set breadcrumbs(value) { count = value; },
    getPacketSender: () => sender,
    getLocation: () => location,
    getLocalPlayers: () => [],
    privateArea: null,
    getPrivateArea() { return this.privateArea; },
    moveTo(to) { location = to; log.push(`moveTo ${to.getX()},${to.getY()},${to.getZ()}`); },
    setPositionToFace(to) { log.push(`face ${to.getX()},${to.getY()}`); },
    getMovementQueue: () => movement,
    isRegistered() { return this.registered; },
    forceChat: (text) => log.push(`say ${text}`),
    getInventory: () => ({
      contains: (id) => id === BREADCRUMBS && count > 0,
      delete: (id, amount) => { if (id === BREADCRUMBS) { count -= amount; log.push(`-breadcrumbs ${amount}`); } },
    }),
    getDialogueManager() { return { startDialogues: (chain) => this.dialogues.push(chain) }; },
    getHitpoints: () => 99,
  };
}

const object = (id) => ({ getId: () => id });

function run(player, ticks = 20) {
  const task = tasks.at(-1);
  task.setRunning?.(true);
  for (let tick = 1; tick <= ticks && task.isRunning?.() !== false; tick++) {
    const before = player.log.length;
    task.execute();
    for (let index = before; index < player.log.length; index++) player.log[index] = `+${tick} ${player.log[index]}`;
  }
}

function at(player, tick) {
  return player.log.filter((line) => line.startsWith(`+${tick} `)).map((line) => line.slice(`+${tick} `.length));
}

function chainText(chain) {
  return [...chain.getDialogues().values()].map((dialogue) => dialogue.getText()).join("|");
}

function feed() {
  const entry = hooks.itemOnObject.find((hook) => hook.itemName === "Breadcrumbs" && hook.objectName === "Bellshroom");
  assert.ok(entry, "Breadcrumbs on Bellshroom is hooked by cache names");
  return entry.handler;
}

test("hooks the cache names and options, members only", () => {
  assert.equal(typeof hooks.objects.Bellshroom.Investigate, "function");
  assert.equal(Bellshroom.members, true);
  assert.equal(ItemDefinition.forId(BREADCRUMBS).getName(), "Breadcrumbs");
  for (const id of [ENTRANCE, EXIT]) assert.equal(ObjectDefinition.forId(id).getName(), "Bellshroom");
  assert.deepEqual(ObjectDefinition.forId(ENTRANCE).getInteractions().filter(Boolean), ["Investigate"]);
});

test("Investigate shows the captured message box, crumbs or not", () => {
  for (const breadcrumbs of [0, 1]) {
    const player = createPlayer({ breadcrumbs });
    assert.equal(hooks.objects.Bellshroom.Investigate({ player, objectId: ENTRANCE, object: object(ENTRANCE) }), true);
    assert.equal(player.dialogues.length, 1);
    assert.equal(chainText(player.dialogues[0]), "Maybe its hungry...");
    assert.equal(player.breadcrumbs, breadcrumbs);
  }
});

test("the clearing's own Bellshroom falls through for Investigate and breadcrumbs", () => {
  const player = createPlayer();
  const count = tasks.length;
  assert.equal(hooks.objects.Bellshroom.Investigate({ player, objectId: EXIT, object: object(EXIT) }), false);
  assert.equal(feed()({ player, objectId: EXIT, object: object(EXIT), itemId: BREADCRUMBS }), false);
  assert.equal(tasks.length, count);
  assert.equal(player.breadcrumbs, 1);
});

test("breadcrumbs on it play the captured swallow, tick by tick", () => {
  const player = createPlayer({ breadcrumbs: 2 });
  assert.equal(feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS }), true);
  assert.deepEqual(player.log, ["lock"]);
  run(player);
  // Capture ticks are these +1 (the handler runs a tick after the click).
  assert.deepEqual(at(player, 1), ["-breadcrumbs 1"]);
  assert.deepEqual(at(player, 2), []);
  assert.deepEqual(at(player, 3), ["sound 2454 loops 6 delay 13", "loc_anim 30670 7744"]);
  assert.deepEqual(at(player, 4), ["overlay 161:1=174 script 948 [0,255,0,0,15]"]);
  assert.deepEqual(at(player, 5), ["moveTo 3656,3750,0", "face 3656,3749", "sound 2489 delay 0"]);
  assert.deepEqual(at(player, 6), ["say What just happened?", "overlay 161:1=174 script 948 [0,0,0,255,50]"]);
  assert.deepEqual(at(player, 7), []);
  assert.deepEqual(at(player, 8), ["close 161:1", "unlock"]);
  assert.equal(player.breadcrumbs, 1);
});

test("clicks during the swallow are ignored, and it only eats one crumb", () => {
  const player = createPlayer({ breadcrumbs: 3 });
  feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS });
  const count = tasks.length;
  assert.equal(feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS }), true);
  assert.equal(hooks.objects.Bellshroom.Investigate({ player, objectId: ENTRANCE, object: object(ENTRANCE) }), true);
  assert.equal(tasks.length, count);
  assert.equal(player.dialogues.length, 0);
  run(player);
  assert.equal(player.breadcrumbs, 2);
  // Through it, the Bellshroom answers again.
  assert.equal(hooks.objects.Bellshroom.Investigate({ player, objectId: ENTRANCE, object: object(ENTRANCE) }), true);
  assert.equal(player.dialogues.length, 1);
});

test("crumbs gone before they are eaten: no swallow, movement unlocked", () => {
  const player = createPlayer({ breadcrumbs: 1 });
  feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS });
  player.breadcrumbs = 0;
  run(player);
  assert.deepEqual(player.log, ["lock", "+1 unlock"]);
});

test("moved off the spot before the swallow's move: it stops there, the screen cleared", () => {
  const player = createPlayer({ breadcrumbs: 2 });
  feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS });
  const task = tasks.at(-1);
  task.setRunning?.(true);
  for (let tick = 0; tick < 4; tick++) task.execute();
  player.moveTo(new Location(3222, 3218, 0)); // a teleport tab or ::tele after the fade out
  run(player, 6);
  assert.equal(player.getLocation().getX(), 3222);
  assert.equal(player.log.filter((line) => line.includes("moveTo 3656")).length, 0);
  assert.deepEqual(player.log.slice(-2), ["+1 close 161:1", "+1 unlock"]);
  // The crumb was eaten on tick 1, as on live before anything else could move them.
  assert.equal(player.breadcrumbs, 1);
  assert.equal(hooks.objects.Bellshroom.Investigate({ player, objectId: ENTRANCE, object: object(ENTRANCE) }), true);
  assert.equal(player.dialogues.length, 1);
});

test("put into an instance before the move: it stops there", () => {
  const player = createPlayer();
  feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS });
  player.privateArea = {};
  run(player);
  assert.deepEqual(player.log, ["lock", "+1 unlock"]);
  assert.equal(player.breadcrumbs, 1);
});

test("movement already held by something else: breadcrumbs do nothing, the lock is left alone", () => {
  const player = createPlayer();
  player.getMovementQueue().setBlockMovement(true);
  const count = tasks.length;
  assert.equal(feed()({ player, objectId: ENTRANCE, object: object(ENTRANCE), itemId: BREADCRUMBS }), true);
  assert.equal(tasks.length, count);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  assert.equal(player.breadcrumbs, 1);
});
