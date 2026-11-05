"use strict";

/**
 * Ali Morrisane's rune stock, one shop per player (rsprox 3170, rev 232): roguetrader_alim_runedump (315) holds the
 * runes of the casket just opened, roguetrader_alim_runeretail_inv (313, "Ali's Discount wares.") the elemental runes and
 * their packs, roguetrader_alim_runewholesale_inv (314) the others. The engine's shops are shared, so each player's are
 * registered under their own ids (ShopManager.registerShop) and removed at logout.
 *
 * Wiki (Ali's Discount Wares.): the base stock is 20 of each elemental rune and 3 of each of their four packs, sold at
 * 130% of the item value (restock 50 ticks, packs 70); 100 of each other rune (10 cosmic) and 5 of the mind and chaos
 * packs at 125%. The capture's stock was that plus the casket's runes, falling by one every 50 ticks (small casket: fire
 * 88 + 20 - 4 = 104 at t504, 103 at t543, 85 at t1459, never under 20); here the casket's runes are added to the
 * stock above its base and the engine's restock lowers them again. Law rune: "currently costs 300 coins" (value 240 at
 * 125%). Ours: the casket's random contents (the captures have two samples), the discount on "Buy all" (the offers were
 * 890 for 208 elemental runes and 33156 for the 266 others, which is 86% and 76% of the shop prices; the discount
 * here is a random 75-86%), the surplus being added when the player looks at the runes, and the shops (their
 * purchases and surplus) starting over at logout.
 */

const SHOP_BASE_ID = 700000;
const KIND = { dump: 0, retail: 1, wholesale: 2, blackjack: 3, clothes: 4 };
// The capture names these shops "Ali's Discount wares." (lower-case w); the generated page's open_shop opens the one shop named exactly
// "Ali's Discount Wares." (shops.json 1008, NpcDialogues needs exactly one match), so the two names must stay different in case.
const NAMES = { dump: "Ali Morrisane's discount rune store.", retail: "Ali's Discount wares.", wholesale: "Ali's Discount wares." };
/** id, base stock, restock ticks, Wiki value, multiplier. Order is the capture's. */
const ELEMENTAL = [[554, 20, 50, 4], [555, 20, 50, 4], [556, 20, 50, 4], [557, 20, 50, 4]];
const ELEMENTAL_PACKS = [12734, 12730, 12728, 12732];
const CATALYTIC = [[561, 100, 50, 180], [563, 100, 50, 240], [562, 100, 50, 90], [560, 100, 50, 180], [558, 100, 50, 3],
  [559, 100, 50, 3], [565, 100, 50, 400], [564, 10, 50, 50], [566, 100, 50, 300]];
const CATALYTIC_PACKS = [12736, 12738];
const ELEMENTAL_MULTIPLIER = 1.3, CATALYTIC_MULTIPLIER = 1.25;
/** The small casket's runes (fire, earth, water, air) and the large's, in the capture's order. */
const SMALL_RUNES = [554, 557, 555, 556];
const LARGE_RUNES = [565, 560, 558, 563, 561, 559, 562, 566, 564];

let api;
const core = () => api.core;
const idFor = (player, kind) => SHOP_BASE_ID + player.getIndex() * 8 + KIND[kind];

function packValue(id) {
  return core().ItemDefinition.forId(id)?.getValue?.() ?? 0;
}
const retailPrice = (id, value) => Math.max(1, Math.floor(value * ELEMENTAL_MULTIPLIER));
const wholesalePrice = (id, value) => Math.max(1, Math.floor(value * CATALYTIC_MULTIPLIER));

/** The runes' shop prices, for the casket offers: id -> price. */
function priceTable() {
  const table = new Map();
  for (const [id, , , value] of ELEMENTAL) table.set(id, retailPrice(id, value));
  for (const [id, , , value] of CATALYTIC) table.set(id, wholesalePrice(id, value));
  return table;
}

/** A casket's contents: ours, a random amount of each of its runes. */
function contents(kind) {
  const ids = kind === "small" ? SMALL_RUNES : LARGE_RUNES;
  const out = new Map();
  for (const id of ids) out.set(id, kind === "small" ? 10 + Math.floor(Math.random() * 90) : 15 + Math.floor(Math.random() * 40));
  return out;
}
/** Ours: 75-86% of the shop prices (the two captured offers were 86% and 76%). */
const discount = () => 0.75 + Math.random() * 0.11;
function offer(items, rate) {
  const prices = priceTable();
  let total = 0;
  for (const [id, count] of items) total += count * (prices.get(id) ?? 0);
  return Math.max(1, Math.round(total * rate));
}

/** The player's shop of this kind: registered once, so what they buy (and the casket's runes) stays between opens. */
function ensure(player, kind, name, entries) {
  const id = idFor(player, kind);
  const { ShopDefinition, ShopManager } = core();
  if (!ShopManager.hasShop(id)) {
    ShopManager.registerShop(new ShopDefinition(id, name, "COINS", entries(), 100, 100, 100, "rogue-trader"));
  }
  return id;
}

/** A casket's own shop is new every time. */
function fresh(player, kind, name, entries) {
  const id = idFor(player, kind);
  const { ShopDefinition, ShopManager } = core();
  ShopManager.removeShop(id);
  ShopManager.registerShop(new ShopDefinition(id, name, "COINS", entries, 100, 100, 100, "rogue-trader"));
  return id;
}

