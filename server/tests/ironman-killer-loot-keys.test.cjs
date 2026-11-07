// Run after `yarn build`: node --test tests/ironman-killer-loot-keys.test.cjs
// An Ironman's PvP kill drops the victim's loot on the floor for the victim. With loot keys on, the key took the same
// items too, so the victim picked theirs back up and the Ironman kept a key full of them. The Ironman drop is now
// handled, so the key leaves it alone. Real engine: every plugin loaded, real Players in the Wilderness, the real
// PlayerDeathTask.dropItems, returnKeptItems and defeated hooks.
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
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; L = require("../plugins/items/LootKeys.plugin"); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
let next = 8995;
function wp(t) { const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)); p.setIndex(next++); p.setUsername("dk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); t.after(() => p.setRegistered(false)); return p; }
const keysOf = (p) => [I.LOOT_KEY, I.LOOT_KEY_2, I.LOOT_KEY_3, I.LOOT_KEY_4, I.LOOT_KEY_5].reduce((n, id) => n + p.getInventory().getAmount(id), 0);
const { World } = require("../dist/game/World");
test("an Ironman killer with loot keys on gets no key of loot that dropped for the victim", (t) => {
  const killer = wp(t), victim = wp(t);
  killer.setAttribute("ironman:mode", "ironman");
  killer.setAttribute("loot-keys-enabled", true);
  victim.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  for (let i = 1; i < 5; i++) victim.getInventory().setItem(i, new core.Item(I.DRAGON_DAGGER, 1));
  const before = [...World.getItems().values()].filter((g) => g?.getItem().getId() === I.DRAGON_DAGGER).length;
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  PlayerDeathTask.returnKeptItems(victim, kept);
  PM.emitPlayerDefeated(killer, victim);
  const dropped = [...World.getItems().values()].filter((g) => g?.getItem().getId() === I.DRAGON_DAGGER).length - before;
  assert.ok(dropped >= 1, "the lost daggers are on the floor for the victim");
  assert.equal(keysOf(killer), 0, "and not in a loot key for the Ironman");
});
