"use strict";

/**
 * The omnishop: Jagex's shared reward shop (omnishop_main 819 with omnishop_side 806). The cache
 * holds the shops (DB table 39, omnishop_shop_data), their stock (40) and currencies (41), and
 * the interface draws itself from them; the server opens it, keeps the selection varps and
 * the balances right, and does the buying and selling. docs/omnishop.md.
 *
 * Shops plug in through custom events (the shop owns its currencies and descriptions):
 * - "omnishop:open" { player, shop } opens a shop by its DB row name (`mixology_rewards`).
 * - "omnishop:currency" { player, shop, currency, balance, set }: a currency with no obj
 *   (omnishop_currency_obj) is a points balance the owner answers: it sets `balance` and a
 *   `set(value)` function. A currency with an obj is that item in the inventory.
 * - "omnishop:describe" { player, shop, stock, description }: the info panel's text, which the
 *   cache doesn't carry.
 * - "omnishop:can-buy" { player, shop, stock, itemId, cancel, unlock }: before each unit is
 *   paid for; `cancel` refuses it (the owner sends the message), `unlock` says it takes no
 *   inventory space.
 * - "omnishop:purchase" { player, shop, stock, itemId, handled }: once a unit is paid for;
 *   `handled` means the owner gave something else (an unlock), so no item is handed over.
 *
 * As live OSRS sends it (rsprox captures; Mixology Rewards in 1107, 4210, 4234, 4235; the
 * Boat Emporium in rev 241):
 * - Opening: varps omnishop_lastshop (3874) = the shop row and omnishop_selected_id (3869) =
 *   -1, toplevel_mainmodal_background [-1, -3], both modals, omnishop_main_init [shop, -1, -1],
 *   omnishop_side_init [shop], and events on the list (OP1-6, OP10), the side items (OP1-6,
 *   OP10, DEPTH1, DRAGTARGET) and the side info layer (OP1).
 * - The list is 12 components per entry. Op1 selects: varp 3869 = the entry. The client draws
 *   the info panel itself and asks for its text with a trigger on trigger_request_info
 *   [shop, entry]; the server answers omnishop_main_info_update [shop, -1, entry, description,
 *   1, 0, 1]. Ops 2-5 buy the shop's four amounts (ops "-1", "-5", "-10", "-50" unless the row
 *   sets omnishop_buy_q1-4, codes into enum 5844: 1, 5, 10, 50, 2, 3; Alliance Supplies buys
 *   1/2/3/5), at most the stock's omnishop_stock_max_purchase; op10 examines. Buttons 1-4 buy
 *   those amounts of the selected entry. (Until rev 238 the server sent
 *   omnishop_main_info_setup on op1 instead.)
 * - Each unit bought takes each currency (one varp change per currency) and redraws it
 *   (omnishop_main_currency_redraw [shop]). Refusals: "You don't have enough Lye resin.",
 *   "You cannot buy any more of that item." (a restricted item already owned) and "You don't
 *   have enough inventory space."
 * - Side panel: op1 selects an inventory item (varp 3870, omnishop_side_info_setup [slot, shop,
 *   1, 0, sellable ? 1 : -1, entry or -1, description]); ops 2-5 and its buttons sell 1/5/10/50
 *   for 40% of the cost (Alchemist labcoat: 2,250/2,800/3,700 -> +900/+1,120/+1,480), then
 *   omnishop_side_info_close. Close Info sets varp 3870 back to -1.
 */

const MAIN = 819;
const SIDE = 806;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const SIDE_MODAL_TYPE = 3;
const SHOP_ATTRIBUTE = "omnishop:shop";

