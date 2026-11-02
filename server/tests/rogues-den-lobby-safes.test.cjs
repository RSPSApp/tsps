// From server/: yarn build && node --test tests/rogues-den-lobby-safes.test.cjs
//
// A lobby safe retry chain used to be keyed by the player object, so MovementQueue.walkToReset
// (which cancels index-keyed tasks) could not stop it, repeated Crack clicks stacked chains, and a
// pending retry paid out from wherever the player had moved to. These cases drive the real
// ObjectActionPacketListener against the cache's safe 7236 and the production plugin registration.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, '..');
const LOBBY_SAFE = 7236;
const SAFE_AT = [3055, 4977, 1];
const STAND_AT = [3055, 4976, 1];
const COINS = 995;
const RETRY_TICKS = require('../plugins/minigames/data/rogues-den.json').lobbySafe.retryTicks;

let core;
let Player;
let Location;
let ObjectActionPacketListener;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  RegionManager.loadMapFiles(SAFE_AT[0], SAFE_AT[1]);

  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  ({ Location } = require('../dist/game/model/Location'));
  ({ ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener'));

  const { PluginManager } = require('../dist/plugins/PluginManager');
  core = PluginManager.getCoreApi();
  const startup = [];
  require('../plugins/objects/Doors.plugin').register({
    ...PluginManager.createApi('RoguesDenLobbyDoorsRegression'),
    onServerStartup: handler => startup.push(handler),
  });
  for (const start of startup) start();
  require('../plugins/minigames/RoguesDen.plugin').register(
    PluginManager.createApi('RoguesDenLobbySafeRegression'),
  );

  assert.ok(core.MapObjects.get(LOBBY_SAFE, new Location(...SAFE_AT), null), 'cache supplies the lobby safe');
});

let nextIndex = 1;

