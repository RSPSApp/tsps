// Run after `yarn build`: node --test tests/priest-in-peril-doors.test.cjs
//
// Issue 4130: Paterdomus' large doors and Drezel's cell gate teleported the player across. Live
// (Priest in Peril capture 2026-11-02 ticks 10840-10847 and 10980-10982; capture 2026-10-17 ticks
// 1311-1317 for the cell gate) swings them open with an invisible blocker on the doorway, walks the opener one tile
// across and shuts them two ticks later. The locked cell gate's Open is how the player talks to Drezel
// (tick 11162-11168), and the iron key only unlocks it: the player stays outside (tick 11429).
//
// Real engine, as crandor-secret-wall.test.cjs: every plugin loaded, real Players, the quest at its
// real stages, every click through ObjectActionPacketListener.executeAction and the ticks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const INVISWALL = 38848, TEMPLE_LEFT_OPEN = 3491, TEMPLE_RIGHT_OPEN = 3492, CELL_GATE_OPEN = 3464;
const STAGE = { STARTED: 10, TOLD_KING: 30, MET_DREZEL: 40, CELL_UNLOCKED: 43 };

let core;
let next = 5600;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3408, 3488);
  PluginManager.emitServerStartup({});
});

function actor(t, stage, x, y, z = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("pipdoor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  players.push(player);
  t.after(() => {
    player.getDialogueManager().reset?.();
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
  });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "priest_in_peril");
  assert.ok(quest, "Priest in Peril is registered");
  quest.setStage(player, stage);
  return { player, quest };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const settle = () => tick(8);
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const locAt = (id, x, y, z = 0) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === z) return object;
    }
  }
  return null;
};
const click = (player, id, x, y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
const templeOpen = () => locAt(TEMPLE_RIGHT_OPEN, 3409, 3488) !== null;
const cellOpen = () => locAt(CELL_GATE_OPEN, 3416, 3489, 2) !== null;

test("the temple's large doors open, walk the player in and out, and shut two ticks later", (t) => {
  const O = core.ObjectIdentifiers;
  const { player } = actor(t, STAGE.TOLD_KING, 3408, 3488);
  settle();
  assert.ok(locAt(O.LARGE_DOOR_22, 3408, 3488), "the closed right door is on the map");
  click(player, O.LARGE_DOOR_22, 3408, 3488);
  assert.ok(until(templeOpen, 4), "the open leaves stand on the tiles east");
  assert.ok(locAt(TEMPLE_LEFT_OPEN, 3409, 3489), "both leaves swing");
  assert.ok(locAt(INVISWALL, 3408, 3488) && locAt(INVISWALL, 3408, 3489), "blockers stand on both doorway tiles");
  assert.ok(until(() => at(player)[0] === 3409, 4), "the player walks into the temple");
  assert.deepEqual(at(player), [3409, 3488]);
  assert.ok(!player.getForceMovement(), "an ordinary walk, not a forced movement or a teleport");
  settle();
  assert.equal(templeOpen(), false, "the doors shut again");
  assert.ok(locAt(O.LARGE_DOOR_22, 3408, 3488) && locAt(O.LARGE_DOOR_21, 3408, 3489), "the closed doors are back");

  player.setLocation(new core.Location(3409, 3489, 0));
  settle();
  click(player, O.LARGE_DOOR_21, 3408, 3489);
  assert.ok(until(() => at(player)[0] === 3408, 4), "and walks back out on the clicked row");
  assert.deepEqual(at(player), [3408, 3489]);
  settle();
  assert.equal(templeOpen(), false, "the doors shut behind them");
});

test("before the King is told, the large doors only answer; nobody else walks through an opening", (t) => {
  const O = core.ObjectIdentifiers;
  const { player: early } = actor(t, STAGE.STARTED, 3408, 3488);
  settle();
  click(early, O.LARGE_DOOR_22, 3408, 3488);
  tick(3);
  assert.equal(templeOpen(), false, "the doors stay shut");
  assert.deepEqual(at(early), [3408, 3488], "and the player stays outside");
  assert.ok(early.getDialogueManager().getCurrent(), "the Mysterious Voice answers");
  early.getDialogueManager().reset?.();

  const { player: opener } = actor(t, STAGE.TOLD_KING, 3408, 3489);
  settle();
  click(opener, O.LARGE_DOOR_21, 3408, 3489);
  assert.ok(until(templeOpen, 4), "the opener opens them");
  early.getMovementQueue().addSteps(new core.Location(3409, 3488, 0));
  tick(2);
  assert.equal(at(early)[0], 3408, "the blocker keeps the early player out");
  settle();
});

test("Drezel's cell gate: Open talks through it, the iron key unlocks it in place, then it opens like a door", (t) => {
  const O = core.ObjectIdentifiers;
  const I = core.ItemIdentifiers;
  const { player, quest } = actor(t, STAGE.TOLD_KING, 3415, 3489, 2);
  settle();
  assert.ok(locAt(O.CELL_GATE_7, 3415, 3489, 2), "the cell gate is on the map");

  click(player, O.CELL_GATE_7, 3415, 3489);
  tick(2);
  assert.ok(player.getDialogueManager().getCurrent(), "Drezel's conversation starts through the gate");
  assert.equal(quest.getStage(player), STAGE.MET_DREZEL, "meeting him through the gate counts");
  assert.equal(cellOpen(), false, "the locked gate never opens");
  assert.deepEqual(at(player), [3415, 3489]);
  player.getDialogueManager().reset?.();

  player.getInventory().adds(I.IRON_KEY, 1);
  click(player, O.CELL_GATE_7, 3415, 3489);
  tick(2);
  assert.equal(quest.getStage(player), STAGE.CELL_UNLOCKED, "the iron key unlocks it");
  assert.deepEqual(at(player), [3415, 3489], "unlocking leaves the player outside the cell, as captured");
  assert.equal(cellOpen(), false, "unlocking does not open it");
  player.getDialogueManager().reset?.();

  click(player, O.CELL_GATE_7, 3415, 3489);
  assert.ok(until(cellOpen, 4), "the unlocked gate swings open onto the tile east");
  assert.ok(locAt(INVISWALL, 3415, 3489, 2), "with a blocker on the doorway");
  assert.ok(until(() => at(player)[0] === 3416, 4), "the player walks into the cell");
  assert.ok(!player.getForceMovement(), "an ordinary walk, not a teleport");
  settle();
  assert.equal(cellOpen(), false, "the gate shuts again");
  assert.ok(locAt(O.CELL_GATE_7, 3415, 3489, 2), "the closed gate is back");

  click(player, O.CELL_GATE_7, 3415, 3489);
  assert.ok(until(() => at(player)[0] === 3415, 6), "and out again");
  settle();
  assert.equal(cellOpen(), false);
});
