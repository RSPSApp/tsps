const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Inventory } = require("../../src/main/typescript/elvarg/game/model/container/impl/Inventory");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Active cache: ge_offers (465), ge_offers_side (467), scripts 773/779/794.
const GE = 465;
const GE_HISTORY = 383;
const GE_HISTORY_RESET_SCRIPT = 1644;
const GE_HISTORY_ENTRY_SCRIPT = 1645;
const GE_HISTORY_REFRESH_SCRIPT = 1646;
const GE_COLLECT = 402;
const collectUid = (child) => (GE_COLLECT << 16) | child;
const SIDE = 467;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const uid = (child) => (GE << 16) | child;
const SIDE_ITEMS = SIDE << 16;
const SELECTED_SLOT = 4439;
const SELL = 4397;
const QUANTITY = 4396;
// Cache script 779 scales this rate by 1,000 (20 means 2%).
const TAX_RATE = 13139;
// The new offer's price: a long varp from rev 241 (it was varbit 4398).
const PRICE_LONG = 5753;
const SELECTED_ITEM = 1151;
// ge_offers:setup_desc, the examine text under the item name; the server sets it.
const SETUP_DESC = uid(27);
// ge_offers:details_desc, the same text on an existing offer's details screen.
const DETAILS_DESC = uid(16);
const SETUP_FEE_INFO = uid(29);
const DETAILS_FEE_INFO = uid(18);
const SET_DESCRIPTION_SCRIPT = 5730;
const FEE_POPUP = uid(32);
const POPUP_INTERFACE = 289;
const POPUP_TEXT_SCRIPT = 4212;
// Verbatim OSRS fee information from the screenshots in issue #2983.
const FEE_INFORMATION =
  "Convenience Fees|" +
  "The Grand Exchange charges a fee for selling most items. This is typically 2% of the amount paid for each item, or 5,000,000 coins, whichever is lower.<br><br>" +
  "For very cheap items, a 2% fee rounds down to zero, so you don't pay any fee on them.<br><br>" +
  "When you offer items for sale, the menu shows how much money you'll receive once the fee is paid, and how this was calculated. However, you may receive more money than expected, if the buyer is offering a higher price; when this happens, the fee is calculated off the amount they paid.<br><br>" +
  "A few items are completely exempt from fees, such as bonds or various basic tools - no fee is charged when they are sold.|" +
  "Close";
// Cache script 5733 reads pending client requests here, not accepted offers.
// Keep them separate from the stockmarket opcode data.
const OFFER_ITEMS = [3204, 3206, 3208, 3210, 3212, 3214, 3216, 3218];
const COLLECTIONS = [518, 519, 520, 521, 522, 523, 539, 540];
const MARKET_BASE = 7900;
const MARKET_STRIDE = 7;
const FINISHED = 5;
const OFFERS_ATTRIBUTE = "grand-exchange-offers";
const LIMITS_ATTRIBUTE = "grand-exchange-limits";
const HISTORY_ATTRIBUTE = "grand-exchange-history";
const HISTORY_LIMIT = 40;
// Wiki: Grand_Exchange_Clerk. The login reminder of what waits in the collection box, which a
// clerk turns on or off through Talk-to; it is not repeated within two minutes (world hops).
const REMINDERS_ATTRIBUTE = "grand-exchange:collection-reminders";
const REMINDED_AT_ATTRIBUTE = "grand-exchange:collection-reminded-at";
const REMINDER_COOLDOWN_MS = 2 * 60_000;
const CLERK = "Grand Exchange Clerk";
// The clerk's Talk-to transcript: its conditions on the reminder setting, the lines that set
// it, and the choice that opens the exchange.
const REMINDERS_CONDITION = /^If the player has Exchange collection reminders on login (on|off):$/;
const REMINDERS_ON_LINE = /^Okay, when you log in, we'll send you a message about any items/;
const REMINDERS_OFF_LINE = /^Okay, when you log in, you will no longer be reminded/;
const EXCHANGE_TARGET = "Grand Exchange";
// A bank NPC transcript's "I'd like to collect items." step.
const COLLECTION_TARGET = "Grand Exchange collection box";
const LIMIT_WINDOW_MS = 4 * 60 * 60 * 1000;
const OFFER_MIN_DELAY_MS = 5_000;
// Milliseconds; applies to newly placed offers.
const MAX_TRADE_DELAY_CONFIG = "GrandExchange:maxTradeDelay";
const OFFER_MAX_DELAY_MS = 60 * 60_000;
const OFFER_ILLIQUID_MIN_MS = 60_000;
const OFFER_ILLIQUID_MAX_MS = 5 * 60_000;
// At the guide price an offer has a tenth of the volume wait; crossing it by a
// few percent cuts that further, while resting further away waits progressively longer.
const OFFER_GUIDE_DELAY = 0.1;
const OFFER_PRICE_SENSITIVITY = 50;
const MAX = 0x7fffffff;
const PRESET_TEXT = "Preset items cannot be used for this.";
const COINS = ItemIdentifiers.COINS;
const PLATINUM_TOKEN = ItemIdentifiers.PLATINUM_TOKEN;
// OSRS Wiki Update:GE_Improvements:_Beyond_Max_Cash: payment mixes coins and platinum tokens,
// coins first, with change in coins. The inventory pays first (the client reads it with
// inv_total of 995/13204 in script 9915), then the bank (see bankPayment). Cache script 779
// rejects a total (varbit 4396 quantity x long varp 5753 price) above lconst 500:2147482647 = 2,149,631,130,647 ("Too much money!"),
// i.e. a full stack of coins plus a full stack of tokens. The price entry (script 108) is still
// an int prompt, so a unit price stays within MAX; only quantity x price can exceed it.
const COINS_PER_TOKEN = 1000;
const MAX_TRADE = MAX + MAX * COINS_PER_TOKEN;
// Wiki: Grand_Exchange#Convenience_fee_and_item_sink. The 2% fee is charged per item,
// rounded down (so anything under 50 coins is free), and capped at 5M per item.
const TAX_DIVISOR = 50;
const TAX_CAP = 5_000_000;
// Wiki: Grand_Exchange#Exempt_from_tax. These are item names, not ids, so every
// tradeable version of an item (a bond variant, a noted stack) is covered.
const TAX_EXEMPT_NAMES = new Set([
  "Old school bond",
  "Games necklace(8)",
  "Ring of dueling(8)",
  "Ardougne teleport",
  "Camelot teleport",
  "Civitas illa fortis teleport",
  "Falador teleport",
  "Kourend castle teleport",
  "Lumbridge teleport",
  "Teleport to house",
  "Varrock teleport",
  "Bass",
  "Bread",
  "Bronze arrow",
  "Bronze dart",
  "Cake",
  "Cooked chicken",
  "Cooked meat",
  "Herring",
  "Iron arrow",
  "Iron dart",
  "Lobster",
  "Mackerel",
  "Meat pie",
  "Mind rune",
  "Pike",
  "Salmon",
  "Shrimps",
  "Steel arrow",
  "Steel dart",
  "Tuna",
  "Chisel",
  "Gardening trowel",
  "Glassblowing pipe",
  "Hammer",
  "Needle",
  "Pestle and mortar",
  "Rake",
  "Saw",
  "Secateurs",
  "Seed dibber",
  "Shears",
  "Spade",
]);
// Dose and charge counts make these names vary, but the whole item is exempt.
const TAX_EXEMPT_PREFIXES = ["Energy potion", "Watering can"];
const MARKET_DATA_FILE = path.join(__dirname, "data", "grand-exchange.json");
const ValueWarning = require("./ValueWarning");
// All Settings 297/298: set to 1, the price warning is off.
const BUY_WARNING_DISABLED_VARBIT = 14700;
const SELL_WARNING_DISABLED_VARBIT = 14701;
const PRICE_WARNING_FACTOR = 10;
// OSRS: members get all 8 offer slots, free-to-play worlds the first 3.
const usableSlots = () => (pluginApi.core.WorldDefinition.isMembersWorld() ? 8 : 3);
const offers = new WeakMap();
const completionTimers = new WeakMap();
const viewing = new WeakMap();
const searching = new WeakSet();
const historyOpen = new WeakSet();
let pluginApi;
let marketData;

