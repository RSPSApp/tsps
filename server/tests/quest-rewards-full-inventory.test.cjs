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

test("The Feud's coins and One Small Favour's key ring and lamp land under a player with a full inventory", (t) => {
  const feud = packed(t);
  QuestRuntime.questNamed("The Feud").complete(feud.p);
  assert.ok(droppedAmount(feud, I.COINS) >= 499, "The Feud's 499 coins");
  const favour = packed(t);
  QuestRuntime.questNamed("One Small Favour").complete(favour.p);
  assert.equal(droppedAmount(favour, I.STEEL_KEY_RING), 1);
  assert.equal(droppedAmount(favour, I.ANTIQUE_LAMP), 2, "the runtime's lamp and the quest's second one");
});

test("a coin stack near the cap takes what fits and the rest of Swan Song's coins land under the player", (t) => {
  const f = packed(t);
  const MAX = 2147483647;
  f.p.getInventory().setItem(0, new core.Item(I.COINS, MAX - 10));
  QuestRuntime.questNamed("Swan Song").complete(f.p);
  assert.equal(f.p.getInventory().getAmount(I.COINS), MAX, "the stack fills to the cap");
  const given = f.p.getInventory().getAmount(I.COINS) - (MAX - 10) + droppedAmount(f, I.COINS);
  assert.ok(given >= 24999, `every coin of the reward is in the stack or on the floor (${given})`);
});

test("the runtime's own completion coin lands under the player when the coin stack is at the cap", (t) => {
  const f = packed(t);
  f.p.getInventory().setItem(0, new core.Item(I.COINS, 2147483647));
  f.p.getInventory().setItem(27, new core.Item(-1, 0)); // not full: the old path took a plain add, clamped at the cap
  QuestRuntime.questNamed("Swan Song").complete(f.p); // 24,999 from its reward, 1 from the runtime's rewardItemId
  assert.equal(droppedAmount(f, I.COINS), 25000, "all 25,000, the capped stack takes none");
});
