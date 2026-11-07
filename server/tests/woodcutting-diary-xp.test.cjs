// Run after `yarn build`: node --test tests/woodcutting-diary-xp.test.cjs
// OSRS Wiki (Woodcutting, Maple tree): the Kandarin Diary medium reward makes Seers' Village maples
// give 110 XP per log instead of 100.
const assert = require("node:assert/strict"), path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");

let core, next = 1500;
const previousPlayerBots = process.env.DISABLE_PLAYER_BOTS;
const SEERS = { x: 2725, y: 3500 };
const ELSEWHERE = { x: 3222, y: 3218 };

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SEERS.x, SEERS.y);
  core.RegionManager.loadMapFiles(ELSEWHERE.x, ELSEWHERE.y);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); } finally {
    if (previousPlayerBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousPlayerBots;
  }
});

function actor(t, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("mapleqa" + next); p.setRegistered(true);
  p.setLocation(new core.Location(at.x, at.y, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getSkillManager().setMaxLevels(core.Skill.WOODCUTTING, 60, false);
  p.getSkillManager().setCurrentLevels(core.Skill.WOODCUTTING, 60, false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_AXE), true);
  return { p, c };
}
async function send(f, packet) {
  await f.c.dispatch([packet]); f.c.processTurnPackets();
  for (let i = 0; i < 10; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}
// Chops maples with every draw succeeding and no bird nest, and returns the XP the first log paid.
async function mapleXp(t, at, diaryDone) {
  const f = actor(t, at);
  if (diaryDone) Diaries._test.diaryCommand({ player: f.p, parts: ["diary", "kandarin", "medium", "complete"] });
  const tree = new core.GameObject(core.ObjectIdentifiers.MAPLE_TREE, new core.Location(at.x + 1, at.y, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  t.mock.method(Math, "random", () => (new Error().stack.includes("maybeDropBirdNest") ? 0.99 : 0));
  const before = f.p.getSkillManager().getExperience(core.Skill.WOODCUTTING);
  let firstLogXp = null;
  PM.createApi("MapleXpObserve" + f.p.getIndex()).onCustomEvent("woodcutting:success", (e) => {
    if (e.player === f.p && firstLogXp === null) firstLogXp = f.p.getSkillManager().getExperience(core.Skill.WOODCUTTING) - before;
  });
  await send(f, { type: "object_option", id: tree.getId(), x: at.x + 1, y: at.y, action: "Chop down" });
  for (let i = 0; i < 6; i++) core.TaskManager.process();
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.MAPLE_LOGS) >= 1, true, "the chop gave a log");
  return firstLogXp;
}

test("a maple in Seers' Village pays 110 XP per log after the Kandarin medium diary", async (t) => {
  assert.equal(await mapleXp(t, SEERS, true), 110);
});
test("a maple in Seers' Village pays 100 XP without the diary tier", async (t) => {
  assert.equal(await mapleXp(t, SEERS, false), 100);
});
test("a maple outside Seers' Village pays 100 XP even with the diary tier", async (t) => {
  assert.equal(await mapleXp(t, ELSEWHERE, true), 100);
});