const VARP = { SELECTED: "omnishop_selected_id", SIDE_SELECTED: "omnishop_selected_side_id", LAST_SHOP: "omnishop_lastshop" };
const SCRIPT = {
  MAINMODAL_BACKGROUND: 917,
  MAIN_INIT: 7140,
  SIDE_INIT: 7246,
  INFO_UPDATE: 9772,
  CURRENCY_REDRAW: 501,
  SIDE_INFO_SETUP: 7253,
  SIDE_INFO_CLOSE: 7256,
};
const COMPONENT = {
  LIST: "omnishop_main:list",
  REQUEST_INFO: "omnishop_main:trigger_request_info",
  BUY: ["omnishop_main:button_1", "omnishop_main:button_2", "omnishop_main:button_3", "omnishop_main:button_4"],
  SIDE_ITEMS: "omnishop_side:items",
  SIDE_INFO: "omnishop_side:info_layer",
  SIDE_CLOSE: "omnishop_side:info_close",
  SELL: ["omnishop_side:button_1", "omnishop_side:button_2", "omnishop_side:button_3", "omnishop_side:button_4"],
};
const TABLE = { SHOP: "omnishop_shop_data", STOCK: "omnishop_stock_data", CURRENCY: "omnishop_currency_data" };
const LIST_PER_ENTRY = 12;
const INVENTORY_SIZE = 28;
const QUANTITIES = [1, 5, 10, 50];
/** omnishop_buy_q1-4 hold codes into this enum (client script 10163). */
const QUANTITY_ENUM = 5844;
/** List and side ops 2-5 are the four quantities; op10 is Examine. */
const FIRST_QUANTITY_OP = 2;
const EXAMINE_OP = 10;
const SELL_RATE = 0.4;
const EVENT = {
  OP1_TO_OP6: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6),
  OP10: 1 << 10,
  DEPTH1: 1 << 17,
  DRAG_TARGET: 1 << 20,
};
const MESSAGE = {
  /** Captured with resins, whose singular and plural names are the same; plural for the rest. */
  TOO_POOR: (currency) => `You don't have enough ${currency}.`,
  RESTRICTED: "You cannot buy any more of that item.",
  NO_SPACE: "You don't have enough inventory space.",
  /** Not captured. */
  NOT_SELLABLE: "You can't sell that item to this shop.",
  /** Not captured. */
  ULTIMATE: "Ultimate Ironmen can't buy that.",
};

let core = null;
let pluginApi = null;
const shops = new Map();

function cache() {
  return core.CacheDefinitions;
}

function column(table, name) {
  return cache().getDbColumn(cache().getDbTableId(table), name);
}

function values(row, table, name) {
  const id = column(table, name);
  return id === null ? [] : row.column(id);
}

function int(row, table, name, fallback = 0) {
  const id = column(table, name);
  return id === null ? fallback : row.int(id, fallback);
}

/** The row's four buy amounts, or 1/5/10/50 where it sets none. */
function buyQuantities(row) {
  const amounts = cache().getEnumValues(QUANTITY_ENUM);
  return QUANTITIES.map((fallback, index) => {
    const code = int(row, TABLE.SHOP, `omnishop_buy_q${index + 1}`, -1);
    const amount = code > 0 ? Number(amounts.get(code)) : NaN;
    return amount > 0 ? amount : fallback;
  });
}

/** A shop row read once: its stock and currencies. */
function shopOf(rowId) {
  if (shops.has(rowId)) return shops.get(rowId);
  const row = cache().getDbRow(rowId);
  if (!row) return null;
  const stock = values(row, TABLE.SHOP, "omnishop_shop_stock").map((stockId, index) => {
    const stockRow = cache().getDbRow(Number(stockId));
    const cost = values(stockRow, TABLE.STOCK, "omnishop_stock_cost");
    const costs = [];
    for (let i = 0; i + 1 < cost.length; i += 2) costs.push({ currency: Number(cost[i]), amount: Number(cost[i + 1]) });
    return {
      index,
      row: Number(stockId),
      itemId: int(stockRow, TABLE.STOCK, "omnishop_stock_obj", -1),
      costs,
      restricted: int(stockRow, TABLE.STOCK, "omnishop_stock_restricted") === 1
        || int(stockRow, TABLE.STOCK, "omnishop_stock_restricted_category") > 0,
      restrictedUim: int(stockRow, TABLE.STOCK, "omnishop_stock_restricted_uim") === 1,
      single: int(stockRow, TABLE.STOCK, "omnishop_stock_transaction_multiplier", 1) === 0,
      maxPurchase: int(stockRow, TABLE.STOCK, "omnishop_stock_max_purchase", 0),
      sellable: int(stockRow, TABLE.STOCK, "omnishop_stock_sellable") === 1,
      noted: int(stockRow, TABLE.STOCK, "omnishop_stock_sold_noted") === 1,
    };
  });
  const shop = { row: rowId, name: cache().getDbRowName(rowId), stock, quantities: buyQuantities(row) };
  shops.set(rowId, shop);
  return shop;
}

