// Run after `yarn build`: node --test tests/death-plateau-doors.test.cjs
//
// Death Plateau's equipment room door and Harold's door are pass-through doors (233/03252.txt:36053-36090,
// 233/03247.txt:4726-4744): the doorway gets inviswall 38848, the open door goes on the next tile, and both are
// swapped back two ticks later. Real plugins, a real Player and the real task manager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "death_plateau");

function account(x, y, z) {
  const p = new Player(null);
  p.setIndex(7700);
  const sent = [];
  const sender = new Proxy({}, { get: (_, key) => (...args) => {
    if (key === "sendObject" || key === "sendObjectRemoval") sent.push([key, args[0]?.getId?.(), args[0]?.getLocation?.().getX?.(), args[0]?.getLocation?.().getY?.()]);
    return sender;
  } });
  p.getPacketSender = () => sender;
  p.isRegistered = () => true;
  p.setLocation(new core.Location(x, y, z));
  p.setNeedsPlacement(false);
  return { p, sent };
}

test("the equipment room door passes the player through as recorded", (t) => {
  const { p } = account(2894, 3567, 0);
  const sent = [];
  const log = (key) => (object) => sent.push([key, object.getId(), object.getLocation().getX(), object.getLocation().getY()]);
  t.mock.method(core.ObjectManager, "register", log("sendObject"));
  t.mock.method(core.ObjectManager, "deregister", log("sendObjectRemoval"));
  quest().setStage(p, 100);
  const door = new GameObject(core.ObjectIdentifiers.LARGE_DOOR_23, new core.Location(2894, 3566, 0), 0, 1, null);
  const event = { player: p, object: door, handled: false };
  PM.emitCustomEvent("door:open", event);
  assert.equal(event.handled, true);
  assert.deepEqual(sent.slice(0, 3), [
    ["sendObjectRemoval", 3743, 2894, 3566],
    ["sendObject", 38848, 2894, 3566],
    ["sendObject", 3744, 2894, 3567],
  ]);
  for (let i = 0; i < 10; i++) { p.setNeedsPlacement(false); p.getMovementQueue().process(); core.TaskManager.process(); core.TaskManager.processWalkTo(p.getIndex()); }
  assert.ok(sent.some(([key, id, x, y]) => key === "sendObject" && id === 3743 && x === 2894 && y === 3566), "the door is back");
  core.TaskManager.cancelTasks(p.getIndex());
});