function loadMarketData() {
  if (marketData) return marketData;
  const { data } = JSON.parse(fs.readFileSync(MARKET_DATA_FILE, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid grand-exchange.json: expected a data object");
  }
  return (marketData = data);
}

function marketQuote(itemId) {
  const base = ItemDefinition.forId(itemId).unNote();
  return loadMarketData()[base] ?? {};
}

function validItem(id) {
  if (!CacheDefinitions.hasItem(id)) return false;
  const name = CacheDefinitions.getItem(id)?.name;
  return Boolean(name && name !== "null");
}

/** What the GE trades: tradeable items (a note sells as its item). */
function exchangeable(id) {
  if (!validItem(id)) return false;
  const definition = ItemDefinition.forId(id);
  return ItemDefinition.forId(definition.unNote()).isTradeable();
}

function price(id) {
  // OSRS market quote from item-prices.json; store value for unquoted/custom items.
  const base = ItemDefinition.forId(id).unNote();
  return Math.max(1, Math.min(MAX, Math.floor(ItemDefinition.forId(base).getGrandExchangeValue()) || 1));
}

/** The price a sell offer receives: the live low, or the buy price where there is no split. */
function sellPrice(id) {
  const base = ItemDefinition.forId(id).unNote();
  const definition = ItemDefinition.forId(base);
  const value = definition.getGrandExchangeSellValue?.() ?? definition.getGrandExchangeValue();
  return Math.max(1, Math.min(MAX, Math.floor(value) || 1));
}

function guidePrice(offer) {
  if (!(offer?.itemId > 0)) return 1;
  return offer.sell ? sellPrice(offer.itemId) : price(offer.itemId);
}

/** The price stored on the offer, or the guide for offers saved before prices were adjustable. */
function offerPrice(offer) {
  return Number.isInteger(offer?.price) && offer.price > 0 ? Math.min(MAX, offer.price) : guidePrice(offer);
}

/**
 * The unit price an offer trades at (Wiki: Grand Exchange): a buy pays the market price when its bid is higher and
 * gets the difference back, and a sell receives the market price when that is higher than its ask.
 */
function fillUnitPrice(offer) {
  const own = offerPrice(offer);
  const market = guidePrice(offer);
  return offer.sell ? Math.max(own, market) : Math.min(own, market);
}

/** The coins a finished trade moved; saves from before fill prices have only the offer's own total. */
function tradedTotal(offer) {
  return Number.isSafeInteger(offer?.traded) ? offer.traded : Number(offer?.total) || 0;
}

/** Coins as stacks: a full stack and over is paid as platinum tokens plus the remaining coins. */
function coinStacks(total) {
  if (total <= 0) return [];
  if (total <= MAX) return [{ itemId: COINS, amount: total }];
  const tokens = Math.min(MAX, Math.floor(total / COINS_PER_TOKEN));
  return [{ itemId: PLATINUM_TOKEN, amount: tokens }, { itemId: COINS, amount: total - tokens * COINS_PER_TOKEN }];
}

/** Scripts 773/779 price controls: -1, +1, -5%, guide, +5% (custom entry is handled separately). */
function changePrice(offer, slot) {
  const current = offerPrice(offer);
  if (slot === 8) return Math.max(1, current - 1);
  if (slot === 9) return Math.min(MAX, current + 1);
  if (slot === 10) return Math.max(1, Math.floor(current * 0.95));
  if (slot === 11) return guidePrice(offer);
  if (slot === 13) return Math.min(MAX, Math.ceil(current * 1.05));
  return current;
}

/** A null delay leaves the offer open until the player aborts it. */
function fillDelayMs(offer, random = Math.random) {
  // shortcut: approximate liquidity from guide-price distance, replace with an order book if queue order matters.
  const guide = guidePrice(offer);
  const unitPrice = offerPrice(offer);
  const distance = (unitPrice - guide) / guide;
  const aggressiveness = offer.sell ? -distance : distance;
  const fillChance = offer.sell ? guide / unitPrice : unitPrice / guide;
  if (aggressiveness < 0 && random() >= fillChance) return null;

  const volume = Number(marketQuote(offer.itemId).volume);
  const quantity = Math.max(1, Number(offer.quantity) || 1);
  const delay = Number.isFinite(volume) && volume > 0
    ? quantity / (volume / 1440) * 60_000 * (0.75 + 0.75 * random()) * OFFER_GUIDE_DELAY
    : OFFER_ILLIQUID_MIN_MS + random() * (OFFER_ILLIQUID_MAX_MS - OFFER_ILLIQUID_MIN_MS);
  const configuredMaxDelay = Number(pluginApi?.getPluginConfig(MAX_TRADE_DELAY_CONFIG, OFFER_MAX_DELAY_MS));
  const maxDelay = Number.isFinite(configuredMaxDelay) && configuredMaxDelay >= OFFER_MIN_DELAY_MS && configuredMaxDelay <= MAX
    ? configuredMaxDelay : OFFER_MAX_DELAY_MS;
  const volumeDelay = Math.max(OFFER_MIN_DELAY_MS, Math.min(maxDelay, delay));
  const priceFactor = Math.exp(-OFFER_PRICE_SENSITIVITY * aggressiveness);
  return Math.max(OFFER_MIN_DELAY_MS, Math.min(maxDelay, volumeDelay * priceFactor));
}

function limitKey(itemId) {
  return ItemDefinition.forId(itemId).unNote();
}

function limitEntry(player, itemId, now) {
  const entry = player.getAttribute(LIMITS_ATTRIBUTE)?.[limitKey(itemId)];
  return entry && now - entry.start < LIMIT_WINDOW_MS ? entry : undefined;
}

function itemLimit(itemId) {
  const limit = Number(marketQuote(itemId).limit);
  return Number.isFinite(limit) && limit > 0 ? limit : Infinity;
}

function remainingLimit(player, itemId, now = Date.now()) {
  const limit = itemLimit(itemId);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - (limitEntry(player, itemId, now)?.amount ?? 0));
}

function recordLimit(player, itemId, amount, now = Date.now()) {
  let limits = player.getAttribute(LIMITS_ATTRIBUTE);
  if (!limits) player.setAttribute(LIMITS_ATTRIBUTE, limits = {});
  const key = limitKey(itemId);
  const entry = limits[key];
  if (entry && now - entry.start < LIMIT_WINDOW_MS) entry.amount += amount;
  else limits[key] = { start: now, amount };
}

/** An aborted buy bought nothing (offers fill whole), so its quantity no longer counts against the limit (Wiki). */
function releaseLimit(player, offer, now = Date.now()) {
  const entry = limitEntry(player, offer.itemId, now);
  // Only the window the offer was counted in; a later window never held it. Older saves have no placedAt.
  if (!entry || !(Number(offer.placedAt) >= entry.start)) return;
  entry.amount = Math.max(0, entry.amount - offer.quantity);
}

let quotedPrices;

/**
 * /api/item-prices: the guide price of every quoted item, as the GE charges it. The rev 241
 * client reads guide prices with stockmarket_value from a table it loads itself; items not
 * listed fall back to their store value there, as price() does here.
 */
function itemPricesResource() {
  if (quotedPrices) return quotedPrices;
  quotedPrices = {};
  const count = CacheDefinitions.getCounts().items;
  for (let id = 0; id < count; id++) {
    const definition = ItemDefinition.forId(id);
    if (definition.isNoted() || !(definition.grandExchangeValue > 0)) continue;
    quotedPrices[id] = price(id);
  }
  return quotedPrices;
}

function active(player, offer) {
  return player.getInterfaceId() === GE && offers.get(player) === offer;
}

function completedOffers(player) {
  let slots = player.getAttribute(OFFERS_ATTRIBUTE);
  if (!slots) player.setAttribute(OFFERS_ATTRIBUTE, slots = {});
  return slots;
}

function tradeHistory(player) {
  let history = player.getAttribute(HISTORY_ATTRIBUTE);
  if (!Array.isArray(history)) player.setAttribute(HISTORY_ATTRIBUTE, history = []);
  return history;
}

function saveOffers(player) {
  GameConstants.PLAYER_PERSISTENCE.save(player, "grand-exchange");
}

function recordHistory(player, offer) {
  if (!offer || offer.historyRecorded || !offer.finished || offer.aborted) return false;
  const itemId = Number(offer.itemId);
  const quantity = Number(offer.quantity);
  const total = tradedTotal(offer);
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(quantity) || quantity <= 0 ||
      !Number.isSafeInteger(total) || total < 0) return false;

  const completedAt = Number(offer.completedAt) || Number(offer.completesAt) || Date.now();
  const history = tradeHistory(player);
  history.unshift({ itemId, sell: Boolean(offer.sell), quantity, total, tax: tax(offer), completedAt });
  history.length = Math.min(history.length, HISTORY_LIMIT);
  offer.historyRecorded = true;
  return true;
}

