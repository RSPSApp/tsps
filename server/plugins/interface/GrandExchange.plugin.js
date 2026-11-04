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
// The new offer's price: a long varp from rev 241 (it was varbit 4398).
const PRICE_LONG = 5753;
const SELECTED_ITEM = 1151;
// ge_offers:setup_desc, the examine text under the item name; the server sets it.
const SETUP_DESC = uid(27);
// ge_offers:details_desc, the same text on an existing offer's details screen.
const DETAILS_DESC = uid(16);
// Cache script 5733 reads pending client requests here, not accepted offers.
// Keep them separate from the stockmarket opcode data.
const OFFER_ITEMS = [3204, 3206, 3208, 3210, 3212, 3214, 3216, 3218];
const COLLECTIONS = [518, 519, 520, 521, 522, 523, 539, 540];
const MARKET_BASE = 7900;
const MARKET_STRIDE = 7;
const FINISHED = 5;
const OFFERS_ATTRIBUTE = "grand-exchange-offers";
const LIMITS_ATTRIBUTE = "grand-exchange-limits";
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
const COINS = ItemIdentifiers.COINS;
const PLATINUM_TOKEN = ItemIdentifiers.PLATINUM_TOKEN;
// OSRS Wiki Update:GE_Improvements:_Beyond_Max_Cash: payment mixes coins and platinum tokens,
// coins first, with change in coins. Only the inventory is used (the client reads it with
// inv_total of 995/13204 in script 9915). Cache script 779 rejects a total (varbit 4396 quantity
// x long varp 5753 price) above lconst 500:2147482647 = 2,149,631,130,647 ("Too much money!"),
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
// OSRS: members get all 8 offer slots, free-to-play worlds the first 3.
const usableSlots = () => (pluginApi.core.WorldDefinition.isMembersWorld() ? 8 : 3);
const offers = new WeakMap();
const completionTimers = new WeakMap();
const viewing = new WeakMap();
const searching = new WeakSet();
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

function saveOffers(player) {
  GameConstants.PLAYER_PERSISTENCE.save(player, "grand-exchange");
}