function currencyName(currency) {
  const row = cache().getDbRow(currency);
  return row ? String(values(row, TABLE.CURRENCY, "omnishop_currency_name_plural")[0] ?? "") : "";
}

function currencyObj(currency) {
  const row = cache().getDbRow(currency);
  return row ? int(row, TABLE.CURRENCY, "omnishop_currency_obj", -1) : -1;
}

/** The player's balance of a currency, with a setter. */
function wallet(player, shop, currency) {
  const obj = currencyObj(currency);
  if (obj > 0) {
    const inventory = player.getInventory();
    return {
      balance: inventory.getAmount(obj),
      set: (value) => {
        const delta = value - inventory.getAmount(obj);
        if (delta < 0) inventory.delete(obj, -delta);
        else if (delta > 0) inventory.adds(obj, delta);
        inventory.refreshItems();
      },
    };
  }
  const request = { player, shop: shop.name, currency, balance: null, set: null };
  pluginApi.emitCustomEvent("omnishop:currency", request);
  return typeof request.set === "function" ? { balance: Number(request.balance) || 0, set: request.set } : null;
}

function description(player, shop, entry) {
  const request = { player, shop: shop.name, stock: cache().getDbRowName(entry.row), description: "" };
  pluginApi.emitCustomEvent("omnishop:describe", request);
  return String(request.description ?? "");
}

function varp(name) {
  return cache().getVarpId(name);
}

function component(name) {
  return cache().getComponentId(name);
}

function openShop(player, name) {
  const rowId = typeof name === "number" ? name : cache().getDbRowId(name);
  const shop = rowId === null ? null : shopOf(rowId);
  if (!shop) return false;
  const sender = player.getPacketSender();
  player.setAttribute(SHOP_ATTRIBUTE, shop.row);
  sender.sendConfig(varp(VARP.LAST_SHOP), shop.row);
  sender.sendConfig(varp(VARP.SELECTED), -1);
  sender.sendConfig(varp(VARP.SIDE_SELECTED), -1);
  sender.sendInterfaceScript(SCRIPT.MAINMODAL_BACKGROUND, [-1, -3]);
  player.setInterfaceId(MAIN);
  sender.sendSubInterface(MAIN_MODAL, MAIN, 0);
  sender.sendSubInterface(SIDE_MODAL, SIDE, SIDE_MODAL_TYPE);
  sender.sendInterfaceScript(SCRIPT.MAIN_INIT, [shop.row, -1, -1]);
  sender.sendInterfaceScript(SCRIPT.SIDE_INIT, [shop.row]);
  sender.sendInterfaceFlagsRange(component(COMPONENT.LIST), 0, shop.stock.length * LIST_PER_ENTRY, EVENT.OP1_TO_OP6 | EVENT.OP10);
  sender.sendInterfaceFlagsRange(component(COMPONENT.SIDE_ITEMS), 0, INVENTORY_SIZE,
    EVENT.OP1_TO_OP6 | EVENT.OP10 | EVENT.DEPTH1 | EVENT.DRAG_TARGET);
  sender.sendInterfaceFlagsRange(component(COMPONENT.SIDE_INFO), 0, 0, 1 << 1);
  return true;
}

function open(request) {
  if (request.handled || !request.player) return;
  request.handled = openShop(request.player, request.shop);
}

function openShopFor(player) {
  const rowId = player.getAttribute(SHOP_ATTRIBUTE);
  if (player.getInterfaceId() !== MAIN || !Number.isInteger(rowId)) return null;
  return shopOf(rowId);
}

function isUltimate(player) {
  const query = { player, mode: "none" };
  pluginApi.emitCustomEvent("ironman:mode", query);
  return query.mode === "ultimate";
}