function scheduleCompletion(player, offer) {
  if (offer.finished || offer.completesAt === null) {
    if (recordHistory(player, offer)) saveOffers(player);
    return;
  }
  let timers = completionTimers.get(player);
  if (!timers) completionTimers.set(player, timers = new Set());
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (completedOffers(player)[offer.slot] !== offer) return;
    // A second timer for the same offer (e.g. rescheduled on login) must not
    // re-save and re-announce an already-completed offer.
    if (offer.finished) return;
    offer.finished = true;
    offer.completedAt = Date.now();
    offer.traded = Math.min(offer.sell ? MAX_TRADE : offer.total, offer.quantity * fillUnitPrice(offer));
    recordHistory(player, offer);
    saveOffers(player);
    refreshCollectionBox(player);
    const sender = player.getPacketSender();
    sender.sendInterfaceScript(786, [], marketVarps(offer.slot, offer), undefined,
      { [COLLECTIONS[offer.slot]]: collection(offer) });
    if (player.getInterfaceId() === GE && viewing.get(player) === offer.slot && !offers.has(player)) {
      sender.sendVarbit(SELECTED_SLOT, 0).sendVarbit(SELECTED_SLOT, offer.slot + 1);
    }
    sender.sendMessage(`${offer.sell ? "Sold" : "Bought"} ${offer.quantity.toLocaleString("en-US")} x ${ItemDefinition.forId(offer.itemId).getName()}. Click Collect.`);
  }, Math.max(0, offer.completesAt - Date.now()));
  timers.add(timer);
}

function restoreCompletedOffers({ player }) {
  let historyUpdated = false;
  for (const offer of Object.values(completedOffers(player))) {
    if (offer.finished) historyUpdated = recordHistory(player, offer) || historyUpdated;
    else scheduleCompletion(player, offer);
  }
  if (historyUpdated) saveOffers(player);
}

/** "Grand Exchange collection: <col=ef1020>1,609,993 coins</col>": what the collection box holds. */
function collectionReminder(player) {
  let coins = 0;
  const items = new Map();
  for (const offer of Object.values(completedOffers(player))) {
    for (const { itemId, quantity } of collection(offer).slots) {
      if (!(quantity > 0)) continue;
      if (itemId === COINS) coins += quantity;
      else items.set(itemId, (items.get(itemId) ?? 0) + quantity);
    }
  }
  const parts = coins > 0 ? [`${coins.toLocaleString("en-US")} coins`] : [];
  // Ours: items are listed after the coins as "quantity x name".
  for (const [itemId, amount] of items) {
    parts.push(`${amount.toLocaleString("en-US")} x ${ItemDefinition.forId(itemId).getName()}`);
  }
  return parts.length ? `Grand Exchange collection: <col=ef1020>${parts.join(", ")}</col>` : null;
}

function remindersOn(player) {
  return player.getAttribute(REMINDERS_ATTRIBUTE) !== false;
}

function remindCollection({ player }, now = Date.now()) {
  if (player.isPlayerBot?.() === true || !remindersOn(player)) return;
  const last = Number(player.getAttribute(REMINDED_AT_ATTRIBUTE));
  if (Number.isFinite(last) && now >= last && now - last < REMINDER_COOLDOWN_MS) return;
  const text = collectionReminder(player);
  if (!text) return;
  player.setAttribute(REMINDED_AT_ATTRIBUTE, now);
  player.sendMessage(text);
}

/** The reminder covers what was already waiting; an offer that completes after login announces itself. */
function login(event) {
  restoreCompletedOffers(event);
  remindCollection(event);
}

/** Talk-to's reminder options: each is offered only while the setting is the other way. */
function clerkCondition({ player, definition, text }) {
  if (definition?.getName?.() !== CLERK) return null;
  const match = REMINDERS_CONDITION.exec(text ?? "");
  return match ? remindersOn(player) === (match[1] === "on") : null;
}

/** The clerk's confirmation line sets the reminder. */
function clerkLine({ player, definition, step }) {
  if (definition?.getName?.() !== CLERK || typeof step?.npc !== "string") return;
  if (REMINDERS_ON_LINE.test(step.npc)) player.setAttribute(REMINDERS_ATTRIBUTE, true);
  else if (REMINDERS_OFF_LINE.test(step.npc)) player.setAttribute(REMINDERS_ATTRIBUTE, false);
}

/** "I'd like to set up trade offers please.": the chat closes and the exchange opens. */
function clerkAction(action) {
  if (action.action !== "open_interface" || action.target !== EXCHANGE_TARGET) return;
  action.handled = true;
  // No current dialogue tells transcript playback to stop here.
  action.player.getDialogueManager().reset();
  action.player.getPacketSender().sendInterfaceRemoval();
  openGrandExchange({ player: action.player });
}

/** A bank NPC's "I'd like to collect items.": the chat closes and the collection box opens. */
function collectAction(action) {
  if (action.action !== "open_interface" || action.target !== COLLECTION_TARGET) return;
  action.handled = true;
  action.player.getDialogueManager().reset();
  action.player.getPacketSender().sendInterfaceRemoval();
  openCollectionBox({ player: action.player });
}

/**
 * Collect on anything that also banks (Wiki: Bank, "Collection"): every banker, booth, bank chest,
 * counter or bank animal, whatever its name. Other Collect options (Death, a coral) fall through.
 */
function offersBanking(actions, name) {
  return Array.isArray(actions) && actions.includes("Collect")
    && (actions.includes("Bank") || /\bbank\b/i.test(String(name ?? "")));
}

function collectFromNpc(event) {
  if (!offersBanking(event.definition?.getActions?.(), event.definition?.getName?.())) return false;
  return openCollectionBox(event);
}

function collectFromObject(event) {
  const options = event.definition?.getInteractions?.();
  if (event.handled || options?.[event.clickType - 1] !== "Collect") return;
  if (!offersBanking(options, event.definition?.getName?.())) return;
  event.handled = true;
  openCollectionBox(event);
}

function marketVarps(slot, offer) {
  const base = MARKET_BASE + slot * MARKET_STRIDE;
  return {
    [OFFER_ITEMS[slot]]: -1,
    [base + 6]: offer?.itemId ?? -1,
    [base]: offer ? offerPrice(offer) : 0,
    [base + 1]: offer?.quantity ?? 0,
    // An aborted offer traded nothing (the client draws its bar red).
    [base + 2]: offer?.finished && !offer.aborted ? offer.quantity : 0,
    [base + 3]: offer?.finished && !offer.aborted ? Math.min(MAX, tradedTotal(offer)) : 0,
    [base + 4]: offer?.sell ? 1 : 0,
    [base + 5]: offer ? (offer.finished ? FINISHED : 2) : 0,
    [OFFER_ITEMS[slot] + 1]: 0,
  };
}

function allMarketVarps(player) {
  const varps = {};
  const slots = completedOffers(player);
  for (let slot = 0; slot < 8; slot++) Object.assign(varps, marketVarps(slot, slots[slot]));
  return varps;
}

function taxExempt(itemId) {
  if (!(itemId > 0)) return false;
  const name = ItemDefinition.forId(ItemDefinition.forId(itemId).unNote()).getName();
  return TAX_EXEMPT_NAMES.has(name) || TAX_EXEMPT_PREFIXES.some((prefix) => name?.startsWith(prefix));
}

/**
 * The convenience fee on a sell offer: 2% of the sale price per item, rounded down and capped
 * at 5M per item. Exempt items, buy offers and aborted offers pay nothing.
 */
function tax(offer) {
  if (!offer?.sell || offer.aborted || taxExempt(offer.itemId)) return 0;
  const quantity = Math.max(0, Number(offer.quantity) || 0);
  if (!quantity) return 0;
  // The fee is on the price the item sold for (FEE_INFORMATION). Saved offers from before fill prices, or
  // before adjustable prices, use their own price, or the unit price they sold at, not today's guide.
  const unitPrice = Number.isSafeInteger(offer.traded)
    ? Math.min(MAX, Math.floor(offer.traded / quantity))
    : Number.isInteger(offer.price) && offer.price > 0
      ? Math.min(MAX, offer.price)
      : Math.floor((Number(offer.total) || 0) / quantity);
  const perItem = Math.min(TAX_CAP, Math.floor(unitPrice / TAX_DIVISOR));
  return perItem * quantity;
}

/**
 * What a finished offer hands over, as item stacks: the trade's result, or for an aborted offer
 * what was put in. A sale pays its total less the Grand Exchange tax. Coin totals over a full
 * stack are paid as platinum tokens plus the remaining coins.
 */