function account(t) {
  const player = new Player(null);
  player.setIndex(nextIndex++);
  player.setRegistered(true);
  const sender = new Proxy({}, {
    get: (target, key) => (key === 'sendMessage'
      ? (message) => { player.messages.push(String(message)); }
      : () => sender),
  });
  player.messages = [];
  player.getPacketSender = () => sender;
  t.mock.method(player, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  player.moveTo(new Location(...STAND_AT));
  player.setNeedsPlacement(false);
  player.getSkillManager().setMaxLevels(core.Skill.THIEVING, 50, false);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 50);
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

function captureSubmissions(t) {
  const tasks = [];
  const submit = core.TaskManager.submit;
  t.mock.method(core.TaskManager, 'submit', (task) => {
    tasks.push(task);
    return submit(task);
  });
  return tasks;
}

function retries(tasks) {
  return tasks.filter((task) => task.getDelay() === RETRY_TICKS);
}

function crack(player) {
  clickLobbyObject(player, LOBBY_SAFE, SAFE_AT);
}

function runTask(task) {
  for (let i = 0; i < task.getDelay(); i++) task.tick();
}

function clickLobbyObject(player, id, at) {
  player.setNeedsPlacement(false);
  assert.equal(player.getLocation().getZ(), at[2]);
  new ObjectActionPacketListener().executeAction(player, id, at[0], at[1], 1);
  // Scenery interactions resolve on the cycle after the walk arrives.
  player.getMovementQueue().process();
  for (let tick = 0; tick < 2; tick++) {
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
  }
}

test('the pub trapdoor reaches a lobby whose ordinary door opens instead of exiting the Den', t => {
  const player = account(t);
  const data = require('../plugins/minigames/data/rogues-den.json');
  player.moveTo(new Location(...data.lobby.pubTile));
  clickLobbyObject(player, data.ids.objects.trapdoor, data.lobby.trapdoorTile);
  assert.ok(player.getLocation().equals(new Location(...data.lobby.entryTile)));
  clickLobbyObject(player, data.ids.objects.pubDoor, [3061, 4984, 1]);
  assert.equal(player.getLocation().getZ(), 1, 'opening the lobby door does not return to the pub');
  const openDoor = core.MapObjects.get(7260, new Location(3061, 4983, 1), null);
  assert.ok(openDoor, 'the shared door handler swaps the real cache Open/Close pair');
  assert.equal(openDoor.getFace(), 0, 'capture 3131 opens the door southward at rotation 0');
  const route = new core.RsmodRouteFinding().findRoute({ level: 1,
    srcX: 3061, srcY: 4985, srcSize: 1, destX: 3061, destY: 4982, privateArea: null, moveNear: false });
  assert.equal(route.success, true, 'the lobby can be reached through the open doorway');
  const at = openDoor.getLocation();
  player.moveTo(new Location(3061, 4982, 1));
  clickLobbyObject(player, 7260, [at.x, at.y, at.z]);
  assert.equal(player.getLocation().getZ(), 1, 'closing from the lobby stays underground');
  assert.ok(core.MapObjects.get(7259, new Location(3061, 4984, 1), null));
});

test('the separate lobby passageway still returns to the pub', t => {
  const player = account(t);
  player.moveTo(new Location(3061, 4985, 1));
  clickLobbyObject(player, 7258, [3061, 4986, 1]);
  assert.ok(player.getLocation().equals(new Location(2906, 3537, 0)));
});

const xpOf = (player) => player.getSkillManager().getExperience(core.Skill.THIEVING);
const coins = (player) => player.getInventory().getAmount(COINS);

test('a new walk cancels the pending lobby-safe retry', (t) => {
  let random = 0.99; // fail, and no trap: the first attempt queues a retry
  t.mock.method(Math, 'random', () => random);
  const player = account(t);
  const tasks = captureSubmissions(t);

  crack(player);
  const pending = retries(tasks);
  assert.equal(pending.length, 1, 'a failed attempt queues one retry');
  assert.equal(pending[0].isRunning(), true);
  const before = xpOf(player);

  player.getMovementQueue().walkToReset();
  assert.equal(pending[0].isRunning(), false, 'walkToReset stops the index-keyed retry');

  random = 0; // a retry that ran would crack the safe and pay out
  runTask(pending[0]);
  assert.equal(xpOf(player), before, 'the cancelled retry awards no experience');
  assert.equal(coins(player), 0, 'and no loot');
});

test('a retry does not pay out after the player has moved away from the safe', (t) => {
  let random = 0.99;
  t.mock.method(Math, 'random', () => random);
  const player = account(t);
  const tasks = captureSubmissions(t);

  crack(player);
  const [pending] = retries(tasks);
  const before = xpOf(player);

  // A move that does not go through walkToReset (a teleport or forced move) still has to be checked.
  player.moveTo(new Location(3200, 3200, 0));
  random = 0;
  runTask(pending);

  assert.equal(xpOf(player), before, 'the retry revalidates the safe and its range');
  assert.equal(coins(player), 0, 'nothing is awarded from the new location');
});

test('a second Crack replaces the first attempt instead of stacking retries', (t) => {
  let random = 0.99;
  t.mock.method(Math, 'random', () => random);
  const player = account(t);
  const tasks = captureSubmissions(t);

  crack(player);
  const [first] = retries(tasks);
  assert.equal(first.isRunning(), true);

  crack(player);
  const both = retries(tasks);
  assert.equal(both.length, 2, 'each click starts one chain');
  assert.equal(first.isRunning(), false, 'the earlier chain is stopped');
  assert.equal(both.filter((task) => task.isRunning()).length, 1, 'only one attempt per player is live');

  random = 0;
  const before = xpOf(player);
  runTask(first);
  assert.equal(xpOf(player), before, 'the replaced chain never runs');
  assert.equal(coins(player), 0);

  runTask(both.find((task) => task.isRunning()));
  assert.equal(xpOf(player), before + 70, 'the live chain pays once');
  assert.equal(coins(player), 10, 'with one loot roll');
});
