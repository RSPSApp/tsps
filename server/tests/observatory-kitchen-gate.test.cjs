// Run after `yarn build`: node --test tests/observatory-kitchen-gate.test.cjs
//
// #4118: the Observatory dungeon's kitchen gate (keepgate_closed/_left 2199/2200 at 2327/2326,9393, face 1)
// vanished when opened, and the sleeping guard beside it wandered about. Live (RSProx 20261110T110141-5ab63b4,
// rev 242, ticks 806-920):
// - the sleeping guard stays on 2327,9394; Prod plays 6839 on the player and 6827 on him, and two ticks later
//   he is replaced by a goblin guard who says "Oi, how dare you wake me up!" and attacks;
// - while that guard is up the gate says "You need to get rid of that goblin guard first."; with him on
//   2327,9399 (north of the gate) it unlocks: "The gate unlocks." / "The key is useless now. You discard it.";
// - Open puts inviswall 38848 on both doorway tiles and the open leaves 1574/1573 on the tiles north, sound
//   71, the player steps across in the same tick (both ways) and the gate is back two ticks later.
//
// Real engine, as farming-guild-door.test.cjs: every plugin loaded, real Players and NPCs, every click through
// ObjectActionPacketListener.executeAction, and the movement queue and tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const { World } = require("../dist/game/World");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const GATE = 2199, GATE_LEFT = 2200, OPEN_RIGHT = 1574, OPEN_LEFT = 1573, INVISWALL = 38848;
const GATE_X = 2327, GATE_Y = 9393, NORTH_Y = 9394;
const SLEEPING_GUARD = 5368, GOBLIN_GUARD = 5369, KEY = 601;
const STAGE_MOULD = 4;

let core;
let next = 5700;
const players = [];
let sleeper;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(GATE_X, GATE_Y);
  PluginManager.emitServerStartup({});
  const spawn = JSON.parse(require("node:fs").readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"))
    .find((entry) => entry.id === SLEEPING_GUARD);
  assert.equal(spawn.wanderRadius, 0, "the sleeping guard's spawn never wanders");
  sleeper = PluginManager.spawnNpc({ id: SLEEPING_GUARD, x: spawn.x, y: spawn.y, z: 0, wanderRadius: spawn.wanderRadius });
  World.getAddNPCQueue().splice(0).forEach((npc) => World.getNpcs().add(npc));
});

function actor(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("obsgate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "observatory_quest");
  quest.setStage(player, STAGE_MOULD);
  player.getInventory().add(new core.Item(KEY, 1));
  return { player, messages };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    World.getAddNPCQueue().splice(0).forEach((npc) => World.getNpcs().add(npc));
    for (const player of players) player.resetUpdating();
  }
}

function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === 0) return object;
    }
  }
  return null;
};
const isOpen = () => locAt(OPEN_RIGHT, 2327, NORTH_Y) != null && locAt(OPEN_LEFT, 2326, NORTH_Y) != null;
const isShut = () => !isOpen() && locAt(INVISWALL, 2327, GATE_Y) == null && locAt(INVISWALL, 2326, GATE_Y) == null
  && locAt(GATE, 2327, GATE_Y) != null && locAt(GATE_LEFT, 2326, GATE_Y) != null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id = GATE, x = GATE_X) => new ObjectActionPacketListener().executeAction(player, id, x, GATE_Y, 1);
const goblinGuard = () => [...World.getNpcs()].find((npc) => npc?.getId?.() === GOBLIN_GUARD && npc.isRegistered()) ?? null;

test("the sleeping guard sleeps on his post, and the gate stays shut beside him", (t) => {
  const { player, messages } = actor(t, GATE_X, NORTH_Y + 1);
  for (let i = 0; i < 40; i++) tick();
  assert.deepEqual([sleeper.getLocation().getX(), sleeper.getLocation().getY()], [2327, 9394], "he never moves");
  click(player);
  tick(3);
  assert.ok(isShut(), "the gate never opened");
  assert.deepEqual(messages, ["If you open the gate, the guard will hear you. You need to get rid of him."]);
  assert.equal(player.getInventory().getAmount(KEY), 1);
});

test("prodded, a goblin guard takes his place; trapped north of the gate, the key unlocks it and the player passes through", (t) => {
  const { player, messages } = actor(t, 2326, NORTH_Y);
  assert.equal(PluginManager.emitNpcInteraction({ player, npc: sleeper, npcId: SLEEPING_GUARD, clickType: 1, handled: false }), true);
  tick();
  assert.equal(goblinGuard(), null, "he takes two ticks to get up");
  assert.ok(until(() => goblinGuard() != null, 4), "a goblin guard appears");
  const guard = goblinGuard();
  assert.equal(sleeper.isVisible(), false, "the sleeping guard is gone");
  assert.deepEqual([guard.getLocation().getX(), guard.getLocation().getY()], [2327, 9394]);

  click(player, GATE_LEFT, 2326);
  tick(2);
  assert.ok(isShut());
  assert.equal(messages.at(-1), "You need to get rid of that goblin guard first.");

  guard.getCombat().reset?.();
  guard.getMovementQueue().reset();
  guard.moveTo(new core.Location(2327, 9399, 0));
  tick();
  click(player, GATE_LEFT, 2326);
  assert.ok(until(isOpen, 4), "the gate swings open onto the tiles north");
  assert.ok(locAt(INVISWALL, 2327, GATE_Y) && locAt(INVISWALL, 2326, GATE_Y), "inviswall on both doorway tiles");
  assert.deepEqual(messages.slice(-2), ["The gate unlocks.", "The key is useless now. You discard it."]);
  assert.equal(player.getInventory().getAmount(KEY), 0, "the key is discarded");
  assert.ok(until(() => at(player)[1] === GATE_Y, 4), `the player steps into the kitchen: ${at(player)}`);
  assert.ok(until(isShut, 4), "the gate is back two ticks later");

  guard.setHitpoints?.(0);
  PluginManager.emitNpcDeath?.({ npc: guard, npcId: GOBLIN_GUARD, killer: player, location: { x: 2327, y: 9399, z: 0 } });
  PluginManager.removeNpc(guard);
  tick(30);
  assert.equal(sleeper.isVisible(), true, "the sleeping guard is back at his post");
  click(player, GATE_LEFT, 2326);
  assert.ok(until(() => at(player)[1] === NORTH_Y, 6), `leaving is never stopped, even with him asleep: ${at(player)}`);
  assert.ok(until(isShut, 4));
  tick(6);
});

test("a logout during the two-tick wake still gets the guard up, so the gate is not held shut for everyone", (t) => {
  tick(30);
  assert.equal(sleeper.isVisible(), true, "the sleeper is back from the previous test");
  const { player: prodder } = actor(t, 2327, NORTH_Y + 1);
  assert.equal(PluginManager.emitNpcInteraction({ player: prodder, npc: sleeper, npcId: SLEEPING_GUARD, clickType: 1, handled: false }), true);
  core.TaskManager.cancelTasks(prodder); // what Player.onLogout does
  assert.ok(until(() => goblinGuard() != null, 4), "the goblin guard still gets up");
  const guard = goblinGuard();
  PluginManager.emitNpcDeath({ npc: guard, npcId: GOBLIN_GUARD, killer: prodder, location: { x: 2327, y: 9395, z: 0 } });
  PluginManager.removeNpc(guard);
  const { player, messages } = actor(t, 2326, NORTH_Y);
  player.setAttribute("observatory-quest:gate-unlocked", false);
  click(player, GATE_LEFT, 2326);
  assert.ok(until(isOpen, 4), `with him dead another player gets through: ${messages}`);
  tick(30);
});