function payout(offer) {
  if (offer.aborted) return offer.sell ? [{ itemId: offer.itemId, amount: offer.quantity }] : coinStacks(offer.total);
  // A bought item comes with the coins bid over the price it traded at.
  if (!offer.sell) return [{ itemId: offer.itemId, amount: offer.quantity }, ...coinStacks(offer.total - tradedTotal(offer))];
  const paid = coinStacks(Math.max(0, tradedTotal(offer) - tax(offer)));
  return paid.length ? paid : [{ itemId: COINS, amount: 0 }];
}

/** Parts of a finished offer already taken one at a time from its two collection slots (saved with the offer). */
function collectedParts(offer) {
  return Array.isArray(offer?.collected) ? offer.collected : [];
}

function collection(offer) {
  const taken = collectedParts(offer);
  return {
    capacity: 2,
    slots: offer?.finished
      ? payout(offer).map(({ itemId, amount }, slot) => ({ slot, itemId, quantity: amount })).filter(({ slot }) => !taken.includes(slot))
      : [],
  };
}

function allCollections(player) {
  const inventories = {};
  const slots = completedOffers(player);
  for (let slot = 0; slot < 8; slot++) inventories[COLLECTIONS[slot]] = collection(slots[slot]);
  return inventories;
}

function refreshCollectionBox(player) {
  if (player.getInterfaceId() !== GE_COLLECT) return;
  player.getPacketSender().sendInterfaceScript(788,
    [collectUid(0), 1011, collectUid(3), collectUid(4), collectUid(13)],
    allMarketVarps(player), undefined, allCollections(player));
}

function refresh(player, offer) {
  player.getPacketSender()
    .sendConfig(SELECTED_ITEM, offer.itemId)
    .sendVarbit(TAX_RATE, taxExempt(offer.itemId) ? 0 : 1000 / TAX_DIVISOR)
    .sendVarbit(SELL, offer.sell ? 1 : 0)
    .sendVarbit(QUANTITY, offer.quantity)
    .sendVarpLong(PRICE_LONG, offer.itemId > 0 ? offerPrice(offer) : 1)
    .sendVarbit(SELECTED_SLOT, offer.slot + 1)
    .sendInterfaceScript(SET_DESCRIPTION_SCRIPT, [examine(offer.itemId), feeLabel(offer), SETUP_DESC, SETUP_FEE_INFO]);
}

function feeLabel(offer) {
  return offer.sell && offer.itemId > 0 ? `Convenience fee: ${taxExempt(offer.itemId) ? "None" : "2%"}` : "";
}

function examine(itemId) {
  return itemId > 0 ? ItemDefinition.forId(itemId).getExamine() ?? "" : "";
}

function home(player) {
  closeSearch(player);
  offers.delete(player);
  viewing.delete(player);
  player.getPacketSender()
    .abortInputPrompt()
    .sendConfig(SELECTED_ITEM, -1)
    .sendVarbit(SELL, 0)
    .sendVarbit(QUANTITY, 1)
    .sendVarpLong(PRICE_LONG, 1)
    .sendVarbit(SELECTED_SLOT, 0);
}

function showHistory(player) {
  const sender = player.getPacketSender();
  historyOpen.add(player);
  sender.sendClientScript(2524, -1, -1)
    .sendSubInterface(MAIN_MODAL, GE_HISTORY, 0)
    .sendClientScript(GE_HISTORY_RESET_SCRIPT);
  for (const [index, entry] of tradeHistory(player).slice(0, HISTORY_LIMIT).entries()) {
    // Script 1645 takes four ints followed by the gross total and tax as longs.
    const total = Number(entry.total);
    const fee = Number(entry.tax) || 0;
    sender.sendInterfaceScript(GE_HISTORY_ENTRY_SCRIPT, [index, entry.itemId, entry.sell ? 1 : 0,
      entry.quantity, BigInt(Number.isSafeInteger(total) && total >= 0 ? total : 0),
      BigInt(Number.isSafeInteger(fee) && fee >= 0 ? fee : 0)]);
  }
  sender.sendClientScript(GE_HISTORY_REFRESH_SCRIPT)
    .sendInterfaceFlagsRange((GE_HISTORY << 16) | 3, 0, 234, 1026);
}

/** The clerk's History option: the trade history on its own, without the offers screen. */
// Wiki: Bank_PIN guards trading at the exchange, not this list of past trades; its Exchange and
// Buy-offer buttons go through openGrandExchange, which asks for the PIN.
function openHistory({ player }) {
  if (refusedEntry(player)) return true;
  if ([GE, GE_HISTORY, GE_COLLECT].includes(player.getInterfaceId())) {
    player.getPacketSender().sendInterfaceRemoval();
    historyOpen.delete(player);
  }
  if (player.busy()) {
    player.sendMessage("Finish what you are doing before opening the Grand Exchange.");
    return true;
  }
  player.getMovementQueue().reset();
  player.getSkillManager().stopSkillable();
  home(player);
  player.setInterfaceId(GE_HISTORY);
  showHistory(player);
  return true;
}

function closeSearch(player) {
  if (!searching.delete(player)) return;
  player.setEnteredSyntaxAction(null);
  player.getPacketSender().sendClientScript(138);
}

function showCompleted(player, slot) {
  if (!Object.hasOwn(completedOffers(player), slot)) return;
  offers.delete(player);
  viewing.set(player, slot);
  player.getPacketSender()
    .abortInputPrompt()
    .sendVarbit(TAX_RATE, taxExempt(completedOffers(player)[slot].itemId) ? 0 : 1000 / TAX_DIVISOR)
    .sendConfig(SELECTED_ITEM, -1)
    .sendVarbit(SELECTED_SLOT, 0)
    .sendVarbit(SELECTED_SLOT, slot + 1)
    .sendInterfaceScript(SET_DESCRIPTION_SCRIPT, [examine(completedOffers(player)[slot].itemId),
      feeLabel(completedOffers(player)[slot]), DETAILS_DESC, DETAILS_FEE_INFO]);
}

function chooseItem(player, offer) {
  if (offer.sell) {
    player.sendMessage("Choose an item from your inventory to sell.");
    return;
  }
  player.setEnteredSyntaxAction({ execute: (input) => {
    if (!active(player, offer)) return;
    const id = Number(input);
    // The client search lists tradeable, unnoted items only; anything else is not a real pick.
    if (!exchangeable(id) || ItemDefinition.forId(id).isNoted()) return;
    closeSearch(player);
    offer.itemId = id;
    offer.quantity = 1;
    offer.price = price(id);
    refresh(player, offer);
  } });
  searching.add(player);
  // Script 750's first int reaches oc_find (via 752) as its tradable-only flag.
  player.getPacketSender().sendInterfaceScript(750, ["Grand Exchange Item Search", 1, -1, 0]);
}

function start(player, sell, slot = 0, itemId = -1) {
  if (slot >= usableSlots()) {
    player.sendMessage("You need to be on a members' world to use this slot.");
    return;
  }
  if (Object.hasOwn(completedOffers(player), slot)) {
    const free = Array.from({ length: usableSlots() }, (_, i) => i).find((i) => !Object.hasOwn(completedOffers(player), i));
    if (free == null) {
      player.sendMessage("Collect an offer before creating another one.");
      return;
    }
    slot = free;
  }
  const offer = {
    sell,
    slot,
    itemId,
    quantity: 1,
    price: itemId > 0 ? (sell ? sellPrice(itemId) : price(itemId)) : 1,
  };
  offers.set(player, offer);
  player.getPacketSender().abortInputPrompt();
  refresh(player, offer);
  if (itemId < 0) chooseItem(player, offer);
}

/** Platinum tokens a buy of `total` coins needs beyond the held coins (0 if coins cover it), or null if unaffordable. */
function tokensNeeded(inventory, total) {
  const shortfall = total - inventory.getAmount(COINS);
  if (shortfall <= 0) return 0;
  const tokens = Math.ceil(shortfall / COINS_PER_TOKEN);
  return tokens <= inventory.getAmount(PLATINUM_TOKEN) ? tokens : null;
}

/** Plain (not preset, untradeable or unbankable) stacks of `id`, as [slot, amount]. */
function plainStacks(container, id) {
  return container.getItems().flatMap((item, slot) =>
    item?.getId() === id && item.getAmount() > 0 && !restricted(item) ? [[slot, item.getAmount()]] : []);
}

