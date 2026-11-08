// Run after `yarn build`: node --test tests/lumbridge-diary-native-areas.test.cjs
// Two Lumbridge & Draynor tasks checked boxes that missed where the game puts the player:
//  - "Travel to the Wizards' Tower by fairy ring": DIS lands at 3108,3149 (the cache's ring), south of the old box.
//  - "Mine some iron ore at the Al Kharid mine": two of its nine iron rocks (cache 11364 at 3302,3285 and 3303,3284)
//    were south of the old box.
// Real engine: every plugin loaded, real Players; the dial through the fairy ring plugin's own dial and confirm, the
// rock mined through an object_option packet on ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");

let core, FairyRings, Progress, diary;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3302, 3285);
  core.RegionManager.loadMapFiles(3108, 3149);
  PM.emitServerStartup({});
  FairyRings = require("../plugins/world/FairyRings.plugin");
  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("lumbridge");
  PM.createApi("LumbridgeDiaryRingAccess").onCustomEvent("fairy-rings:access", (event) => { event.allowed = true; });
});
after(() => PM.emitServerShutdown({}));

let next = 9840;
function actor(t, x, y) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("lumbydiary" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c };
}
const done = (p, task) => Progress.doneTasks(p, diary).has(task);

test("DIS by fairy ring completes the Wizards' Tower task", (t) => {
  t.mock.method(TeleportHandler, "checkReqs", () => true);
  const { p } = actor(t, 3129, 3496);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAMEN_STAFF, 1));
  const ring = FairyRings._test.rings().get("DIS").destination;
  FairyRings._test.setDials(p, "DIS");
  FairyRings._test.confirmDial(p);
  for (let tick = 0; tick < 8; tick++) core.TaskManager.process();
  assert.equal(p.getLocation().getX(), ring.x ?? ring.getX?.());
  assert.equal(done(p, "travel-to-the-wizards-tower-by-fairy-ring"), true, `landed at ${p.getLocation()}`);
});

test("iron mined from the Al Kharid mine's southern rock counts", async (t) => {
  const { p, c } = actor(t, 3302, 3286);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_PICKAXE, 1), true);
  const rock = new core.GameObject(11364, new core.Location(3302, 3285, 0), 10, 0, null);
  core.ObjectManager.register(rock, true);
  t.after(() => core.ObjectManager.deregister(rock, true));
  t.mock.method(Math, "random", () => 0);
  await c.dispatch([{ type: "object_option", id: 11364, x: 3302, y: 3285, action: "Mine" }]);
  c.processTurnPackets();
  for (let tick = 0; tick < 20; tick++) { core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process(); core.TaskManager.process(); }
  assert.ok(p.getInventory().getAmount(core.ItemIdentifiers.IRON_ORE) >= 1, "the rock was mined");
  assert.equal(done(p, "mine-some-iron-ore-at-the-al-kharid-mine"), true);
});
