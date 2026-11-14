// Run after `yarn build`: node --test tests/final-dawn-tonali-cavern.test.cjs
// #3828: the Tonali Cavern's ways in and out did nothing. The Final Dawn swallowed the surface passageway at every
// stage, nothing activated the lift platform (so the north pit never showed Use), and the doors to and from the
// Ruins of Mokhaiotl, the crypt's exit, its ropes, its log balance and its lower Strange Tiles had no handler.
// Real engine: every plugin loaded, a real Player at the quest's own stage, the real object-interaction and zone
// hooks, the loc on the map, and the real task and movement ticks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { World } = require("../dist/game/World");

let core;
let quest;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  quest = require("../plugins/quests/QuestRuntime").questNamed("The Final Dawn");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const COMPLETE = 68;
const LIFT_VARBIT = 16694;
const LIFT_ATTRIBUTE = "the-final-dawn:lift-activated";
let nextIndex = 9380;

function dawnPlayer(t, stage, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex); player.setUsername(`tonali${nextIndex++}`); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  t.after(() => player.setRegistered(false));
  quest.setStage(player, stage);
  player.setLocation(new core.Location(...at));
  for (const skill of core.Skill.values()) player.getSkillManager().setCurrentLevels(skill, 99).setMaxLevel(skill, 99);
  const anims = [];
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => (anims.push(animation.getId()), perform(animation));
  return { player, anims };
}

/** Clicks the loc's first option as the listener does once the player has walked up to it. */
function click(player, id, x, y, z) {
  core.RegionManager.loadMapFiles(x, y);
  const object = MapObjects.get(id, new core.Location(x, y, z), null);
  assert.ok(object, `loc ${id} on the map at ${x},${y},${z}`);
  // The variant the player sees, as ObjectActionPacketListener resolves it (a multiloc's by its varbit).
  const definition = ObjectDefinition.forPlayer(id, player);
  const at = player.getLocation();
  const event = {
    player, object, definition, objectId: id, clickType: 1, location: { x, y, z },
    sourceLocation: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
  };
  PM.emitObjectInteraction(event);
  return event;
}