const realBankTabs = (player) => Array.from({ length: Bank.TOTAL_BANK_TABS }, (_, tab) => tab)
  .filter((tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX);

/**
 * Wiki: Grand_Exchange (Changes, 14 June 2023): "Buy offers can now use the coins from the player's
 * bank as payment; coins in the player's inventory take precedence". Update:GE_Improvements:_Beyond_Max_Cash
 * adds platinum tokens to the mix, taken "in whichever inventory it's taking from", with change in coins.
 * So a buy the inventory cannot cover takes its plain coins and tokens, then the bank's coins, then
 * the bank's tokens (change into the bank). Everything runs on copies; `{ inventory, banks }` is
 * committed only once the offer goes through. Returns `{ message }` when it cannot be paid.
 */
function bankPayment(player, inventory, total) {
  const result = new Inventory(player);
  result.setItems(inventory.getCopiedItems());
  let left = total;
  let restrictedValue = 0;
  for (const [id, value] of [[COINS, 1], [PLATINUM_TOKEN, COINS_PER_TOKEN]]) {
    for (const [slot, amount] of plainStacks(inventory, id)) {
      result.deleteAtSlot(slot, amount, false);
      left -= amount * value;
    }
    restrictedValue += (inventory.getAmount(id) - plainStacks(inventory, id).reduce((sum, [, a]) => sum + a, 0)) * value;
  }
  const banks = new Map();
  const copy = (tab) => {
    if (!banks.has(tab)) {
      const bank = new Bank(player);
      bank.setItems(player.getBank(tab).getCopiedItems());
      banks.set(tab, bank);
    }
    return banks.get(tab);
  };
  const coinStacks = realBankTabs(player).flatMap((tab) =>
    plainStacks(player.getBank(tab), COINS).map(([slot, amount]) => ({ tab, slot, amount })));
  const bankCoins = coinStacks.reduce((sum, stack) => sum + stack.amount, 0);
  if (left <= bankCoins) {
    for (const { tab, slot, amount } of coinStacks) {
      if (left <= 0) break;
      const taken = Math.min(left, amount);
      copy(tab).deleteAtSlot(slot, taken, false);
      left -= taken;
    }
  } else {
    // Whole tokens pay what the bank's coins cannot; the change (under 1,000) is what the bank's
    // plain coins come to afterwards.
    let short = left - bankCoins;
    let freed = 0;
    for (const tab of realBankTabs(player)) {
      for (const [slot, amount] of plainStacks(player.getBank(tab), PLATINUM_TOKEN)) {
        if (short <= 0) break;
        const taken = Math.min(Math.ceil(short / COINS_PER_TOKEN), amount);
        copy(tab).deleteAtSlot(slot, taken, false);
        if (taken === amount) freed++;
        short -= taken * COINS_PER_TOKEN;
      }
    }
    if (short > 0) {
      // Preset or other restricted copies are never spent; say so when they are what is missing.
      const restrictedBank = realBankTabs(player).reduce((sum, tab) => {
        const bank = player.getBank(tab);
        return sum + [[COINS, 1], [PLATINUM_TOKEN, COINS_PER_TOKEN]].reduce((s, [id, value]) =>
          s + (bank.getAmount(id) - plainStacks(bank, id).reduce((n, [, a]) => n + a, 0)) * value, 0);
      }, 0);
      return { message: restrictedValue + restrictedBank >= short ? PRESET_TEXT : "You do not have enough coins." };
    }
    const change = -short;
    // Change goes where the bank keeps its coins, as collect picks it. Only the copies have
    // changed so far, so this reads the live tabs.
    const coinTab = Bank.getTabForItem(player, COINS);
    if (bankCoins > 0) {
      // One coin stack is left holding the change, so it needs no new slot.
      const keep = coinStacks.find((stack) => stack.tab === coinTab) ?? coinStacks[0];
      for (const { tab, slot, amount } of coinStacks) {
        if (tab === keep.tab && slot === keep.slot && change > 0) copy(tab).getItems()[slot].setAmount(change);
        else copy(tab).deleteAtSlot(slot, amount, false);
      }
    } else if (change > 0) {
      const bank = copy(coinTab >= 0 ? coinTab : 0);
      const items = bank.getItems();
      // A coins placeholder takes the change in place; otherwise it needs a free slot, counting
      // the token stacks this payment empties.
      const held = items.findIndex((item) => item?.getAmount() === 0 && item.getId() >= 0 &&
        (item.getId() === COINS || Bank.sharesPlaceholder(item.getId(), COINS)));
      const slot = held >= 0 ? held : (Bank.freeSlots(player) + freed > 0 ? bank.freeSlot() : -1);
      if (slot < 0) return { message: "You don't have enough bank space for your change." };
      bank.setItem(slot, new Item(COINS, change));
    }
    left = 0;
  }
  for (const bank of banks.values()) bank.sortItems();
  return { inventory: result, banks };
}

/**
 * Wiki (Grand Exchange): "free players may only purchase free-to-play items, and not members' items"; selling has
 * no restriction. Every buy offer reaches confirm, however the item was picked. TSPS wording for the line.
 */
function freeWorldBuyRefused(player, offer) {
  if (offer.sell || pluginApi.core.WorldDefinition.isMembersWorld()) return false;
  const item = CacheDefinitions.getItem(ItemDefinition.forId(offer.itemId).unNote());
  if (item?.isMembers !== true) return false;
  player.getPacketSender().sendMessage("You can only buy free-to-play items on a free world.");
  return true;
}

/**
 * All Settings 297 and 298 (the rows' own text): a buy offer more than 10 times the guide price, or
 * a sell offer under 10% of it, asks first. Ours: the warning's wording.
 */
function priceWarning(player, offer, unitPrice) {
  const guide = guidePrice(offer);
  const sender = player.getPacketSender();
  if (!offer.sell && !sender.getVarbit(BUY_WARNING_DISABLED_VARBIT) && unitPrice > guide * PRICE_WARNING_FACTOR) {
    return `Your offer is more than ${PRICE_WARNING_FACTOR} times the guide price.`;
  }
  if (offer.sell && !sender.getVarbit(SELL_WARNING_DISABLED_VARBIT) && unitPrice * PRICE_WARNING_FACTOR < guide) {
    return `Your offer is less than ${100 / PRICE_WARNING_FACTOR}% of the guide price.`;
  }
  return null;
}

/**
 * `warned`: the offer as the player accepted its price warning ({ itemId, price, quantity }). The
 * Exchange stays open behind the warning, so an offer edited since is checked again.
 */
function confirm(player, offer, warned = null) {
  if (!active(player, offer) || !exchangeable(offer.itemId)) return;
  if (freeWorldBuyRefused(player, offer)) return;
  const amount = offer.quantity;
  const unitPrice = offerPrice(offer);
  offer.price = unitPrice;
  const total = amount * unitPrice;
  const sender = player.getPacketSender();
  if (!Number.isInteger(unitPrice) || unitPrice < 1 || unitPrice > MAX ||
      !Number.isInteger(amount) || amount < 1 || amount > MAX ||
      !Number.isSafeInteger(total) || total > MAX_TRADE) {
    sender.sendMessage("Choose a smaller quantity (maximum trade value is 2,149,631,130,647 coins).");
    return;
  }
  const remaining = offer.sell ? Infinity : remainingLimit(player, offer.itemId);
  if (amount > remaining) {
    sender.sendMessage(`You can only buy ${itemLimit(offer.itemId)} of that item every 4 hours (${remaining} remaining).`);
    return;
  }
  const inventory = player.getInventory();
  const inputId = offer.sell ? offer.itemId : COINS;
  const inputAmount = offer.sell ? amount : total;
  const matchesInput = (item) => item.getId() === inputId ||
    (offer.sell && item.getId() > 0 && ItemDefinition.forId(item.getId()).unNote() === inputId);
  const heldAmount = inventory.getItems().filter(matchesInput).reduce((sum, item) => sum + item.getAmount(), 0);
  const tokens = offer.sell ? 0 : tokensNeeded(inventory, total);
  if (offer.sell && heldAmount < inputAmount) {
    sender.sendMessage("You do not have enough of that item.");
    return;
  }
  // The inventory is short: the rest comes from the bank, under the bank's own access rules
  // (an unentered Bank PIN, an Ultimate Ironman, a duel) as collecting to the bank uses.
  const fromBank = tokens === null ? bankPayment(player, inventory, total) : null;
  if (fromBank?.message) {
    sender.sendMessage(fromBank.message);
    return;
  }
  if (fromBank && pluginApi.emitCanBank(player, "grand-exchange-buy") === false) return;
  const accepted = warned?.itemId === offer.itemId && warned.price === unitPrice && warned.quantity === amount;
  const warning = accepted ? null : priceWarning(player, offer, unitPrice);
  if (warning) {
    ValueWarning.confirm(pluginApi.core, player, {
      itemId: offer.itemId,
      text: `${warning}<br>Are you sure you want to place this offer?`,
      title: "Place this offer?",
      yes: "Yes, place the offer.",
      no: "No, don't place the offer.",
      proceed: () => confirm(player, offer, { itemId: offer.itemId, price: unitPrice, quantity: amount }),
    });
    return;
  }
  // Plugins may veto an offer (e.g. an untradeable item that cannot be listed).
  const confirmation = { player, itemId: offer.itemId, sell: offer.sell, quantity: amount, accepted: true };
  pluginApi.emitCustomEvent("ge:offer-confirmed", confirmation);
  if (confirmation.accepted === false) {
    return;
  }

  // Use the normal container rules on a copy: failed/full trades never remove live items.
  const result = fromBank?.inventory ?? new Inventory(player);
  if (!fromBank) result.setItems(inventory.getCopiedItems());
  if (fromBank) {
    // Already worked out on copies by bankPayment; committed with the inventory below.
  } else if (tokens > 0) {
    const shortfall = total - inventory.getAmount(COINS);
    result.deleted(COINS, inventory.getAmount(COINS), false);
    result.deleted(PLATINUM_TOKEN, tokens, false);
    // The coin stack was emptied and the change is under 1,000, so it cannot overflow; it can
    // still have no slot to land in when the inventory is full.
    const change = tokens * COINS_PER_TOKEN - shortfall;
    result.add(new Item(COINS, change), false);
    if (result.getAmount(COINS) !== change) {
      sender.sendMessage("You don't have enough inventory space for your change.");
      return;
    }
  } else {
    // An offer's input comes from one stack; a delete by id would run on into the next.
    const plain = (item) => matchesInput(item) && item.getAmount() > 0 && !restricted(item);
    const firstStack = inventory.getItems().find(plain);
    const plainTotal = inventory.getItems().filter(plain).reduce((sum, item) => sum + item.getAmount(), 0);
    if (!firstStack || plainTotal < inputAmount && !ItemDefinition.forId(inputId).isStackable()) {
      sender.sendMessage(PRESET_TEXT);
      return;
    }
    // Keep the one-stack restriction for each stackable form, while accepting notes and items together.
    const seen = new Set();
    const inputSlots = new Set();
    const usableTotal = inventory.getItems().reduce((sum, item, slot) => {
      if (!plain(item)) return sum;
      const id = item.getId();
      if (ItemDefinition.forId(id).isStackable() && seen.has(id)) return sum;
      seen.add(id);
      inputSlots.add(slot);
      return sum + item.getAmount();
    }, 0);
    if (usableTotal < inputAmount) {
      sender.sendMessage("Trade one item stack at a time.");
      return;
    }
    let left = inputAmount;
    result.getItems().forEach((item, slot) => {
      if (left <= 0 || !inputSlots.has(slot)) return;
      const taken = Math.min(left, item.getAmount());
      result.deleteAtSlot(slot, taken, false);
      left -= taken;
    });
  }
  inventory.setItems(result.getItems()).refreshItems();
  for (const [tab, bank] of fromBank?.banks ?? []) player.getBank(tab).setItems(bank.getItems());
  const delay = fillDelayMs(offer);
  // One clock reading: releaseLimit matches placedAt against the window recordLimit opens here.
  const now = Date.now();
  const finished = { ...offer, total, finished: false, placedAt: now, completesAt: delay === null ? null : now + delay };
  completedOffers(player)[offer.slot] = finished;
  if (!offer.sell) recordLimit(player, offer.itemId, amount, now);
  saveOffers(player);
  offers.delete(player);
  viewing.set(player, offer.slot);
  player.getPacketSender().abortInputPrompt();
  sender.sendInterfaceScript(786, [], { [SELECTED_ITEM]: -1, ...marketVarps(offer.slot, finished) },
      { [SELECTED_SLOT]: offer.slot + 1, [TAX_RATE]: taxExempt(offer.itemId) ? 0 : 1000 / TAX_DIVISOR },
      { [COLLECTIONS[offer.slot]]: collection(finished) })
    .sendInterfaceScript(SET_DESCRIPTION_SCRIPT, [examine(offer.itemId), feeLabel(offer), DETAILS_DESC, DETAILS_FEE_INFO])
    .sendMessage("Offer placed. It will fill when the market meets your price.");
  scheduleCompletion(player, finished);

}

/**
 * Script 9909's collection menu: a single noteable item offers Collect-item (1)
 * and Collect-note (2); a stack offers Collect-notes (1) and Collect-items (2).
 * A non-noteable item only has Collect (2) and Bank (3).
 */
function collectionOutputId(baseId, amount, action, forceNotes = false) {
  const noteId = ItemDefinition.forId(baseId).getNoteId();
  const noteable = noteId >= 0 && ItemDefinition.forId(noteId).isNoted();
  if (!noteable || action === 3) return baseId;
  // Collect-all notes a stack but not a single item: notes begin at two in a slot (rsprox 1521: one bought item arrives as the item).
  if (forceNotes) return amount > 1 ? noteId : baseId;
  if (action === 2) return amount === 1 ? noteId : baseId;
  if (action === 1) return amount > 1 ? noteId : baseId;
  return baseId;
}

/**
 * Collects a finished offer: every part not yet taken, or with `part` only that collection slot
 * (rsprox_transcripts/236/03950.txt: 465:24 sub 2 takes the item, sub 3 later the refunded coins).
 */
function collect(player, action, slot = viewing.get(player), forceNotes = false, part = null) {
  const offer = completedOffers(player)[slot];
  if (!offer?.finished) return;
  const taken = collectedParts(offer);
  const all = payout(offer);
  const wanted = all.map((paid, index) => ({ paid, index }))
    .filter(({ index }) => !taken.includes(index) && (part === null || index === part));
  if (!wanted.length) return;
  // A bank collection must obey the same account restrictions as bank access.
  if (action === 3 && pluginApi.emitCanBank(player, "grand-exchange-collect") === false) return false;
  const inventory = player.getInventory();
  const parts = [];
  // Each part lands on a copy first, so a collection that does not fit hands over nothing.
  const results = new Map();
  for (const { paid } of wanted) {
    const baseId = paid.itemId === COINS || paid.itemId === PLATINUM_TOKEN ? paid.itemId : ItemDefinition.forId(paid.itemId).unNote();
    const outputId = collectionOutputId(baseId, paid.amount, action, forceNotes);
    const destination = action === 3 ? player.getBank(Bank.getTabForItem(player, baseId)) : inventory;
    let result = results.get(destination)?.result;
    if (!result) {
      result = action === 3 ? new Bank(player) : new Inventory(player);
      result.setItems(destination.getCopiedItems());
      results.set(destination, { result });
    }
    const before = result.getAmount(outputId);
    result.add(new Item(outputId, paid.amount), false);
    if (before + paid.amount > MAX || result.getAmount(outputId) !== before + paid.amount) {
      player.sendMessage(`You do not have enough ${action === 3 ? "bank" : "inventory"} space to collect that offer.`);
      return;
    }
    parts.push({ outputId, amount: paid.amount, destination });
  }
  for (const [destination, { result }] of results) destination.setItems(result.getItems());
  if (action !== 3) inventory.refreshItems();
  // Plugins may change what the collection hands over (e.g. a bought bond
  // arrives untradeable) before the offer is cleared and saved below.
  for (const { outputId, amount, destination } of parts) {
    pluginApi.emitCustomEvent("ge:offer-collected", {
      player,
      itemId: outputId,
      amount,
      destination: action === 3 ? "bank" : "inventory",
      container: destination,
      // The item handed back from an aborted sell offer (not bought); an aborted buy returns coins.
      returned: Boolean(offer.sell && offer.aborted),
    });
  }
  const remaining = all.length - taken.length - wanted.length;
  if (remaining > 0) offer.collected = [...taken, ...wanted.map(({ index }) => index)];
  else delete completedOffers(player)[slot];
  saveOffers(player);
  const sender = player.getPacketSender();
  if (remaining > 0) {
    sender.sendInterfaceScript(786, [], marketVarps(slot, offer), undefined,
      { [COLLECTIONS[slot]]: collection(offer) });
    refreshCollectionBox(player);
    for (const { outputId, amount } of parts) {
      sender.sendMessage(`Collected ${amount.toLocaleString("en-US")} x ${ItemDefinition.forId(outputId).getName()}.`);
    }
    return;
  }
  sender.sendInterfaceScript(786, [], marketVarps(slot), undefined,
    { [COLLECTIONS[slot]]: collection() });
  if (player.getInterfaceId() === GE) home(player);
  refreshCollectionBox(player);
  for (const { outputId, amount } of parts) {
    sender.sendMessage(`Collected ${amount.toLocaleString("en-US")} x ${ItemDefinition.forId(outputId).getName()}.`);
  }
}

/** Abort offer (465:23, dynamic child 0): an offer still trading stops; its input waits in the collection. */
function abort(player, slot = viewing.get(player)) {
  const offer = completedOffers(player)[slot];
  if (!offer || offer.finished) {
    player.sendMessage("That offer has already completed.");
    return;
  }
  offer.finished = true;
  offer.aborted = true;
  if (!offer.sell) releaseLimit(player, offer);
  saveOffers(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(786, [], marketVarps(slot, offer), undefined,
    { [COLLECTIONS[slot]]: collection(offer) });
  refreshCollectionBox(player);
  sender.sendVarbit(SELECTED_SLOT, 0).sendVarbit(SELECTED_SLOT, slot + 1);
  sender.sendMessage("Abort request acknowledged. Please be aware that your offer may have already been completed.");
}

/** The Collect button (465:6, dynamic child 0): op 1 to the inventory (a slot of two or more as notes, a single item as the item), op 2 to the bank. */
function collectAll(player, action) {
  const to = action === 2 ? 3 : 1;
  for (const slot of Object.keys(completedOffers(player)).map(Number)) {
    if (collect(player, to, slot, to === 1) === false) break;
  }
}

/** "grand-exchange:can-open": other content may keep a player out. */
function refusedEntry(player) {
  const request = { player, allow: true, message: null };
  pluginApi.emitCustomEvent("grand-exchange:can-open", request);
  if (request.allow) return false;
  if (request.message) player.sendMessage(request.message);
  return true;
}

function openGrandExchange({ player }) {
  if (refusedEntry(player)) return true;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "grand-exchange", resume: () => openGrandExchange({ player }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  if ([GE, GE_HISTORY, GE_COLLECT].includes(player.getInterfaceId())) {
    player.getPacketSender().sendInterfaceRemoval();
    historyOpen.delete(player);
  }
  if (player.busy()) {
    player.sendMessage("Finish what you are doing before opening the Grand Exchange.");
    return true;
  }
  player.getMovementQueue().reset();
  player.getSkillManager().stopSkillable();
  home(player);
  const sender = player.getPacketSender();
  player.setInterfaceId(GE);
  sender.sendVarbit(TAX_RATE, 1000 / TAX_DIVISOR)
    .sendVarpLong(PRICE_LONG, 1)
    // The GE on-load script reads these before it creates offer widgets.
    // Varp 1151=0 is a real item (Dwarf remains), so clearing it later is
    // visibly too late.
    .sendSubInterface(MAIN_MODAL, GE, 0, {
      varps: { [SELECTED_ITEM]: -1, ...allMarketVarps(player) },
      varbits: { [SELL]: 0, [QUANTITY]: 1, [SELECTED_SLOT]: 0 },
    })
    .sendSubInterface(SIDE_MODAL, SIDE, 3);
  // Keep the server value in sync for clients that process transmitters
  // only after the sub-interface has mounted.
  sender.sendConfig(SELECTED_ITEM, -1);
  sender.sendInterfaceScript(786, [], undefined, undefined, allCollections(player));
  player.getInventory().refreshItems();
  // Scripts 794/798: child 2 views offers; children 3/4 create buy/sell offers.
  for (let child = 7; child <= 14; child++) {
    sender.sendInterfaceFlagsRange(uid(child), 2, 4, 2);
  }
  sender.sendInterfaceFlagsRange(uid(26), 0, 16, 2)
    .sendInterfaceFlags(uid(30), 2)
    .sendInterfaceFlags(uid(4), 2)
    .sendInterfaceFlags(SETUP_FEE_INFO, 2)
    .sendInterfaceFlags(DETAILS_FEE_INFO, 2)
    // Script 816 creates backgrounds at 0/1 and collection items at 2/3.
    // Bits 1-3 enable Collect-notes, Collect-items, and Bank.
    .sendInterfaceFlagsRange(uid(24), 2, 3, 14)
    // Scripts 793/819 create the Collect button under 6 (ops 1-2) and Abort/Modify under 23.
    .sendInterfaceFlagsRange(uid(6), 0, 1, 6)
    .sendInterfaceFlagsRange(uid(23), 0, 1, 2)
    // Same item operations as the normal inventory panel.
    .sendInterfaceFlagsRange(SIDE_ITEMS, 0, 27, 1086);
  sender.sendMessage("Grand Exchange: live guide prices. Fills depend on trade volume and your price; buy limits reset every four hours.");
  return true;
}

function openCollectionBox({ player }) {
  // A locked Bank PIN asks first, under the Grand Exchange's title; the right PIN opens the box at once.
  const pin = { player, feature: "grand-exchange", delay: 0, resume: () => openCollectionBox({ player }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  const sender = player.getPacketSender();
  if ([GE, GE_HISTORY, GE_COLLECT].includes(player.getInterfaceId())) sender.sendInterfaceRemoval();
  if (player.busy()) {
    sender.sendMessage("Finish what you are doing before opening the Collection Box.");
    return true;
  }
  player.getMovementQueue().reset();
  player.getSkillManager().stopSkillable();
  home(player);
  player.setInterfaceId(GE_COLLECT);
  sender.sendSubInterface(MAIN_MODAL, GE_COLLECT, 0, { varps: allMarketVarps(player) });
  refreshCollectionBox(player);
  // Script 789 puts the two collection items at dynamic children 3 and 4.
  for (let child = 5; child <= 12; child++) {
    sender.sendInterfaceFlagsRange(collectUid(child), 3, 4, 14);
  }
  sender.sendInterfaceFlags(collectUid(3), 2).sendInterfaceFlags(collectUid(4), 2);
  // Children 5-12 are slots 1-8; script 789 draws all of them, so hide the members-only ones.
  for (let child = 5; child <= 12; child++) {
    sender.sendInterfaceDisplayState(collectUid(child), child - 5 >= usableSlots());
  }
  return true;
}

function handleCollectionButton({ player, buttonId, slot, action }) {
  if (player.getInterfaceId() !== GE_COLLECT) return true;
  const child = buttonId & 0xffff;
  if ((child === 3 || child === 4) && action === 1) {
    collectAll(player, child === 4 ? 2 : 1);
  } else if (child >= 5 && child <= 12 && slot === 3 && action >= 1 && action <= 3) {
    collect(player, action, child - 5);
  }
  return true;
}

/** Preset (and other untradeable or unbankable) copies never sell. */
function restricted(item) {
  return item.isPresetItem() || item.isUntradeable() || item.isUnbankable();
}

function handleInventoryItem(event) {
  // The cache has used both 467:0 and the normal inventory id for this
  // mounted panel. The item/slot validation is the reliable discriminator.
  if (event.player.getInterfaceId() !== GE) return false;
  if (historyOpen.has(event.player)) return true;
  const item = event.player.getInventory().getItems()[event.slot];
  if (item?.getId() === event.itemId && validItem(event.itemId)) {
    if (!exchangeable(event.itemId)) {
      // rsprox 226/01671.txt:24807, 232/03215.txt:42779.
      event.player.sendMessage("You can't trade that item on the Grand Exchange.");
      return true;
    }
    if (restricted(item)) {
      event.player.sendMessage(PRESET_TEXT);
      return true;
    }
    start(event.player, true, offers.get(event.player)?.slot ?? 0, ItemDefinition.forId(event.itemId).unNote());
    return true;
  }
  return false;
}

function handleExchangeButton({ player, buttonId, slot, action }) {
  if (player.getInterfaceId() !== GE) return true;
  if (historyOpen.has(player)) return true;
  // Sub 2 and 3 are the offer's two collection slots; each click takes only its own.
  if (buttonId === uid(24) && action >= 1 && action <= 3) {
    collect(player, action, viewing.get(player), false, slot === 2 || slot === 3 ? slot - 2 : null);
    return true;
  }
  // Child 1 of 465:6 is Repeat Offer (script 793), not handled here.
  if (buttonId === uid(6) && slot === 0 && (action === 1 || action === 2)) { collectAll(player, action); return true; }
  if (buttonId === uid(23) && action === 1) {
    if (slot === 0) abort(player);
    else player.sendMessage("To change an offer, abort it, collect, and place a new one.");
    return true;
  }
  if (action !== 1) return true;
  if (buttonId === SETUP_FEE_INFO || buttonId === DETAILS_FEE_INFO) {
    const offer = offers.get(player) ?? completedOffers(player)[viewing.get(player)];
    if (offer?.sell && offer.itemId > 0) {
      const sender = player.getPacketSender();
      sender.abortInputPrompt();
      player.setEnteredAmountAction({ acceptsZero: true, execute: () => sender.closeSubInterface(FEE_POPUP) });
      sender.sendSubInterface(FEE_POPUP, POPUP_INTERFACE, 1)
        .sendInterfaceScript(POPUP_TEXT_SCRIPT, [FEE_INFORMATION, FEE_POPUP]);
    }
    return true;
  }
  if (buttonId === uid(3)) { showHistory(player); return true; }
  if (buttonId === uid(4)) { home(player); return true; }
  const child = buttonId & 0xffff;
  if (child >= 7 && child <= 14) {
    // Script 798 assigns Buy to child 3 and Sell to child 4.
    const offerSlot = child - 7;
    if (Object.hasOwn(completedOffers(player), offerSlot)) showCompleted(player, offerSlot);
    else if (slot === 3 || slot === 4) start(player, slot === 4, offerSlot);
    return true;
  }
  const offer = offers.get(player);
  if (!offer) return true;
  if (buttonId === uid(30)) { confirm(player, offer); return true; }
  // This dynamic child is sent without a slot by some client revisions.
  if (buttonId === uid(26) && (slot == null || slot <= 0)) { chooseItem(player, offer); return true; }
  if (!validItem(offer.itemId)) return true;
  // Script 773: quantity -1/+1/+1/+10/+100/All-or-1K/custom.
  if (slot >= 1 && slot <= 6) {
    const delta = [-1, 1, 1, 10, 100, 1000][slot - 1];
    offer.quantity = slot === 6 && offer.sell ? player.getInventory().getItems()
      .filter((item) => item.getId() > 0 && ItemDefinition.forId(item.getId()).unNote() === offer.itemId)
      .reduce((sum, item) => sum + item.getAmount(), 0)
      : offer.quantity + delta - (delta > 1 && offer.quantity === 1 ? 1 : 0);
    offer.quantity = Math.max(1, Math.min(MAX, offer.quantity));
  } else if (slot === 7) {
    player.setEnteredAmountAction({ execute: function handleTradeQuantity(amount) {
      if (!active(player, offer) || !Number.isInteger(amount) || amount < 1 || amount > MAX) return;
      offer.quantity = amount;
      refresh(player, offer);
    } });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to trade?");
  } else if (slot >= 8 && slot <= 13) {
    if (slot === 12) {
      player.setEnteredAmountAction({ execute: function handleOfferPrice(amount) {
        if (!active(player, offer) || !Number.isInteger(amount) || amount < 1 || amount > MAX) return;
        offer.price = amount;
        refresh(player, offer);
      } });
      player.getPacketSender().sendEnterAmountPrompt(
        offer.sell ? "How much would you like to sell each item for?" : "How much would you like to pay for each item?",
      );
    } else {
      offer.price = changePrice(offer, slot);
    }
  }
  refresh(player, offer);
  return true;
}

function handleHistoryButton({ player, buttonId, slot, action }) {
  if (!historyOpen.has(player) || action !== 1) return true;
  if (buttonId === historyUid(2)) {
    openGrandExchange({ player });
    return true;
  }
  if (buttonId !== historyUid(3) || !Number.isInteger(slot) || slot < 0) return true;

  // Script 1645 creates six dynamic children per history row; the widget action
  // slot is the child index within that list.
  const entry = tradeHistory(player)[Math.floor(slot / 6)];
  if (!entry || !exchangeable(Number(entry.itemId))) return true;
  openGrandExchange({ player });
  if (!historyOpen.has(player) && player.getInterfaceId() === GE) {
    start(player, false, 0, Number(entry.itemId));
  }
  return true;
}

const COLLECTION_BUTTONS = Array.from({ length: 10 }, (_, i) => collectUid(i + 3));
// Child 34 is the offer setup panel; its quantity and price controls are dynamic children (slot 1-13).
const EXCHANGE_BUTTONS = [SETUP_FEE_INFO, DETAILS_FEE_INFO, uid(3), uid(4), uid(6), uid(23), uid(24), uid(26), uid(30), uid(34), ...Array.from({ length: 8 }, (_, i) => uid(i + 7))];
const historyUid = (child) => (GE_HISTORY << 16) | child;
const HISTORY_BUTTONS = [historyUid(2), historyUid(3)];

module.exports = {
  name: "GrandExchange",
  description: "The Grand Exchange: offers, offer collection and the item-price resource it uses.",
  config: {
    "GrandExchange:maxTradeDelay": {
      type: "number", label: "Longest offer wait (ms)", default: 3600000, integer: true, min: 5000, max: 2147483647,
      help: "Upper limit, in milliseconds, on how long an offer takes to complete. Applies to newly placed offers.",
    },
  },
  _test: {
    priceWarning,
    confirm,
    setApi: (api) => { pluginApi = api; },
    setOffer: (player, offer) => offers.set(player, offer),
    price,
    sellPrice,
    changePrice,
    collectionOutputId,
    payout,
    tax,
    taxExempt,
    TAX_CAP,
    TAX_DIVISOR,
    MAX_TRADE,
    fillDelayMs,
    remainingLimit,
    recordLimit,
    fillUnitPrice,
    releaseLimit,
    LIMITS_ATTRIBUTE,
    HISTORY_ATTRIBUTE,
    HISTORY_LIMIT,
    REMINDERS_ATTRIBUTE,
    REMINDED_AT_ATTRIBUTE,
    collectionReminder,
    remindCollection,
    tradeHistory,
    recordHistory,
    LIMIT_WINDOW_MS,
    OFFERS_ATTRIBUTE,
    setMarketData: (data) => {
      marketData = data;
    },
  },
  register(api) {
    pluginApi = api;
    require("./grandexchange/Sets.GrandExchange")(api);
    loadMarketData();
    api.persistAttribute(OFFERS_ATTRIBUTE, {});
    api.persistAttribute(LIMITS_ATTRIBUTE, {});
    api.persistAttribute(HISTORY_ATTRIBUTE, []);
    api.persistAttribute(REMINDERS_ATTRIBUTE, true);
    api.persistAttribute(REMINDED_AT_ATTRIBUTE);
    api.onPlayerLogin(login);
    api.onPlayerProcess(({ player }) => {
      if (searching.has(player) && player.getInterfaceId() !== GE) closeSearch(player);
      if (historyOpen.has(player) && ![GE, GE_HISTORY].includes(player.getInterfaceId())) historyOpen.delete(player);
    });
    api.onPlayerLogout(({ player }) => {
      searching.delete(player);
      historyOpen.delete(player);
      for (const timer of completionTimers.get(player) ?? []) clearTimeout(timer);
      completionTimers.delete(player);
    });
    api.registerContentEndpoint("item-prices", itemPricesResource);
    api.registerCommand("ge", openGrandExchange, undefined, "Open the Grand Exchange");
    api.registerCommand("gecollect", openCollectionBox, undefined, "Open the Grand Exchange collection box");

    api.onNpcInteraction(CLERK, { "Exchange": openGrandExchange, "History": openHistory });
    api.onNpcDialogueCondition(clerkCondition);
    api.onCustomEvent("npc-dialogue:line", clerkLine);
    api.onCustomEvent("npc-dialogue:action", clerkAction);
    api.onCustomEvent("npc-dialogue:action", collectAction);
    api.onAnyNpcInteraction({ "Collect": collectFromNpc });
    api.onObjectInteraction(collectFromObject);
    api.onObjectInteraction("Grand Exchange booth", {
      "Exchange": openGrandExchange,
      "Collect": openCollectionBox,
    });

    api.onInterfaceActionButton(COLLECTION_BUTTONS, handleCollectionButton);
    api.onItemFirstAction(handleInventoryItem);
    api.onInterfaceActionButton(SIDE_ITEMS, (event) => event.action === 1 && handleInventoryItem(event));
    api.onInterfaceActionButton(EXCHANGE_BUTTONS, handleExchangeButton);
    api.onInterfaceActionButton(HISTORY_BUTTONS, handleHistoryButton);
    api.onCustomEvent("interface:closed", ({ player, interfaceId }) => {
      if (interfaceId === GE_HISTORY) historyOpen.delete(player);
    });
  },
};
