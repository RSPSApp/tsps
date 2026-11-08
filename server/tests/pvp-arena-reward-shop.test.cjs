// Run after `yarn build`: node --test tests/pvp-arena-reward-shop.test.cjs
// The PvP Arena Rewards shop (shops.json 1459, currency "PVP ARENA POINTS") spends the Reward Points that PvP Arena fights
// grant (pvp-arena:reward-points). Real engine: every plugin loaded, a real Player, the shop through ShopManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");

const SHOP = 1459;
const POINTS = "pvp-arena:reward-points";
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  new (require("../dist/game/definition/loader/impl/ShopDefinitionLoader").ShopDefinitionLoader)().load();
  ShopManager.initialize();
});
after(() => PM.emitServerShutdown({}));

function shopper(t, index, points) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index);
  p.setUsername("pvparenashop" + index);
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => { ShopManager.close(p); p.setRegistered(false); });
  p.setAttribute(POINTS, points);
  ShopManager.open(p, SHOP);
  return p;
}
const SACK = 26705, SCROLL = 26706;
const slotOf = (id) => require("../data/definitions/shops.json").find((shop) => shop.id === SHOP).originalStock.findIndex((e) => e.id === id) + 1;
const buy1 = (p, id) => ShopManager.handleWidgetAction(p, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: slotOf(id), itemId: id });

// Wiki (PvP Arena Rewards): "Blighted surge sack (x50)" for 10 points, Scroll of Imbuing for 200.
test("the PvP Arena Rewards shop sells for the Reward Points won in fights, at the Wiki's prices", (t) => {
  const p = shopper(t, 9790, 5000);
  buy1(p, SACK);
  assert.equal(5000 - p.getAttribute(POINTS), 10, "a Blighted surge sack (x50) costs 10 points");
  assert.equal(p.getInventory().getAmount(SACK), 50, "and one purchase gives 50 sacks");
  buy1(p, SCROLL);
  assert.equal(4990 - p.getAttribute(POINTS), 200, "a Scroll of Imbuing costs 200 points");
  assert.equal(p.getInventory().getAmount(SCROLL), 1);
});

test("too few points buys nothing", (t) => {
  const p = shopper(t, 9791, 199);
  buy1(p, SCROLL);
  assert.equal(p.getAttribute(POINTS), 199, "nothing spent");
  assert.equal(p.getInventory().getAmount(SCROLL), 0, "nothing bought");
});