function tick(player, count = 1) {
  for (let i = 0; i < count; i++) {
    World.processCycle = (World.processCycle + 1) & 0x7fffffff;
    player.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const where = (player) => { const at = player.getLocation(); return [at.getX(), at.getY(), at.getZ()]; };

test("after the quest the surface passageway goes into the crypt; before the descent it stays the quest's", (t) => {
  const { player } = dawnPlayer(t, COMPLETE, [1306, 3036, 0]);
  assert.equal(click(player, 56636, 1305, 3033, 0).handled, true);
  tick(player, 5);
  assert.deepEqual(where(player), [1312, 9346, 2], "rsprox_transcripts/234/03285.txt lands here");

  const early = dawnPlayer(t, 30, [1306, 3036, 0]).player;
  assert.equal(click(early, 56636, 1305, 3033, 0).handled, true, "the quest still owns it before the crypt assault");
  tick(early, 5);
  assert.deepEqual(where(early), [1306, 3036, 0]);
});

test("Inspect activates the lift as captured, and then it rides between the cavern and the pit both ways", (t) => {
  const { player, anims } = dawnPlayer(t, COMPLETE, [1311, 9427, 2]);
  const sender = player.getPacketSender();
  assert.equal(sender.getVarbit(LIFT_VARBIT), 0);
  assert.equal(click(player, 56647, 1311, 9428, 2).handled, true);
  tick(player);
  assert.deepEqual(anims, [827], "human_pickupfloor a tick after the click");
  assert.equal(sender.getVarbit(LIFT_VARBIT), 0);
  tick(player);
  assert.equal(sender.getVarbit(LIFT_VARBIT), 1, "vmq4_lift_activated on the tick after");
  assert.equal(player.getAttribute(LIFT_ATTRIBUTE), 1, "and kept");
  player.getDialogueManager().reset?.();

  click(player, 56647, 1311, 9428, 2);
  // The click is handled the tick after arriving; the move is the fourth tick after arriving.
  tick(player, 2);
  assert.deepEqual(where(player), [1311, 9427, 2], "still below on the tick before the move");
  tick(player);
  assert.deepEqual(where(player), [1311, 3102, 0], "Use rides up (rsprox_transcripts/233/03234.txt)");
  tick(player, 4); // the fade back in two ticks after the move and the overlay closing two ticks later (233/03234.txt 301-305)
  player.setLocation(new core.Location(1309, 3103, 0));
  click(player, 56650, 1310, 3103, 0);
  tick(player, 4);
  assert.deepEqual(where(player), [1311, 9430, 2], "and the surface Lift Platform rides down");
});

test("the pit does nothing until the lift is activated, and the platform needs the descent", (t) => {
  const { player } = dawnPlayer(t, COMPLETE, [1309, 3103, 0]);
  click(player, 56650, 1310, 3103, 0);
  tick(player, 5);
  assert.deepEqual(where(player), [1309, 3103, 0]);

  const early = dawnPlayer(t, 40, [1311, 9427, 2]);
  click(early.player, 56647, 1311, 9428, 2);
  tick(early.player, 3);
  assert.equal(early.player.getPacketSender().getVarbit(LIFT_VARBIT), 0);
  assert.deepEqual(early.anims, []);
});

test("an activated lift is sent again at login", (t) => {
  const { player } = dawnPlayer(t, COMPLETE, [1311, 3102, 0]);
  player.setAttribute(LIFT_ATTRIBUTE, 1);
  PM.emitCustomEvent("player:bootstrap-complete", { player });
  assert.equal(player.getPacketSender().getVarbit(LIFT_VARBIT), 1);
});

test("the cavern's doors, exit, ropes and log balance lead where the recordings (or their reverse) go", (t) => {
  for (const [label, id, loc, from, to, ticks] of [
    ["door to the ruins (03285)", 56642, [1310, 9468, 2], [1311, 9467, 2], [1311, 9474, 1], 4],
    ["entrance back out of the ruins", 56645, [1310, 9473, 1], [1311, 9474, 1], [1311, 9467, 2], 4],
    ["the crypt's exit passageway", 56637, [1311, 9344, 2], [1312, 9346, 2], [1306, 3036, 0], 4],
    ["rope 2 up (03285, 03128, 01162)", 56713, [1308, 9420, 1], [1307, 9420, 1], [1309, 9420, 2], 3],
    ["rope 2 down", 56714, [1308, 9420, 2], [1309, 9420, 2], [1307, 9420, 1], 3],
    ["rope 1 up", 56711, [1315, 9420, 0], [1316, 9420, 0], [1314, 9420, 2], 3],
    ["rope 3 down", 56716, [1303, 9410, 1], [1302, 9410, 1], [1305, 9410, 0], 3],
    ["log balance east (03285)", 56718, [1302, 9398, 0], [1301, 9398, 0], [1306, 9398, 0], 8],
    ["log balance west (03285)", 56718, [1305, 9398, 0], [1306, 9398, 0], [1301, 9398, 0], 8],
  ]) {
    const { player } = dawnPlayer(t, COMPLETE, from);
    assert.equal(click(player, id, ...loc).handled, true, `${label}: taken`);
    tick(player, ticks);
    assert.deepEqual(where(player), to, label);
  }
});

test("the closed door to the ruins stays shut before the quest's doors open", (t) => {
  const { player } = dawnPlayer(t, 55, [1311, 9467, 2]);
  assert.equal(ObjectDefinition.forPlayer(56642, player).getInteractions()[0], "Open", "the closed variant at stage 55");
  click(player, 56642, 1310, 9468, 2);
  tick(player, 5);
  assert.deepEqual(where(player), [1311, 9467, 2]);
});

test("the crypt's exit is shut during the crypt assault, which the passageway back in belongs to", (t) => {
  for (const stage of [47, 50, 52]) {
    const { player } = dawnPlayer(t, stage, [1312, 9346, 2]);
    assert.equal(click(player, 56637, 1311, 9344, 2).handled, true);
    tick(player, 5);
    assert.deepEqual(where(player), [1312, 9346, 2], `stage ${stage}`);
  }
});

test("the lower crypt's Strange Tiles link floors 0 and 1 from the descent on, and not before", (t) => {
  const pairs = [
    [[1332, 9382, 0], [1328, 9379, 1]], [[1315, 9387, 0], [1319, 9384, 1]], [[1303, 9389, 0], [1298, 9383, 1]],
    [[1290, 9396, 0], [1293, 9394, 1]], [[1296, 9402, 0], [1292, 9409, 1]], [[1320, 9396, 0], [1325, 9397, 1]],
    [[1315, 9409, 0], [1322, 9407, 1]],
  ];
  const step = (player, tile) => {
    player.moveTo(new core.Location(...tile));
    PM.updatePlayerZones(player);
  };
  for (const [a, b] of pairs) {
    for (const [on, off] of [[a, b], [b, a]]) {
      const { player } = dawnPlayer(t, COMPLETE, [on[0] + 1, on[1] + 1, on[2]]);
      PM.updatePlayerZones(player);
      step(player, on);
      tick(player);
      assert.deepEqual(where(player), on, "still on the tile a tick later");
      tick(player);
      assert.deepEqual(where(player), off, `${on} -> ${off} two ticks after stepping on (rsprox_transcripts/234/03285.txt)`);
      PM.updatePlayerZones(player);
      tick(player, 3);
      assert.deepEqual(where(player), off, "landing on the partner tile doesn't bounce back");
    }
  }
  const off = dawnPlayer(t, COMPLETE, [1333, 9383, 0]).player;
  PM.updatePlayerZones(off);
  step(off, [1332, 9382, 0]);
  tick(off);
  step(off, [1333, 9382, 0]);
  tick(off, 3);
  assert.deepEqual(where(off), [1333, 9382, 0], "stepping off before it goes cancels it");

  const early = dawnPlayer(t, 40, [1333, 9383, 0]).player;
  PM.updatePlayerZones(early);
  step(early, [1332, 9382, 0]);
  tick(early, 3);
  assert.deepEqual(where(early), [1332, 9382, 0]);
});
