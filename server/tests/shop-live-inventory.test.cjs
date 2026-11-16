// Run after `yarn build`: node --test tests/shop-live-inventory.test.cjs
//
// Shops opened under their live inventory (data/definitions/shop-inventories.json): the cache's
// shop scripts are given it, and script 5022 draws an inventory that enums 4824/5412 mark with no
// counts (infinite stock). Farming Supplies (the Fossil Island squirrels' shop, every item at
// stock inf on the Wiki) is farmer_supplies; every other shop keeps the shared 516.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { decodeShopOpen } = require("./helpers/shop-open-packet.cjs");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
});

const shopId = (name) => ShopDefinition.all().find((entry) => entry.getName() === name).getId();

/** Opens a shop for a real player, recording the client scripts run and the SHOP_OPEN packet. */
function open(name) {
  const p = new Player(null);
  p.setUsername(`shopinv${Math.floor(Math.random() * 1e6)}`);
  const scripts = [];
  const packets = [];
  const sender = new Proxy({}, {
    get: (_target, key) => (key === "sendInterfaceScript" ? (id, args) => (scripts.push([id, args]), sender) : () => sender),
  });
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: (packet) => (packets.push(Buffer.from(packet)), true) });
  assert.equal(ShopManager.open(p, shopId(name)), true, `${name} opens`);
  const init = scripts.find(([id]) => id === 1074);
  return { player: p, args: init[1], scriptInventory: init[1][0], packetInventory: decodeShopOpen(packets.at(-1)).inventoryId };
}

test("the cache marks farmer_supplies as infinite stock: its items draw with no counts", () => {
  const inventory = CacheDefinitions.getInventoryId("farmer_supplies");
  assert.equal(inventory, 894);
  assert.equal(CacheDefinitions.getEnumValues(4824).get(inventory), 1);
  assert.notEqual(CacheDefinitions.getEnumValues(4824).get(516), 1, "the shared 516 is not");
  assert.notEqual(CacheDefinitions.getEnumValues(5412).get(516), 1);
});

test("Farming Supplies opens under farmer_supplies: the shop scripts and the SHOP_OPEN packet name it", () => {
  const farming = open("Farming Supplies");
  assert.equal(farming.scriptInventory, 894);
  assert.equal(farming.packetInventory, 894);
  assert.equal(ShopManager.inventoryId(shopId("Farming Supplies")), 894);
});

test("a shop without a live inventory keeps the shared 516", () => {
  const general = open("Lumbridge General Store");
  assert.equal(general.scriptInventory, 516);
  assert.equal(general.packetInventory, 516);
});

// The inns and Efaritay's Supplies (enum 5412's pub_* and 4824's efaritay_weapon_shop): each live
// inventory is an infinite-stock one (its size equals the shop's item count), and the shop opens under it.
test("every mapped live inventory is infinite stock and named on open", () => {
  const { inventories } = require("../data/definitions/shop-inventories.json");
  const shops = require("../data/definitions/shops.json");
  assert.ok(Object.keys(inventories).length >= 16);
  for (const [id, name] of Object.entries(inventories)) {
    const inventory = CacheDefinitions.getInventoryId(name);
    assert.ok([4824, 5412].some((e) => CacheDefinitions.getEnumValues(e).get(inventory) === 1), `${name} is infinite stock`);
    const shop = shops.find((entry) => entry.id === Number(id));
    assert.equal(ShopManager.inventoryId(shop.id), inventory, shop.name);
  }
  assert.equal(open("Deepfin Inn").scriptInventory, CacheDefinitions.getInventoryId("pub_deepfin"));
  assert.equal(open("The Pandemonium (pub)").packetInventory, CacheDefinitions.getInventoryId("pub_pandemonium_2"));
});

test("every live inventory in shop-inventories.json names a real shop and a cache inventory", () => {
  const { inventories } = require("../data/definitions/shop-inventories.json");
  for (const [id, name] of Object.entries(inventories)) {
    assert.ok(ShopDefinition.all().some((shop) => shop.getId() === Number(id)), `shop ${id}`);
    assert.notEqual(CacheDefinitions.getInventoryId(name), null, name);
  }
});

// shop_main_init's obj, int and boolean (highlighted item, extra "Buy N", "Buy 50"), as recorded:
// every call passes -1 and 0; Farming Supplies passes false (rsprox_transcripts/227/00127.txt),
// The Pandemonium false (229/00672.txt), every other shop true (e.g. 233 general stores, Oziach).
test("script 1074 gets obj -1 and int 0, and no Buy 50 only for an infinite-stock shop", () => {
  const farming = open("Farming Supplies");
  assert.deepEqual(farming.args.slice(2), [-1, 0, 0]);
  assert.equal(ShopManager.offersBuyFifty(shopId("Farming Supplies")), false);
  const general = open("Lumbridge General Store");
  assert.deepEqual(general.args.slice(2), [-1, 0, 1]);
  assert.equal(ShopManager.offersBuyFifty(shopId("Lumbridge General Store")), true);
});

test("the Buy-50 button leaves the quantity unchanged in a shop without it (script 2231)", () => {
  const farming = open("Farming Supplies");
  ShopManager.handleWidgetAction(farming.player, { groupId: 300, childId: 14, buttonNum: 1 });
  assert.equal(Number(farming.player.getAttribute("shop:quantity-mode") ?? 0), 0);
  ShopManager.handleWidgetAction(farming.player, { groupId: 300, childId: 12, buttonNum: 1 });
  assert.equal(farming.player.getAttribute("shop:quantity-mode"), 3, "Buy 10 still selects");
  const general = open("Lumbridge General Store");
  ShopManager.handleWidgetAction(general.player, { groupId: 300, childId: 14, buttonNum: 1 });
  assert.equal(general.player.getAttribute("shop:quantity-mode"), 4);
});