function owns(player, itemId) {
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId)
    || player.getBanks().some((bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX && bank?.contains?.(itemId));
}

function redraw(player, shop) {
  for (let i = 0; i < 3; i++) player.getPacketSender().sendInterfaceScript(SCRIPT.CURRENCY_REDRAW, [shop.row]);
}

/** One unit: the checks, the payment and the item. False stops the rest of the order. */
function buyOne(player, shop, entry) {
  if (entry.restrictedUim && isUltimate(player)) {
    player.sendMessage(MESSAGE.ULTIMATE);
    return false;
  }
  if (entry.restricted && owns(player, entry.itemId)) {
    player.sendMessage(MESSAGE.RESTRICTED);
    return false;
  }
  const stock = cache().getDbRowName(entry.row);
  const check = { player, shop: shop.name, stock, itemId: entry.itemId, cancel: false, unlock: false };
  pluginApi.emitCustomEvent("omnishop:can-buy", check);
  if (check.cancel) return false;
  const wallets = entry.costs.map((cost) => ({ cost, wallet: wallet(player, shop, cost.currency) }));
  const short = wallets.find(({ cost, wallet: held }) => !held || held.balance < cost.amount);
  if (short) {
    player.sendMessage(MESSAGE.TOO_POOR(currencyName(short.cost.currency)));
    return false;
  }
  const { ItemDefinition } = core;
  const itemId = entry.noted ? (ItemDefinition.forId(entry.itemId)?.getNoteId?.() ?? entry.itemId) : entry.itemId;
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(itemId)?.isStackable?.() === true;
  if (check.unlock !== true && inventory.getFreeSlots() < 1 && !(stackable && inventory.contains(itemId))) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return false;
  }
  for (const { cost, wallet: held } of wallets) held.set(held.balance - cost.amount);
  const request = { player, shop: shop.name, stock, itemId: entry.itemId, handled: false };
  pluginApi.emitCustomEvent("omnishop:purchase", request);
  if (!request.handled) {
    inventory.adds(itemId, 1);
    inventory.refreshItems();
    pluginApi.emitCustomEvent("collection-log:obtain", { player, itemId: entry.itemId, amount: 1 });
  }
  // A purchase handler may have closed the shop (a boat is delivered with a message box).
  if (openShopFor(player)) redraw(player, shop);
  return true;
}

function buy(player, shop, entry, quantity) {
  const units = entry.single ? 1 : entry.maxPurchase > 0 ? Math.min(quantity, entry.maxPurchase) : quantity;
  for (let unit = 0; unit < units; unit++) if (!buyOne(player, shop, entry)) break;
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "omnishop" });
}

function select(player, entry) {
  player.getPacketSender().sendConfig(varp(VARP.SELECTED), entry.index);
}

/** if_triggeroplocal arguments: ints as zigzag varints. */
function triggerInts(argsData) {
  const ints = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) !== 0) continue;
    ints.push((value >>> 1) ^ -(value & 1));
    value = 0;
    shift = 0;
  }
  return ints;
}

/** The client's request for an entry's info text: [shop, entry]. */
function requestInfo(event) {
  if (!event.scriptTrigger) return;
  const shop = openShopFor(event.player);
  const [row, index] = triggerInts(event.argsData);
  const entry = shop?.row === row ? shop.stock[index] : undefined;
  if (!entry) return;
  event.handled = true;
  event.player.getPacketSender().sendInterfaceScript(SCRIPT.INFO_UPDATE, [
    shop.row, -1, entry.index, description(event.player, shop, entry), 1, 0, 1,
  ]);
}

function examine(player, itemId) {
  const text = core.ItemDefinition.forId(itemId)?.getExamine?.();
  if (text) player.sendMessage(text);
}

function clickList({ player, slot, action }) {
  const shop = openShopFor(player);
  if (!shop) return;
  const entry = shop.stock[Math.floor(Number(slot) / LIST_PER_ENTRY)];
  if (!entry) return;
  const op = Number(action);
  if (op === 1) select(player, entry);
  else if (op === EXAMINE_OP) examine(player, entry.itemId);
  else if (shop.quantities[op - FIRST_QUANTITY_OP]) buy(player, shop, entry, shop.quantities[op - FIRST_QUANTITY_OP]);
}

