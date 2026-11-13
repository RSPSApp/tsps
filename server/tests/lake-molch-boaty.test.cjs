// Run after `yarn build`: node --test tests/lake-molch-boaty.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const Boaty = require("../plugins/world/LakeMolchBoaty.plugin");

const BOATY = 33614;
const tasks = [];
const hooks = {};
const core = { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => tasks.push(task) } };
Boaty.register({
  core,
  onObjectInteraction: (name, actions) => { hooks[name] = actions; },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    player.prompt = { title, pairs };
    return true;
  },
});

function createPlayer(at) {
  const log = [];
  let location = new Location(at[0], at[1], at[2]);
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      const scripts = args.flatMap((arg) => arg?.postScripts ?? []).map((script) => `${script.scriptId}:${script.args.join(",")}`);
      log.push(`${String(name)} ${[...args.filter((arg) => typeof arg !== "object"), ...scripts].join(" ")}`.trim());
      return sender;
    },
  });
  const movement = { reset() { return movement; }, setBlockMovement: (blocked) => { log.push(blocked ? "lock" : "unlock"); return movement; } };
  return {
    log,
    registered: true,
    getPacketSender: () => sender,
    getLocation: () => location,
    moveTo: (to) => { location = to; log.push(`moveTo ${to.getX()},${to.getY()},${to.getZ()}`); },
    getMovementQueue: () => movement,
    isRegistered() { return this.registered; },
    sendMessage: (text) => log.push(`message ${text}`),
  };
}

function boardAt(dockName, player) {
  const dock = Boaty._test.docks.find(({ name }) => name === dockName);
  const [x, y, z] = dock.boat;
  return hooks.Boaty.Board({ player, objectId: BOATY, location: { x, y, z }, handled: false });
}

function choose(player, name) {
  const { pairs } = player.prompt;
  pairs[pairs.indexOf(name) + 1]();
}

function runTicks(count) {
  const task = tasks.at(-1);
  task.setRunning?.(true);
  const before = [];
  for (let tick = 1; tick <= count && !task.finished && task.isRunning?.() !== false; tick++) {
    task.execute();
    before.push(tick);
  }
  return before;
}

function options(player) {
  return player.prompt.pairs.filter((entry) => typeof entry === "string");
}

test("Board lists the other three stops in the captured order, then Cancel", () => {
  const fromShayzien = createPlayer([1408, 3612, 0]);
  assert.equal(boardAt("Shayzien", fromShayzien), true);
  assert.equal(fromShayzien.prompt.title, "Where would you like to go?");
  assert.deepEqual(options(fromShayzien), ["Molch Island", "Molch", "Battlefront", "Cancel"]);

  const fromIsland = createPlayer([1369, 3639, 0]);
  boardAt("Molch Island", fromIsland);
  assert.deepEqual(options(fromIsland), ["Molch", "Battlefront", "Shayzien", "Cancel"]);

  const fromMolch = createPlayer([1341, 3645, 0]);
  boardAt("Molch", fromMolch);
  assert.deepEqual(options(fromMolch), ["Molch Island", "Battlefront", "Shayzien", "Cancel"]);

  const fromBattlefront = createPlayer([1384, 3665, 0]);
  boardAt("Battlefront", fromBattlefront);
  assert.deepEqual(options(fromBattlefront), ["Molch Island", "Molch", "Shayzien", "Cancel"]);
});

test("a Boaty that isn't one of the four docks, or another loc, falls through", () => {
  const player = createPlayer([1408, 3612, 0]);
  assert.equal(hooks.Boaty.Board({ player, objectId: BOATY, location: { x: 1000, y: 1000, z: 0 } }), false);
  assert.equal(hooks.Boaty.Board({ player, objectId: BOATY + 1, location: { x: 1405, y: 3611, z: 0 } }), false);
  assert.equal(player.prompt, undefined);
});

test("the trip: mesbox and fade out, the captured landing and fade in at 3, closed at 5", () => {
  const player = createPlayer([1408, 3612, 0]);
  boardAt("Shayzien", player);
  choose(player, "Molch Island");
  const start = player.log.slice();
  assert.ok(start.some((line) => line.includes("You travel to Molch Island.")), start.join("\n"));
  assert.ok(start.includes("sendSubInterface 10551297 174 1 948:0,255,0,0,50"), start.join("\n"));
  assert.ok(start.includes("lock"));
  assert.equal(player.getLocation().getX(), 1408);

  player.log.length = 0;
  runTicks(2);
  assert.equal(player.getLocation().getX(), 1408, "not moved before tick 3");
  runTicks(1);
  assert.deepEqual(player.log.slice(0, 3), ["moveTo 1369,3639,0", "unlock", "sendSubInterface 10551297 174 1 948:0,0,0,255,50"]);
  player.log.length = 0;
  runTicks(1);
  assert.equal(player.log.length, 0, "nothing at tick 4");
  runTicks(1);
  assert.ok(player.log.includes("sendInterfaceRemoval"));
  assert.ok(player.log.includes("closeSubInterface 10551297"));
});

test("Molch is the captured landing from Molch Island", () => {
  const player = createPlayer([1369, 3639, 0]);
  boardAt("Molch Island", player);
  choose(player, "Molch");
  runTicks(3);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1341, 3645]);
});

test("Cancel goes nowhere", () => {
  const player = createPlayer([1369, 3639, 0]);
  boardAt("Molch Island", player);
  const queued = tasks.length;
  choose(player, "Cancel");
  assert.equal(tasks.length, queued);
  assert.equal(player.log.length, 0);
});

test("logging out mid-trip ends it without moving", () => {
  const player = createPlayer([1408, 3612, 0]);
  boardAt("Shayzien", player);
  choose(player, "Battlefront");
  player.registered = false;
  runTicks(5);
  assert.equal(player.getLocation().getX(), 1408);
  assert.ok(player.log.includes("unlock"));
});

test("Board mid-trip is ignored until the trip closes", () => {
  const player = createPlayer([1408, 3612, 0]);
  boardAt("Shayzien", player);
  choose(player, "Molch Island");
  const queued = tasks.length;
  runTicks(1);
  player.prompt = undefined;
  assert.equal(boardAt("Shayzien", player), true);
  assert.equal(player.prompt, undefined);
  assert.equal(tasks.length, queued);
  runTicks(4);
  assert.equal(boardAt("Molch Island", player), true);
  assert.deepEqual(options(player), ["Molch", "Battlefront", "Shayzien", "Cancel"]);
});
