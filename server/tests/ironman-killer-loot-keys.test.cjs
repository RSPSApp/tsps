// Run after `yarn build`: node --test tests/ironman-killer-loot-keys.test.cjs
// An Ironman's PvP kill drops the victim's loot on the floor for the victim. With loot keys on, the key took the same
// items too, so the victim picked theirs back up and the Ironman kept a key full of them. The Ironman drop is now
// handled, so the key leaves it alone. An Ironman still receives loot keys (Wiki), but can only destroy their loot. Real engine: every plugin loaded, real Players in the Wilderness, the real
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

// Wiki (Loot key, Ironman Mode): Ironmen "can unlock and receive loot keys, but they may not retrieve the loot
// themselves"; at the Loot Chest the "only option" is to destroy it. Keys are always lost on death, Ironman killer or not.
test("an Ironman killer gets the victim's loot key, but the chest only lets them destroy its loot", (t) => {
  const killer = wp(t), victim = wp(t);
  killer.setAttribute("ironman:mode", "ironman");
  const messages = [];
  t.mock.method(killer, "sendMessage", (text) => { messages.push(text); });
  victim.getInventory().setItem(0, L.createKey([new core.Item(I.ABYSSAL_WHIP, 1), new core.Item(I.DRAGON_DAGGER, 1)], 0));
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  PlayerDeathTask.returnKeptItems(victim, kept);
  PM.emitPlayerDefeated(killer, victim);
  assert.equal(keysOf(victim), 0, "keys are never kept");
  assert.equal(keysOf(killer), 1, "the Ironman receives the key");

  const slot = killer.getInventory().getItems().findIndex((item) => item && L.isLootKey(item));
  assert.equal(L.openKey(killer, slot), true, "and can open it at the chest");
  const carried = () => killer.getInventory().getAmount(I.ABYSSAL_WHIP) + killer.getBank(0).getAmount(I.ABYSSAL_WHIP);
  L.takeChestItem(killer, 0, "inventory");
  L.takeChestItem(killer, 0, "bank");
  L.takeAllChestItems(killer, "inventory", false);
  L.takeAllChestItems(killer, "bank", false);
  assert.equal(carried(), 0, "but takes nothing out of it");
  assert.equal(L.chestItems(killer).length, 2, "the loot stays in the chest");
  assert.ok(messages.includes("As an Ironman, you can't take loot from a loot key; you can only destroy it."));
  assert.equal(L.destroyChestItem(killer, 0), true, "destroying it still works");
  assert.equal(L.chestItems(killer).length, 1);
});

test("a normal killer still takes the loot out of the chest", (t) => {
  const killer = wp(t);
  killer.getInventory().setItem(0, L.createKey([new core.Item(I.ABYSSAL_WHIP, 1)], 0));
  assert.equal(L.openKey(killer, 0), true);
  L.takeChestItem(killer, 0, "inventory");
  assert.equal(killer.getInventory().getAmount(I.ABYSSAL_WHIP), 1);
  assert.equal(L.chestItems(killer).length, 0);
});
