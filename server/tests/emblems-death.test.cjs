// Run after `yarn build`: node --test tests/emblems-death.test.cjs
// Owners and developers keep everything on death, emblems included: the Emblems hook leaves a death that drops
// nothing to the default flow instead of claiming the emblem and then dropping nothing.
// Real engine: every plugin loaded, real Players, the real PlayerDeathTask.dropItems.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

const EMBLEM_TIER_3 = 12749;
let core;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
let next = 9310;
function wp(t) {
  const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)); p.setIndex(next++); p.setUsername("em" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); t.after(() => p.setRegistered(false)); return p;
}

test("a developer killed by a player in the Wilderness keeps the emblem", (t) => {
  const killer = wp(t), victim = wp(t);
  victim.setRights(core.PlayerRights.DEVELOPER);
  const emblem = new core.Item(EMBLEM_TIER_3, 1);
  victim.getInventory().setItem(0, emblem);
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  assert.ok(kept.includes(emblem), "the emblem is among the kept items");
});

test("an ordinary player killed by a player in the Wilderness does not keep the emblem", (t) => {
  const killer = wp(t), victim = wp(t);
  const emblem = new core.Item(EMBLEM_TIER_3, 1);
  victim.getInventory().setItem(0, emblem);
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  assert.ok(!kept.some((item) => item.getId() === EMBLEM_TIER_3), "the emblem is not kept");
});