function scheduleCompletion(player, offer) {
  if (offer.finished || offer.completesAt === null) return;
  let timers = completionTimers.get(player);
  if (!timers) completionTimers.set(player, timers = new Set());
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (completedOffers(player)[offer.slot] !== offer) return;
    // A second timer for the same offer (e.g. rescheduled on login) must not
    // re-save and re-announce an already-completed offer.
    if (offer.finished) return;
    offer.finished = true;
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

function marketVarps(slot, offer) {
  const base = MARKET_BASE + slot * MARKET_STRIDE;
  return {
    [OFFER_ITEMS[slot]]: -1,
    [base + 6]: offer?.itemId ?? -1,
    [base]: offer ? offerPrice(offer) : 0,
    [base + 1]: offer?.quantity ?? 0,
    // An aborted offer traded nothing (the client draws its bar red).
    [base + 2]: offer?.finished && !offer.aborted ? offer.quantity : 0,
    [base + 3]: offer?.finished && !offer.aborted ? Math.min(MAX, offer.total) : 0,
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
  // Saved offers from before adjustable prices have no price. Use the unit price they
  // actually sold at rather than today's guide, which may have moved since the sale.
  const unitPrice = Number.isInteger(offer.price) && offer.price > 0
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
  const coins = offer.sell !== Boolean(offer.aborted);
  if (!coins) return [{ itemId: offer.itemId, amount: offer.quantity }];
  const total = Math.max(0, offer.total - tax(offer));
  if (total <= MAX) return [{ itemId: COINS, amount: total }];
  const tokens = Math.min(MAX, Math.floor(total / COINS_PER_TOKEN));
  return [{ itemId: PLATINUM_TOKEN, amount: tokens }, { itemId: COINS, amount: total - tokens * COINS_PER_TOKEN }];
}

function collection(offer) {
  return {
    capacity: 2,
    slots: offer?.finished ? payout(offer).map(({ itemId, amount }, slot) => ({ slot, itemId, quantity: amount })) : [],
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
    .sendVarbit(SELL, offer.sell ? 1 : 0)
    .sendVarbit(QUANTITY, offer.quantity)
    .sendVarpLong(PRICE_LONG, offer.itemId > 0 ? offerPrice(offer) : 1)
    .sendVarbit(SELECTED_SLOT, offer.slot + 1)
    .sendString(examine(offer.itemId), SETUP_DESC);
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
    .sendConfig(SELECTED_ITEM, -1)
    .sendVarbit(SELECTED_SLOT, 0)
    .sendVarbit(SELECTED_SLOT, slot + 1)
    .sendString(examine(completedOffers(player)[slot].itemId), DETAILS_DESC);
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

function confirm(player, offer) {
  if (!active(player, offer) || !exchangeable(offer.itemId)) return;
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
  const tokens = offer.sell ? 0 : tokensNeeded(inventory, total);
  if (tokens === null || (offer.sell && inventory.getAmount(inputId) < inputAmount)) {
    sender.sendMessage(offer.sell ? "You do not have enough of that item." : "You do not have enough coins.");
    return;
  }
  // Plugins may veto an offer (e.g. an untradeable item that cannot be listed).
  const confirmation = { player, itemId: offer.itemId, sell: offer.sell, accepted: true };
  pluginApi.emitCustomEvent("ge:offer-confirmed", confirmation);
  if (confirmation.accepted === false) {
    return;
  }

  // Use the normal container rules on a copy: failed/full trades never remove live items.
  const result = new Inventory(player);
  result.setItems(inventory.getCopiedItems());
  if (tokens > 0) {
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
    result.deleted(inputId, inputAmount, false);
    if (result.getAmount(inputId) !== inventory.getAmount(inputId) - inputAmount) {
      sender.sendMessage("Trade one item stack at a time.");
      return;
    }
  }
  inventory.setItems(result.getItems()).refreshItems();
  const delay = fillDelayMs(offer);
  const finished = { ...offer, total, finished: false, completesAt: delay === null ? null : Date.now() + delay };
  completedOffers(player)[offer.slot] = finished;
  if (!offer.sell) recordLimit(player, offer.itemId, amount);
  saveOffers(player);
  offers.delete(player);
  viewing.set(player, offer.slot);
  player.getPacketSender().abortInputPrompt();
  sender.sendInterfaceScript(786, [], { [SELECTED_ITEM]: -1, ...marketVarps(offer.slot, finished) },
      { [SELECTED_SLOT]: offer.slot + 1 },
      { [COLLECTIONS[offer.slot]]: collection(finished) })
    .sendString(examine(offer.itemId), DETAILS_DESC)
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
  if (forceNotes) return noteId;
  if (action === 2) return amount === 1 ? noteId : baseId;
  if (action === 1) return amount > 1 ? noteId : baseId;
  return baseId;
}

function collect(player, action, slot = viewing.get(player), forceNotes = false) {
  const offer = completedOffers(player)[slot];
  if (!offer?.finished) return;
  const inventory = player.getInventory();
  const parts = [];
  // Each part lands on a copy first, so a collection that does not fit hands over nothing.
  const results = new Map();
  for (const paid of payout(offer)) {
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
    });
  }
  delete completedOffers(player)[slot];
  saveOffers(player);
  const sender = player.getPacketSender();
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
  saveOffers(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(786, [], marketVarps(slot, offer), undefined,
    { [COLLECTIONS[slot]]: collection(offer) });
  refreshCollectionBox(player);
  sender.sendVarbit(SELECTED_SLOT, 0).sendVarbit(SELECTED_SLOT, slot + 1);
  sender.sendMessage("Abort request acknowledged. Please be aware that your offer may have already been completed.");
}

/** The Collect button (465:6, dynamic child 0): op 1 to the inventory (as notes), op 2 to the bank. */
function collectAll(player, action) {
  const to = action === 2 ? 3 : 1;
  for (const slot of Object.keys(completedOffers(player)).map(Number)) collect(player, to, slot, to === 1);
}

function openGrandExchange({ player }) {
  // "grand-exchange:can-open": other content may keep a player out (an Ironman).
  const request = { player, allow: true, message: null };
  pluginApi.emitCustomEvent("grand-exchange:can-open", request);
  if (!request.allow) {
    if (request.message) player.sendMessage(request.message);
    return true;
  }
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "grand-exchange", resume: () => openGrandExchange({ player }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  if ([GE, GE_COLLECT].includes(player.getInterfaceId())) player.getPacketSender().sendInterfaceRemoval();
  if (player.busy()) {
    player.sendMessage("Finish what you are doing before opening the Grand Exchange.");
    return true;
  }
  player.getMovementQueue().reset();
  player.getSkillManager().stopSkillable();
  home(player);
  const sender = player.getPacketSender();
  player.setInterfaceId(GE);
  sender.sendVarbit(13139, 0)
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
  const sender = player.getPacketSender();
  if ([GE, GE_COLLECT].includes(player.getInterfaceId())) sender.sendInterfaceRemoval();
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
    for (const index of Object.keys(completedOffers(player)).map(Number)) collect(player, child === 4 ? 3 : 1, index, child === 3);
  } else if (child >= 5 && child <= 12 && slot === 3 && action >= 1 && action <= 3) {
    collect(player, action, child - 5);
  }
  return true;
}

function handleInventoryItem(event) {
  // The cache has used both 467:0 and the normal inventory id for this
  // mounted panel. The item/slot validation is the reliable discriminator.
  if (event.player.getInterfaceId() !== GE) return false;
  const item = event.player.getInventory().getItems()[event.slot];
  if (item?.getId() === event.itemId && validItem(event.itemId)) {
    if (!exchangeable(event.itemId)) {
      event.player.sendMessage("That item can't be traded on the Grand Exchange.");
      return true;
    }
    start(event.player, true, offers.get(event.player)?.slot ?? 0, event.itemId);
    return true;
  }
  return false;
}

function handleExchangeButton({ player, buttonId, slot, action }) {
  if (player.getInterfaceId() !== GE) return true;
  if (buttonId === uid(24) && action >= 1 && action <= 3) { collect(player, action); return true; }
  // Child 1 of 465:6 is Repeat Offer (script 793), not handled here.
  if (buttonId === uid(6) && slot === 0 && (action === 1 || action === 2)) { collectAll(player, action); return true; }
  if (buttonId === uid(23) && action === 1) {
    if (slot === 0) abort(player);
    else player.sendMessage("To change an offer, abort it, collect, and place a new one.");
    return true;
  }
  if (action !== 1) return true;
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
    offer.quantity = slot === 6 && offer.sell ? player.getInventory().getAmount(offer.itemId)
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

const COLLECTION_BUTTONS = Array.from({ length: 10 }, (_, i) => collectUid(i + 3));
// Child 34 is the offer setup panel; its quantity and price controls are dynamic children (slot 1-13).
const EXCHANGE_BUTTONS = [uid(4), uid(6), uid(23), uid(24), uid(26), uid(30), uid(34), ...Array.from({ length: 8 }, (_, i) => uid(i + 7))];

module.exports = {
  name: "GrandExchange",
  _test: {
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
    LIMITS_ATTRIBUTE,
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
    api.onPlayerLogin(({ player }) => {
      for (const offer of Object.values(completedOffers(player))) scheduleCompletion(player, offer);
    });
    api.onPlayerProcess(({ player }) => {
      if (searching.has(player) && player.getInterfaceId() !== GE) closeSearch(player);
    });
    api.onPlayerLogout(({ player }) => {
      searching.delete(player);
      for (const timer of completionTimers.get(player) ?? []) clearTimeout(timer);
      completionTimers.delete(player);
    });
    api.registerContentEndpoint("item-prices", itemPricesResource);
    api.registerCommand("ge", openGrandExchange, undefined, "Open the Grand Exchange");
    api.registerCommand("gecollect", openCollectionBox, undefined, "Open the Grand Exchange collection box");

    api.onNpcInteraction("Grand Exchange Clerk", { "Exchange": openGrandExchange });
    api.onNpcsInteraction(["Banker", "Ashuelot Reis", "Fadli"], { "Collect": openCollectionBox });

    api.onObjectInteraction("Bank booth", { "Collect": openCollectionBox });
    api.onObjectInteraction("Grand Exchange booth", {
      "Exchange": openGrandExchange,
      "Collect": openCollectionBox,
    });
    api.onObjectInteraction("Bank chest", {
      "Collect": openCollectionBox,
    });
    api.onObjectInteraction("Bank Chest", {
      "Collect": openCollectionBox,
    });
    api.onObjectInteraction("Chest", {
      "Collect": openCollectionBox,
    });

    api.onInterfaceActionButton(COLLECTION_BUTTONS, handleCollectionButton);
    api.onItemFirstAction(handleInventoryItem);
    api.onInterfaceActionButton(SIDE_ITEMS, (event) => event.action === 1 && handleInventoryItem(event));
    api.onInterfaceActionButton(EXCHANGE_BUTTONS, handleExchangeButton);
  },
};
