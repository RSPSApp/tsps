// Run after `yarn build`: node --test tests/looting-bag-death-kept.test.cjs
// A looting bag competed for the kept slots on death. When it won one, its contents were still dropped for the killer
// and the kept bag came back with them inside: a dupe. The bag never takes a kept slot now. Real engine: every plugin
// loaded, real Players in the Wilderness, the real PlayerDeathTask.dropItems, returnKeptItems and defeated hooks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
let core, I, L;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; L = require("../plugins/items/LootingBag.plugin")._test; PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
let next = 8990;
function wp(t) { const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)); p.setIndex(next++); p.setUsername("dk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); t.after(() => p.setRegistered(false)); return p; }
const keysOf = (p) => [I.LOOT_KEY, I.LOOT_KEY_2, I.LOOT_KEY_3, I.LOOT_KEY_4, I.LOOT_KEY_5].reduce((n, id) => n + p.getInventory().getAmount(id), 0);
const { World } = require("../dist/game/World");
test("a looting bag never takes a kept slot, so its contents aren't both kept and dropped", (t) => {
  const killer = wp(t), victim = wp(t);
  const bag = new core.Item(22586, 1);
  victim.getInventory().setItem(0, bag);
  assert.equal(L.store(bag, new core.Item(I.ABYSSAL_WHIP, 1)), 1);
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  PlayerDeathTask.returnKeptItems(victim, kept);
  PM.emitPlayerDefeated(killer, victim);
  const back = victim.getInventory().getItems().find(i => i?.getId() === 22586);
  assert.equal(back, undefined, "the bag is not kept");
  const whips = [...World.getItems().values()].filter(g => g?.getItem().getId() === I.ABYSSAL_WHIP);
  assert.equal(whips.length, 1, "its whip is dropped once");
});
