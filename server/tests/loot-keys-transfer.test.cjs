// Run after `yarn build`: node --test tests/loot-keys-transfer.test.cjs
// Wiki (Loot key, Death and key transfer): "the existing loot keys will be transferred to an eligible opponent even if
// the opponent does not have loot keys enabled"; past five, "some loot keys will be deleted". A killer with loot keys
// off got none of the victim's keys: they were taken off the victim and discarded. Real engine: every plugin loaded,
// real Players in the Wilderness, the plugin's own death-drop and defeated hooks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

let core;
let I;
let LootKeysPlugin;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  LootKeysPlugin = require("../plugins/items/LootKeys.plugin");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 8950;
function wildernessPlayer(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("pker" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); // level ~6 Wilderness
  t.after(() => p.setRegistered(false));
  return p;
}

function kill(killer, victim) {
  for (const item of victim.getInventory().getValidItems()) {
    PM.emitPlayerDeathItemDrop({ player: victim, killer, item, location: victim.getLocation(), dropEligible: true, handled: false });
  }
  PM.emitPlayerDefeated(killer, victim);
}

const keysOf = (p) => [I.LOOT_KEY, I.LOOT_KEY_2, I.LOOT_KEY_3, I.LOOT_KEY_4, I.LOOT_KEY_5].reduce((n, id) => n + p.getInventory().getAmount(id), 0);

test("a killer with loot keys off still receives the victim's loot key", (t) => {
  const killer = wildernessPlayer(t);
  const victim = wildernessPlayer(t);
  assert.equal(core.Wilderness.isIn(killer), true, "both in the Wilderness");
  const L = LootKeysPlugin;
  victim.getInventory().setItem(0, L.createKey([new core.Item(I.ABYSSAL_WHIP, 1)], 0));
  assert.equal(keysOf(victim), 1, "the victim carries a loot key");
  assert.equal(L.hasEnabledLootKeys(killer), false, "the killer has loot keys off");
  kill(killer, victim);
  assert.equal(keysOf(killer), 1, "the key transfers to the killer");
});

test("a killer already holding five keys gets none of the victim's, as the Wiki's limit deletes them", (t) => {
  const killer = wildernessPlayer(t);
  const victim = wildernessPlayer(t);
  const L = LootKeysPlugin;
  for (let i = 0; i < 5; i++) killer.getInventory().setItem(i, L.createKey([new core.Item(I.LOBSTER, 1)], i));
  victim.getInventory().setItem(0, L.createKey([new core.Item(I.ABYSSAL_WHIP, 1)], 0));
  kill(killer, victim);
  assert.equal(keysOf(killer), 5, "still five");
});

test("a victim's loot key never takes a kept slot, so it isn't both kept and handed over", (t) => {
  const killer = wildernessPlayer(t);
  const victim = wildernessPlayer(t);
  // A key and nothing else: unskulled, it would rank into the three kept slots.
  victim.getInventory().setItem(0, LootKeysPlugin.createKey([new core.Item(I.ABYSSAL_WHIP, 1)], 0));
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  PlayerDeathTask.returnKeptItems(victim, kept);
  PM.emitPlayerDefeated(killer, victim);
  assert.equal(keysOf(victim), 0, "not kept by the victim");
  assert.equal(keysOf(killer), 1, "handed to the killer");
});
