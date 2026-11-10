// Run after `yarn build`: node --test tests/karamja-gloves-shops.test.cjs
// Wiki (Karamja gloves): worn gloves get the Karamja shops' "(Karamja gloves)" prices; Jiminua's Jungle Store and
// the Karamja General Store need Karamja gloves 3 or 4.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Rewards = require("../plugins/items/diaryrewards/Common.DiaryRewards");
const KaramjaGloves = require("../plugins/items/diaryrewards/KaramjaGloves.DiaryRewards");
const Shopkeepers = require("../plugins/npcs/Shopkeepers.plugin");

const GLOVES = [I.KARAMJA_GLOVES_1, I.KARAMJA_GLOVES_2, I.KARAMJA_GLOVES_3, I.KARAMJA_GLOVES_4];
const HANDS_SLOT = 9;

/** Each Karamja store with a gloves version: [Default, gloves version, lowest tier]. */
const STORES = [
  ["Davon's Amulet Store. (Default)", "Davon's Amulet Store. (Karamja gloves)", 1],
  ["Fernahei's Fishing Hut. (Default)", "Fernahei's Fishing Hut. (Karamja gloves)", 1],
  ["Obli's General Store. (Default)", "Obli's General Store. (Karamja gloves)", 1],
  ["Tamayu's Spear Stall (Default)", "Tamayu's Spear Stall (Karamja gloves)", 1],
  ["Jiminua's Jungle Store. (Default)", "Jiminua's Jungle Store. (Karamja gloves 3+)", 3],
  ["Karamja General Store (Default)", "Karamja General Store (Karamja gloves 3)", 3],
  ["TzHaar-Hur-Lek's Ore and Gem Store (Default)", "TzHaar-Hur-Lek's Ore and Gem Store (Karamja gloves)", 1],
  ["TzHaar-Hur-Rin's Ore and Gem Store (Default)", "TzHaar-Hur-Rin's Ore and Gem Store (Karamja gloves)", 1],
  ["TzHaar-Hur-Tel's Equipment Store (Default)", "TzHaar-Hur-Tel's Equipment Store (Karamja gloves)", 1],
  ["TzHaar-Hur-Zal's Equipment Store (Default)", "TzHaar-Hur-Zal's Equipment Store (Karamja gloves)", 1],
  ["TzHaar-Mej-Roh's Rune Store (Default)", "TzHaar-Mej-Roh's Rune Store (Karamja gloves)", 1],
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  Rewards.init({ core: PluginManager.getCoreApi() });
});

function shopper(gloves = null) {
  const p = new Player(null);
  p.setUsername(`gloves${Math.floor(Math.random() * 1e6)}`);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: () => true });
  p.sendMessage = (text) => messages.push(text);
  if (gloves) p.getEquipment().getItems()[HANDS_SLOT] = new Item(gloves, 1);
  return Object.assign(p, { messages });
}

/** The version Trade (or an open_shop step listing both) opens for this player. */
function opens(player, shops) {
  const request = { player, npcId: -1, target: null, shops, shop: null };
  KaramjaGloves.pickGlovesVersion(request);
  return request.shop ?? shops.find((name) => name.endsWith(" (Default)"));
}

test("each gloves version shares its Default store's Trade option, so Trade picks between them", () => {
  const shared = Shopkeepers.sharedTraders();
  for (const [base, gloves] of STORES) {
    const options = [...shared].filter(([, shops]) => shops.some((shop) => shop.name === base));
    assert.ok(options.length > 0, `${base} is on a shared option`);
    for (const [key, shops] of options) {
      assert.deepEqual(shops.map((shop) => shop.name).sort(), [base, gloves].sort(), key);
    }
  }
});

test("the gloves versions open while gloves of their tier are worn, the Default ones otherwise", () => {
  for (const [base, gloves, lowest] of STORES) {
    assert.equal(opens(shopper(), [base, gloves]), base, `${base}: no gloves`);
    GLOVES.forEach((id, index) => {
      const tier = index + 1;
      assert.equal(opens(shopper(id), [base, gloves]), tier >= lowest ? gloves : base, `${base}: Karamja gloves ${tier}`);
    });
  }
});

test("gloves carried rather than worn, or other gloves, keep the Default prices", () => {
  const carried = shopper();
  carried.getInventory().add(new Item(I.KARAMJA_GLOVES_4, 1), false);
  assert.equal(opens(carried, [STORES[0][0], STORES[0][1]]), STORES[0][0]);
  assert.equal(opens(shopper(I.LEATHER_GLOVES), [STORES[0][0], STORES[0][1]]), STORES[0][0]);
});