/**
 * The casket's shop: its runes are registered at amount 0 and added with addShopStock, like the surplus of the other shops, so they
 * count as stock above the original and fall back to nothing instead of restocking at the casket's discount.
 */
function openDump(player, items, rate) {
  const prices = priceTable();
  const entries = [...items].map(([id]) => ({ id, amount: 0, restockTicks: null, price: Math.max(1, Math.round((prices.get(id) ?? 1) * rate)) }));
  const shop = fresh(player, "dump", NAMES.dump, entries);
  for (const [id, count] of items) core().ShopManager.addShopStock(shop, id, count);
  core().ShopManager.open(player, shop);
}

const retailEntries = () => ELEMENTAL.map(([id, base, restock, value]) => ({ id, amount: base, restockTicks: restock, price: retailPrice(id, value) }))
  .concat(ELEMENTAL_PACKS.map((id) => ({ id, amount: 3, restockTicks: 70, price: Math.floor(packValue(id) * ELEMENTAL_MULTIPLIER) || null })));
const wholesaleEntries = () => CATALYTIC.map(([id, base, restock, value]) => ({ id, amount: base, restockTicks: restock, price: wholesalePrice(id, value) }))
  .concat(CATALYTIC_PACKS.map((id) => ({ id, amount: 5, restockTicks: 70, price: Math.floor(packValue(id) * CATALYTIC_MULTIPLIER) || null })));

function openRetail(player) {
  core().ShopManager.open(player, ensure(player, "retail", NAMES.retail, retailEntries));
}

function openWholesale(player) {
  core().ShopManager.open(player, ensure(player, "wholesale", NAMES.wholesale, wholesaleEntries));
}

/** The casket's runes join the player's stock above the base amount, falling back by one every restock (3170 t504 -> t1459). */
function addSurplus(player, items) {
  const elemental = new Set(ELEMENTAL.map(([id]) => id));
  for (const [id, count] of items) {
    const kind = elemental.has(id) ? "retail" : "wholesale";
    const shop = ensure(player, kind, NAMES[kind], kind === "retail" ? retailEntries : wholesaleEntries);
    core().ShopManager.addShopStock(shop, id, count);
  }
}

/** 3170: roguetrader_alim_assaultbj_inv (310, shown after the defensive route) and roguetrader_alim_defendbj_inv (309, after the offensive), 25 of each. */
const BLACKJACKS = {
  defensive: [6410, 6414, 6420, 6416, 4600], // oak (d), willow (d), maple (d), maple, willow
  offensive: [6408, 6412, 6418, 6416, 4600], // oak (o), willow (o), maple (o), maple, willow
};
/** 3170: roguetrader_alim_meanpclothes_inv (311, 912 = 3) and roguetrader_alim_carpetclothes_inv (312, 912 = 4), 25 each. */
const CLOTHES = {
  menaphite: [6392, 6394, 6396, 6398, 6400, 6402, 6404, 6406], // hat, top, robe, kilt, then the red ones
  desert: [6382, 6384, 6386, 6388, 6390], // fez, top, legs, top (overcoat), robes
};
const variants = new WeakMap();
const clothesVariants = new WeakMap();

/** The clothes shop for the outfit Siamun last supplied; it starts over when the outfit changes. */
function openClothes(player, variant) {
  const { ShopManager } = core();
  const id = idFor(player, "clothes");
  if (clothesVariants.get(player) !== variant) ShopManager.removeShop(id);
  clothesVariants.set(player, variant);
  const shop = ensure(player, "clothes", NAMES.retail, () => CLOTHES[variant].map((item) => ({ id: item, amount: 25, restockTicks: 50, price: null })));
  ShopManager.open(player, shop);
}

/** The blackjack shop for the route the player last took (911 = 4 defensive, 3 offensive); it starts over when the route changes. */
function openBlackjacks(player, variant) {
  const { ShopManager } = core();
  const id = idFor(player, "blackjack");
  if (variants.get(player) !== variant) ShopManager.removeShop(id);
  variants.set(player, variant);
  const shop = ensure(player, "blackjack", NAMES.retail, () => BLACKJACKS[variant].map((item) => ({ id: item, amount: 25, restockTicks: 50, price: null })));
  ShopManager.open(player, shop);
}

/** Wiki (the rune tables, buymultiplier=500; blood and soul "sell for 200 and 150"): Ali pays half an item's value. */
const SELL_MULTIPLIER = 0.5;
const isRuneShop = (shopId) => shopId >= SHOP_BASE_ID && [KIND.dump, KIND.retail, KIND.wholesale].includes((shopId - SHOP_BASE_ID) % 8);
function sellPrice(itemId) {
  const row = [...ELEMENTAL, ...CATALYTIC].find(([id]) => id === itemId);
  const value = row ? row[3] : packValue(itemId);
  return value > 0 ? Math.floor(value * SELL_MULTIPLIER) : null;
}

function attach(pluginApi) {
  api = pluginApi;
  api.onPlayerLogout(({ player }) => {
    for (const kind of Object.keys(KIND)) api.core.ShopManager.removeShop(idFor(player, kind));
  });
  return { contents, offer, discount, openDump, openRetail, openWholesale, openBlackjacks, openClothes, addSurplus, isRuneShop, sellPrice };
}

module.exports = { attach, SMALL_RUNES, LARGE_RUNES, BLACKJACKS, CLOTHES };
