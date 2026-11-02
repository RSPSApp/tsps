// Leagues VI's shops that never deplete (leagues.json `shopStock`), through the real ShopManager and
// the real league plugin: a Demonic Pacts character's buy leaves the shop's own stock as it was,
// stock players sold it still goes, and a character of no league buys as on any world.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let ShopManager;
let next = 2300;
const SHOP = 1468; // TzHaar-Hur-Lek's Ore and Gem Store (Default)

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
  ({ ShopManager } = require("../dist/game/model/container/shop/ShopManager"));
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
});
after(() => PM.emitServerShutdown({}));

function character(t, profile) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`shop${next}`);
  player.setProfile(profile);
  player.setRegistered(true);
  player.setLocation(new core.Location(2475, 5144, 0));
  player.needsPlacement = false;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true, profile });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.setAttribute("league:tutorial-stage", 14);
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

const onyx = () => core.ItemIdentifiers.UNCUT_ONYX;
const shop = () => ShopManager.shopsById.get(SHOP);
const stock = () => shop().stock.get(onyx()) ?? 0;

function buy(player, option = "Buy 1") {
  player.getInventory().add(new core.Item(core.ItemIdentifiers.TOKKUL, 2000000000), true);
  ShopManager.open(player, SHOP);
  const slot = ShopManager.displayEntries(shop()).findIndex(({ itemId }) => itemId === onyx());
  ShopManager.handleWidgetAction(player, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: slot + 1, itemId: onyx() });
}

function fresh() {
  ShopManager.initialize();
  return stock();
}

test("a Demonic Pacts character's purchase leaves the shop's own stock as it was", (t) => {
  const original = fresh();
  assert.ok(original > 0);
  const league = character(t, "league");
  for (let i = 0; i < 3; i++) buy(league);
  assert.equal(league.getInventory().getAmount(onyx()), 3, "bought three");
  assert.equal(stock(), original, "the stock never went down");
});

test("stock players sold the shop still goes, down to the shop's own amount", (t) => {
  const original = fresh();
  shop().stock.set(onyx(), original + 2); // two sold to it
  const league = character(t, "league");
  for (let i = 0; i < 3; i++) buy(league);
  assert.equal(league.getInventory().getAmount(onyx()), 3, "bought three");
  assert.equal(stock(), original, "the sold two went, the shop's own stayed");
});

test("the hook is the league's: a character of no league keeps nothing", (t) => {
  const request = { player: { isPlayer: () => true, getAttribute: () => undefined, getProfile: () => "main" }, shopId: SHOP, itemId: onyx(), amount: 1, keep: false };
  PM.emitCustomEvent("shop:keep-stock", request);
  assert.equal(request.keep, false);
  const league = character(t, "league");
  const asked = { player: league, shopId: SHOP, itemId: onyx(), amount: 1, keep: false };
  PM.emitCustomEvent("shop:keep-stock", asked);
  assert.equal(asked.keep, true);
});