test("a shop another plugin already picked, or one without a gloves version, is left alone", () => {
  const picked = { player: shopper(I.KARAMJA_GLOVES_4), shops: [STORES[0][0], STORES[0][1]], shop: STORES[0][0] };
  KaramjaGloves.pickGlovesVersion(picked);
  assert.equal(picked.shop, STORES[0][0]);
  const other = { player: shopper(I.KARAMJA_GLOVES_4), shops: ["Battle Runes (Pre-miniquest)", "Battle Runes (Post-miniquest)"], shop: null };
  KaramjaGloves.pickGlovesVersion(other);
  assert.equal(other.shop, null);
});

function shopId(name) {
  return ShopDefinition.all().find((entry) => entry.getName() === name).getId();
}

function cost(p, id) {
  return ShopManager.getOpenShop(p).stock.find((entry) => entry.itemId === id).price;
}

function offer(p, id) {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option: "Value",
    slot: p.getInventory().getItems().findIndex((item) => item?.getId() === id), itemId: id,
  });
  return Number(/shop will buy for ([\d,]+) /.exec(p.messages.at(-1))[1].replace(/,/g, ""));
}

test("the Mor Ul Rek stores sell at 130% and buy at 35% in the gloves versions (an uncut onyx costs 260,000 tokkul)", () => {
  ShopManager.initialize();
  ShopManager.registerItemCurrency(I.TOKKUL);
  const hurLek = shopper(I.KARAMJA_GLOVES_1);
  ShopManager.open(hurLek, shopId("TzHaar-Hur-Lek's Ore and Gem Store (Karamja gloves)"));
  assert.equal(cost(hurLek, I.UNCUT_ONYX), 260_000);

  const mejRoh = shopper(I.KARAMJA_GLOVES_1);
  mejRoh.getInventory().add(new Item(I.CHAOS_RUNE, 1), false);
  ShopManager.open(mejRoh, shopId("TzHaar-Mej-Roh's Rune Store (Karamja gloves)"));
  assert.equal(offer(mejRoh, I.CHAOS_RUNE), 31, "a chaos rune (value 90) at its normal stock");
});

test("Davon sells at 110% and buys at 100% in his gloves version", () => {
  ShopManager.initialize();
  const p = shopper(I.KARAMJA_GLOVES_1);
  p.getInventory().add(new Item(I.AMULET_OF_POWER, 1), false);
  ShopManager.open(p, shopId("Davon's Amulet Store. (Karamja gloves)"));
  assert.equal(offer(p, I.AMULET_OF_POWER), 3525);
});

test("a gloves version is the same shop as its Default one: one stock, its own prices", () => {
  ShopManager.shareStock(KaramjaGloves.defaultVersion);
  ShopManager.initialize();
  ShopManager.registerItemCurrency(I.TOKKUL);
  assert.equal(KaramjaGloves.defaultVersion(ShopDefinition.forId(shopId(STORES[6][1]))), STORES[6][0]);
  assert.equal(KaramjaGloves.defaultVersion(ShopDefinition.forId(shopId(STORES[6][0]))), null);

  const plain = shopper();
  ShopManager.open(plain, shopId(STORES[6][0]));
  const gloved = shopper(I.KARAMJA_GLOVES_1);
  gloved.getInventory().add(new Item(I.TOKKUL, 300_000), false);
  ShopManager.open(gloved, shopId(STORES[6][1]));
  const stock = (p, id) => ShopManager.getOpenShop(p).stock.find((entry) => entry.itemId === id)?.amount ?? 0;
  assert.equal(stock(plain, I.UNCUT_ONYX), 1);

  ShopManager.handleWidgetAction(gloved, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1",
    slot: ShopManager.getOpenShop(gloved).stock.findIndex((entry) => entry.itemId === I.UNCUT_ONYX) + 1, itemId: I.UNCUT_ONYX,
  });
  assert.equal(gloved.getInventory().getAmount(I.TOKKUL), 40_000, "bought at the gloves price, 260,000");
  assert.equal(stock(gloved, I.UNCUT_ONYX), 0);
  assert.equal(stock(plain, I.UNCUT_ONYX), 0, "the Default version's stock went with it");
  assert.equal(cost(plain, I.UNCUT_ONYX), 304_000, "at its own rate: 150% + 2% for the one below its normal stock");
});
