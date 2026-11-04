// Run after `yarn build`: node --test tests/kbd-lair-arrival.test.cjs
// The easy Wilderness Diary's "Enter the King Black Dragon's lair." is credited when the climb lands,
// not when the ladder is clicked. Real Player, Location, movement queue and Task; the real KBD hook and
// Ladders plugin, wired through one shared custom-event bus; the Task manager is stepped by hand.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");

const LADDER_OBJECT = 18987;
const TASK = "enter-the-king-black-dragon-s-lair";
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
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  getTaskManager: () => taskManager,
  onObjectFirstClick: (id, handler) => clicks.set(id, handler),
  onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
  emitCustomEvent: (name, payload) => {
    if (name === "diary:task") diary.push([payload.player, payload.diary, payload.task]);
    for (const handler of listeners.get(name) ?? []) handler(payload);
  },
}, { get: (target, key) => target[key] ?? (() => {}) });
require("../plugins/objects/Ladders.plugin").register(api);
require("../plugins/bosses/KingBlackDragon.plugin").register(api);

function lavaMazePlayer() {
  const player = new Player(null);
  const sender = new Proxy({}, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.setUsername(`kbd${Math.random()}`.slice(0, 12));
  player.setRegistered(true);
  player.setLocation(new Location(3017, 3850, 0));
  player.setHitpoints(10);
  return player;
}
const tile = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const creditedTo = (player) => diary.filter(([who]) => who === player).map(([, name, task]) => `${name}:${task}`);

test("the climb into the lair credits the diary on arrival, not on the click", () => {
  diary.length = 0;
  const player = lavaMazePlayer();
  clicks.get(LADDER_OBJECT)({ player });
  assert.deepEqual(tile(player), [3017, 3850, 0], "still at the ladder when the click returns");
  assert.deepEqual(creditedTo(player), [], "not credited before the climb lands");
  tick(3);
  assert.deepEqual(tile(player), LAIR, "the climb lands in the lair");
  assert.deepEqual(creditedTo(player), [`wilderness:${TASK}`], "credited once, at arrival");
  tick(3);
  assert.equal(creditedTo(player).length, 1, "and not again");
});

test("a climb cancelled by death before landing never credits the diary", () => {
  diary.length = 0;
  const player = lavaMazePlayer();
  clicks.get(LADDER_OBJECT)({ player });
  player.setHitpoints(0);
  tick(6);
  assert.deepEqual(tile(player), [3017, 3850, 0], "the dead player did not enter the lair");
  assert.deepEqual(creditedTo(player), [], "never credited");
});

test("a refused climb (movement blocked) never credits the diary", () => {
  diary.length = 0;
  const player = lavaMazePlayer();
  player.getMovementQueue().setBlockMovement(true);
  clicks.get(LADDER_OBJECT)({ player });
  tick(6);
  assert.deepEqual(tile(player), [3017, 3850, 0], "the player did not move");
  assert.deepEqual(creditedTo(player), [], "never credited");
});

test("the lair's lever leads out and credits nothing", () => {
  diary.length = 0;
  const player = lavaMazePlayer();
  assert.equal(clicks.get(1817)({ player }), true);
  assert.deepEqual(diary, []);
});
