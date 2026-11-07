// Run after `yarn build`: node --test tests/quest-rewards-full-inventory.test.cjs
// Quest rewards paid with a bare `adds` (Sheep Shearer's 60 coins, Watchtower's 5,000, Troll Romance's gems...) were
// dropped on a full inventory: `adds` never reports failure. They now go where the runtime's own completion item
// already went: what does not fit lands under the player. Real engine: every plugin loaded, a real Player with a real
// full Inventory, each quest's own completion through QuestRuntime.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

let core;
let I;
let QuestRuntime;
let next = 9100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function packed(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("rewarded" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => p.setRegistered(false));
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.LOGS, 1));
  const dropped = [];
  t.mock.method(ItemOnGroundManager, "registers", (player, item) => { dropped.push([item.getId(), item.getAmount()]); return null; });
  return { p, dropped };
}

function droppedAmount(f, id) {
  return f.dropped.filter(([itemId]) => itemId === id).reduce((sum, [, amount]) => sum + amount, 0);
}

test("Sheep Shearer's coins land under a player with a full inventory, not nowhere", (t) => {
  const f = packed(t);
  assert.equal(QuestRuntime.questNamed("Sheep Shearer").complete(f.p), true);
  assert.equal(droppedAmount(f, I.COINS), 60, "all 60 coins");
});

test("Troll Romance's uncut gems land under a player with a full inventory", (t) => {
  const f = packed(t);
  QuestRuntime.questNamed("Troll Romance").complete(f.p);
  assert.deepEqual([I.UNCUT_DIAMOND, I.UNCUT_RUBY, I.UNCUT_EMERALD].map((id) => droppedAmount(f, id)), [1, 2, 4]);
});