function clickBuy(event) {
  const shop = openShopFor(event.player);
  if (!shop) return;
  const index = COMPONENT.BUY.map(component).indexOf(event.buttonId);
  const entry = shop.stock[event.player.getPacketSender().getVarp(varp(VARP.SELECTED))];
  if (index >= 0 && entry) buy(event.player, shop, entry, shop.quantities[index]);
}

function stockFor(shop, itemId) {
  return shop.stock.find((entry) => entry.itemId === itemId) ?? null;
}

function sell(player, shop, slot, quantity) {
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  const entry = item ? stockFor(shop, item.getId()) : null;
  if (!entry?.sellable) {
    player.sendMessage(MESSAGE.NOT_SELLABLE);
    return;
  }
  for (let unit = 0; unit < quantity && inventory.getItems()[slot]?.getId?.() === entry.itemId; unit++) {
    inventory.deleteAtSlot(slot, 1);
    for (const cost of entry.costs) {
      const held = wallet(player, shop, cost.currency);
      held?.set(held.balance + Math.floor(cost.amount * SELL_RATE));
    }
    redraw(player, shop);
  }
  inventory.refreshItems();
  player.getPacketSender().sendInterfaceScript(SCRIPT.SIDE_INFO_CLOSE, []);
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "omnishop" });
}

function selectSide(player, shop, slot) {
  const item = player.getInventory().getItems()[slot];
  if (!item || item.getId() <= 0) return;
  const entry = stockFor(shop, item.getId());
  const sender = player.getPacketSender();
  sender.sendConfig(varp(VARP.SIDE_SELECTED), slot);
  sender.sendInterfaceScript(SCRIPT.SIDE_INFO_SETUP, [
    slot, shop.row, 1, 0, entry?.sellable ? 1 : -1, entry ? entry.index : -1,
    entry ? description(player, shop, entry) : core.ItemDefinition.forId(item.getId())?.getExamine?.() ?? "",
  ]);
}

function clickSide({ player, slot, action }) {
  const shop = openShopFor(player);
  if (!shop) return;
  const op = Number(action);
  const item = player.getInventory().getItems()[Number(slot)];
  if (op === 1) selectSide(player, shop, Number(slot));
  else if (op === EXAMINE_OP && item) examine(player, item.getId());
  else if (QUANTITIES[op - FIRST_QUANTITY_OP]) sell(player, shop, Number(slot), QUANTITIES[op - FIRST_QUANTITY_OP]);
}

function clickSell(event) {
  const shop = openShopFor(event.player);
  if (!shop) return;
  const index = COMPONENT.SELL.map(component).indexOf(event.buttonId);
  const slot = event.player.getPacketSender().getVarp(varp(VARP.SIDE_SELECTED));
  if (index < 0 || slot < 0) return;
  sell(event.player, shop, slot, QUANTITIES[index]);
  event.player.getPacketSender().sendConfig(varp(VARP.SIDE_SELECTED), -1);
}

function closeInfo({ player }) {
  player.getPacketSender().sendConfig(varp(VARP.SIDE_SELECTED), -1);
}

function attach(api) {
  core = api.core;
  pluginApi = api;
}

module.exports = {
  name: "Omnishop",
  register(api) {
    attach(api);
    api.onCustomEvent("omnishop:open", open);
    // The components move between revisions, so they are looked up by gameval name.
    api.onInterfaceActionButton(component(COMPONENT.LIST), clickList);
    api.onInterfaceActionButton(component(COMPONENT.REQUEST_INFO), requestInfo);
    api.onInterfaceActionButton(COMPONENT.BUY.map(component), clickBuy);
    api.onInterfaceActionButton(component(COMPONENT.SIDE_ITEMS), clickSide);
    api.onInterfaceActionButton(COMPONENT.SELL.map(component), clickSell);
    api.onInterfaceActionButton(component(COMPONENT.SIDE_CLOSE), closeInfo);
  },
};
