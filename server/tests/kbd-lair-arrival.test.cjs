// Run after `yarn build`: node --test tests/kbd-lair-arrival.test.cjs
// The way into the King Black Dragon's lair (Wiki: King Black Dragon Lair, Lava Maze Dungeon): the Lava
// Maze ladder climbs down to the poison spider room, whose lever teleports into the lair; the lair's lever
// teleports back beside it, and the spider room's ladder climbs back up. The easy Wilderness Diary's
// "Enter the King Black Dragon's lair." is credited when the lever's teleport lands. Real Player, Location,
// movement queue and Task; the real KBD hooks and Ladders plugin, wired through one shared custom-event
// bus; the Task manager is stepped by hand. The lever's teleport (Levers.plugin.js, covered in
// wilderness-levers.test.cjs) is recorded here, and lands when the test says so.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");

const LADDER_DOWN = 18987; // wildymirrorladdertop1, Lava Maze
const LADDER_UP = 18988; // wildymirrorladder1, spider room
const ENTRANCE_LEVER = 1816; // dragonkinginlever, spider room
const LAIR_LEVER = 1817; // dragonkingoutlever, lair
const TASK = "wilderness:enter-the-king-black-dragon-s-lair";
const LAVA_MAZE = [3017, 3850, 0];
const LAVA_MAZE_LANDING = [3016, 3849, 0];
const SPIDER_ROOM = [3069, 10255, 0];
const BY_ENTRANCE_LEVER = [3067, 10254, 0];
const LAIR = [2271, 4680, 0];

const tasks = [];
const taskManager = {
  submit(task) {
    if (task.isRunning()) return;
    task.setRunning(true);
    if (task.isImmediate()) task.execute();
    tasks.push(task);
  },
};
function tick(count = 1) {
  for (let i = 0; i < count; i++) for (const task of tasks.splice(0)) if (task.tick()) tasks.push(task);
}

const clicks = new Map();
const listeners = new Map();
const diary = [];
const leverTeleports = [];
const echoEntries = [];
let echoTakesEntry = false;
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  getTaskManager: () => taskManager,
  onObjectFirstClick: (id, handler) => clicks.set(id, handler),
  onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
  emitCustomEvent: (name, payload) => {
    if (name === "diary:task") diary.push([payload.player, `${payload.diary}:${payload.task}`]);
    if (name === "lever:teleport") leverTeleports.push(payload);
    if (name === "echo-boss:entry") {
      echoEntries.push(payload);
      if (echoTakesEntry) payload.handled = true;
    }
    for (const handler of listeners.get(name) ?? []) handler(payload);
  },
}, { get: (target, key) => target[key] ?? (() => {}) });
require("../plugins/objects/Ladders.plugin").register(api);
require("../plugins/bosses/KingBlackDragon.plugin").register(api);

function playerAt(tile) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.setUsername(`kbd${Math.random()}`.slice(0, 12));
  player.setRegistered(true);
  player.setLocation(new Location(...tile));
  player.setHitpoints(10);
  return player;
}
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const tileOf = (location) => [location.getX(), location.getY(), location.getZ()];
const creditedTo = (player) => diary.filter(([who]) => who === player).map(([, task]) => task);
function reset() {
  diary.length = 0;
  leverTeleports.length = 0;
  echoEntries.length = 0;
  echoTakesEntry = false;
}

test("the Lava Maze ladder climbs down to the spider room, not into the lair", () => {
  reset();
  const player = playerAt(LAVA_MAZE);
  assert.equal(clicks.get(LADDER_DOWN)({ player }), true);
  assert.deepEqual(at(player), LAVA_MAZE, "still at the ladder when the click returns");
  tick(3);
  assert.deepEqual(at(player), SPIDER_ROOM, "the climb lands in the spider room");
  assert.deepEqual(creditedTo(player), [], "the spider room is not the lair: no diary credit");
  assert.deepEqual(echoEntries, [], "the ladder asks nothing of an echo orb holder");
});

test("the spider room's ladder climbs back up to the Lava Maze", () => {
  reset();
  const player = playerAt(SPIDER_ROOM);
  assert.equal(clicks.get(LADDER_UP)({ player }), true);
  tick(3);
  assert.deepEqual(at(player), LAVA_MAZE_LANDING);
});

test("a refused climb (movement blocked) goes nowhere", () => {
  reset();
  const player = playerAt(LAVA_MAZE);
  player.getMovementQueue().setBlockMovement(true);
  clicks.get(LADDER_DOWN)({ player });
  tick(6);
  assert.deepEqual(at(player), LAVA_MAZE);
});

test("the spider room's lever teleports into the lair and credits the diary on landing", () => {
  reset();
  const player = playerAt(BY_ENTRANCE_LEVER);
  assert.equal(clicks.get(ENTRANCE_LEVER)({ player }), true);
  assert.equal(echoEntries.length, 1, "an echo orb holder is asked at the lever");
  assert.equal(leverTeleports.length, 1, "the lever's teleport");
  const [teleport] = leverTeleports;
  assert.equal(teleport.player, player);
  assert.deepEqual(tileOf(teleport.destination), LAIR);
  assert.deepEqual(creditedTo(player), [], "not credited before the teleport lands");
  teleport.onArrival();
  assert.deepEqual(creditedTo(player), [TASK], "credited once the teleport lands");
});

test("an echo orb holder who takes the Echo fight is not teleported by the lever", () => {
  reset();
  echoTakesEntry = true;
  const player = playerAt(BY_ENTRANCE_LEVER);
  clicks.get(ENTRANCE_LEVER)({ player });
  assert.equal(echoEntries.length, 1);
  assert.equal(echoEntries[0].boss, "king-black-dragon");
  assert.deepEqual(leverTeleports, [], "the Echo entry handles it");
  echoEntries[0].enter();
  assert.deepEqual(tileOf(leverTeleports[0].destination), LAIR, "its normal-fight choice is the lever's teleport");
});

test("the lair's lever teleports back beside the spider room's lever and credits nothing", () => {
  reset();
  const player = playerAt(LAIR);
  assert.equal(clicks.get(LAIR_LEVER)({ player }), true);
  assert.equal(leverTeleports.length, 1);
  assert.deepEqual(tileOf(leverTeleports[0].destination), BY_ENTRANCE_LEVER);
  assert.equal(leverTeleports[0].onArrival, undefined);
  assert.deepEqual(diary, []);
});
