// Run after `yarn build`: node --test tests/gnome-restaurant-tip-full-inventory.test.cjs
// Gnome Restaurant: a hard delivery's tip was paid with bare `adds` once the dish and the box had gone, so a row of
// many unnoted items (pure essence, 51-97) lost all but what the free slots held, for good. Real engine: every plugin
// loaded, a real Player with a real Inventory, the plugin's own giveTip with its own reward table.
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
let Delivery;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Delivery = require("../plugins/minigames/gnomerestaurant/Delivery.GnomeRestaurant");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("every pure essence of a hard tip is kept: what has no slot lands under the player", (t) => {
  const { eligibleRewards, giveTip } = Delivery._test;
  const npcName = "Professor Imblewyn"; // the essence row is his and Onglewip's only
  const entries = eligibleRewards(npcName);
  const essence = entries.find((entry) => entry.items.some((item) => item.id === I.PURE_ESSENCE));
  assert.ok(essence, "the table has a pure essence row");
  const total = entries.reduce((sum, entry) => sum + entry.rate[0] / entry.rate[1], 0);
  let before = 0;
  for (const entry of entries) { if (entry === essence) break; before += entry.rate[0] / entry.rate[1]; }
  const pick = (before + essence.rate[0] / essence.rate[1] / 2) / total;
  const rolls = [pick, 0]; // the row, then its smallest amount
  t.mock.method(Math, "random", () => rolls.shift() ?? 0);

  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9001); p.setUsername("gnome9001"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2449, 3501, 1));
  t.after(() => p.setRegistered(false));
  for (let slot = 0; slot < 26; slot++) p.getInventory().setItem(slot, new core.Item(I.LOGS, 1)); // two free slots
  const dropped = [];
  t.mock.method(ItemOnGroundManager, "registers", (player, item) => { dropped.push([item.getId(), item.getAmount()]); return null; });
  giveTip(p, { tier: "hard", npcName });
  const min = essence.items.find((item) => item.id === I.PURE_ESSENCE).min;
  const floored = dropped.filter(([id]) => id === I.PURE_ESSENCE).reduce((sum, [, amount]) => sum + amount, 0);
  assert.equal(p.getInventory().getAmount(I.PURE_ESSENCE) + floored, min, `all ${min} essence, in the slots or on the floor`);
});
