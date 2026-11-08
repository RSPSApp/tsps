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

test("the PvP Arena Rewards shop sells for the Reward Points won in fights", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9790);
  p.setUsername("pvparenashop");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setAttribute(POINTS, 5000);
  const stock = require("../data/definitions/shops.json").find((shop) => shop.id === SHOP).originalStock[0];
  ShopManager.open(p, SHOP);
  ShopManager.handleWidgetAction(p, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: 1, itemId: stock.id });
  const spent = 5000 - p.getAttribute(POINTS);
  assert.ok(spent > 0, "the Reward Points paid for it");
  assert.equal(p.getInventory().getAmount(stock.id), 1, "bought");
  ShopManager.close(p);
});
