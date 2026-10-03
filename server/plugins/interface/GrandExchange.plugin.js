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
const PRICE = 4398;
const SELECTED_ITEM = 1151;
// Cache script 5733 reads pending client requests here, not accepted offers.
// Keep them separate from the stockmarket opcode data.
const OFFER_ITEMS = [3204, 3206, 3208, 3210, 3212, 3214, 3216, 3218];
const COLLECTIONS = [518, 519, 520, 521, 522, 523, 539, 540];
const MARKET_BASE = 7900;
const MARKET_STRIDE = 7;
const FINISHED = 5;
const OFFER_DELAY_MS = 5000;
const MAX = 0x7fffffff;
const COINS = ItemIdentifiers.COINS;
// OSRS: members get all 8 offer slots, free-to-play worlds the first 3.
const usableSlots = () => (pluginApi.core.WorldDefinition.isMembersWorld() ? 8 : 3);
const offers = new WeakMap();
const completionTimers = new WeakMap();
const viewing = new WeakMap();
const searching = new WeakSet();
let pluginApi;

function validItem(id) {
  if (!CacheDefinitions.hasItem(id)) return false;
  const name = CacheDefinitions.getItem(id)?.name;
  return Boolean(name && name !== "null");
}

function price(id) {
  // OSRS market quote from item-prices.json; store value for unquoted/custom items.
  const base = ItemDefinition.forId(id).unNote();
  return Math.max(1, Math.min(MAX, Math.floor(ItemDefinition.forId(base).getGrandExchangeValue()) || 1));
}

function active(player, offer) {
  return player.getInterfaceId() === GE && offers.get(player) === offer;
}

function completedOffers(player) {
  let slots = player.getAttribute("grand-exchange-offers");
  if (!slots) player.setAttribute("grand-exchange-offers", slots = {});
  return slots;
}

function saveOffers(player) {
  GameConstants.PLAYER_PERSISTENCE.save(player);
}

function scheduleCompletion(player, offer) {
  if (offer.finished) return;
  let timers = completionTimers.get(player);
  if (!timers) completionTimers.set(player, timers = new Set());
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (completedOffers(player)[offer.slot] !== offer) return;
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
    [base]: offer ? price(offer.itemId) : 0,
    [base + 1]: offer?.quantity ?? 0,
    [base + 2]: offer?.finished ? offer.quantity : 0,
    [base + 3]: offer?.finished ? offer.total : 0,
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

function collection(offer) {
  return {
    capacity: 2,
    slots: offer?.finished ? [{
      slot: 0,
      itemId: offer.sell ? COINS : offer.itemId,
      quantity: offer.sell ? offer.total : offer.quantity,
    }] : [],
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
    .sendVarbit(PRICE, offer.itemId > 0 ? price(offer.itemId) : 1)
    .sendVarbit(SELECTED_SLOT, offer.slot + 1);
}

function home(player) {
  closeSearch(player);
  offers.delete(player);
  viewing.delete(player);
  player.setEnteredAmountAction(null);
  player.setEnteredSyntaxAction(null);
  player.getPacketSender()
    .sendConfig(SELECTED_ITEM, -1)
    .sendVarbit(SELL, 0)
    .sendVarbit(QUANTITY, 1)
    .sendVarbit(PRICE, 1)
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
  player.setEnteredAmountAction(null);
  player.setEnteredSyntaxAction(null);
  player.getPacketSender()
    .sendConfig(SELECTED_ITEM, -1)
    .sendVarbit(SELECTED_SLOT, 0)
    .sendVarbit(SELECTED_SLOT, slot + 1);
}

function chooseItem(player, offer) {
  if (offer.sell) {
    player.sendMessage("Choose an item from your inventory to sell.");
    return;
  }
  player.setEnteredSyntaxAction({ execute: (input) => {
    if (!active(player, offer)) return;
    const id = Number(input);
    if (!validItem(id)) return;
    closeSearch(player);
    offer.itemId = id;
    offer.quantity = 1;
    refresh(player, offer);
  } });
  searching.add(player);
  player.getPacketSender().sendInterfaceScript(750, ["Grand Exchange Item Search", 0, -1, 0]);
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
  const offer = { sell, slot, itemId, quantity: 1 };
  offers.set(player, offer);
  player.setEnteredAmountAction(null);
  player.setEnteredSyntaxAction(null);
  refresh(player, offer);
  if (itemId < 0) chooseItem(player, offer);
}

function confirm(player, offer) {
  if (!active(player, offer) || !validItem(offer.itemId)) return;
  const amount = offer.quantity;
  const total = amount * price(offer.itemId);
  const sender = player.getPacketSender();
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX || !Number.isSafeInteger(total) || total > MAX) {
    sender.sendMessage("Choose a smaller quantity (maximum trade value is 2,147,483,647 coins).");
    return;
  }
  const inventory = player.getInventory();
  const inputId = offer.sell ? offer.itemId : COINS;
  const inputAmount = offer.sell ? amount : total;
  if (inventory.getAmount(inputId) < inputAmount) {
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
  result.deleted(inputId, inputAmount, false);
  if (result.getAmount(inputId) !== inventory.getAmount(inputId) - inputAmount) {
    sender.sendMessage("Trade one item stack at a time.");
    return;
  }
  inventory.setItems(result.getItems()).refreshItems();
  const finished = { ...offer, total, finished: false, completesAt: Date.now() + OFFER_DELAY_MS };
  completedOffers(player)[offer.slot] = finished;
  saveOffers(player);
  offers.delete(player);
  viewing.set(player, offer.slot);
  player.setEnteredAmountAction(null);
  player.setEnteredSyntaxAction(null);
  sender.sendInterfaceScript(786, [], { [SELECTED_ITEM]: -1, ...marketVarps(offer.slot, finished) },
      { [SELECTED_SLOT]: offer.slot + 1 },
      { [COLLECTIONS[offer.slot]]: collection(finished) })
    .sendMessage("Offer placed. It will complete in five seconds.");
  scheduleCompletion(player, finished);

}

function collect(player, action, slot = viewing.get(player)) {
  const offer = completedOffers(player)[slot];
  if (!offer?.finished) return;
  const baseId = offer.sell ? COINS : ItemDefinition.forId(offer.itemId).unNote();
  const noteId = ItemDefinition.forId(baseId).getNoteId();
  const outputId = action === 1 && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : baseId;
  const outputAmount = offer.sell ? offer.total : offer.quantity;
  const inventory = player.getInventory();
  const destination = action === 3 ? player.getBank(Bank.getTabForItem(player, baseId)) : inventory;
  const result = action === 3 ? new Bank(player) : new Inventory(player);
  result.setItems(destination.getCopiedItems());
  const before = result.getAmount(outputId);
  if (before + outputAmount > MAX) {
    player.sendMessage(`You do not have enough ${action === 3 ? "bank" : "inventory"} space to collect that offer.`);
    return;
  }
  result.add(new Item(outputId, outputAmount), false);
  if (result.getAmount(outputId) !== before + outputAmount) {
    player.sendMessage(`You do not have enough ${action === 3 ? "bank" : "inventory"} space to collect that offer.`);
    return;
  }
  destination.setItems(result.getItems());
  if (action !== 3) inventory.refreshItems();
  // Plugins may change what the collection hands over (e.g. a bought bond
  // arrives untradeable) before the offer is cleared and saved below.
  pluginApi.emitCustomEvent("ge:offer-collected", {
    player,
    itemId: outputId,
    amount: outputAmount,
    destination: action === 3 ? "bank" : "inventory",
    container: destination,
  });
  delete completedOffers(player)[slot];
  saveOffers(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(786, [], marketVarps(slot), undefined,
    { [COLLECTIONS[slot]]: collection() });
  if (player.getInterfaceId() === GE) home(player);
  refreshCollectionBox(player);
  sender.sendMessage(`Collected ${outputAmount.toLocaleString("en-US")} x ${ItemDefinition.forId(outputId).getName()}.`);
}

function openGrandExchange({ player }) {
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
    // The GE on-load script reads these before it creates offer widgets.
    // Varp 1151=0 is a real item (Dwarf remains), so clearing it later is
    // visibly too late.
    .sendSubInterface(MAIN_MODAL, GE, 0, {
      varps: { [SELECTED_ITEM]: -1, ...allMarketVarps(player) },
      varbits: { [SELL]: 0, [QUANTITY]: 1, [PRICE]: 1, [SELECTED_SLOT]: 0 },
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
    // Same item operations as the normal inventory panel.
    .sendInterfaceFlagsRange(SIDE_ITEMS, 0, 27, 1086);
  sender.sendMessage("Instant GE: search for an item to buy, or sell from your inventory. Fixed guide prices; no fees.");
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
    for (const index of Object.keys(completedOffers(player)).map(Number)) collect(player, child === 4 ? 3 : 1, index);
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
    start(event.player, true, offers.get(event.player)?.slot ?? 0, event.itemId);
    return true;
  }
  return false;
}

function handleExchangeButton({ player, buttonId, slot, action }) {
  if (player.getInterfaceId() !== GE) return true;
  if (buttonId === uid(24) && action >= 1 && action <= 3) { collect(player, action); return true; }
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
  } else if (slot >= 8 && slot <= 16) {
    player.sendMessage("This exchange uses fixed guide prices.");
  }
  refresh(player, offer);
  return true;
}

const COLLECTION_BUTTONS = Array.from({ length: 10 }, (_, i) => collectUid(i + 3));
const EXCHANGE_BUTTONS = [uid(4), uid(24), uid(26), uid(30), ...Array.from({ length: 8 }, (_, i) => uid(i + 7))];

module.exports = {
  name: "GrandExchange",
  register(api) {
    pluginApi = api;
    api.persistAttribute("grand-exchange-offers");
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
    api.registerCommand("ge", openGrandExchange);
    api.registerCommand("gecollect", openCollectionBox);

    api.onNpcInteraction("Grand Exchange Clerk", { "Exchange": openGrandExchange });
    api.onNpcInteraction("Banker", { "Collect": openCollectionBox });

    api.onObjectInteraction("Bank booth", { "Collect": openCollectionBox });
    api.onObjectInteraction("Grand Exchange booth", {
      "Exchange": openGrandExchange,
      "Collect": openCollectionBox,
    });
    api.onObjectInteraction("Bank chest", {
      "Collect": openCollectionBox,
    });

    api.onInterfaceActionButton(COLLECTION_BUTTONS, handleCollectionButton);
    api.onItemFirstAction(handleInventoryItem);
    api.onInterfaceActionButton(SIDE_ITEMS, (event) => event.action === 1 && handleInventoryItem(event));
    api.onInterfaceActionButton(EXCHANGE_BUTTONS, handleExchangeButton);
  },
};
