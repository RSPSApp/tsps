/**
 * The looting bag (docs/looting-bag.md), from the Wiki and rsprox captures 448-464 (rev 233),
 * 821 (rev 234) and 1541/1545 (rev 224). Items go in only in the Wilderness (and the Ferox
 * Enclave), through Deposit, by using them on the bag, or by picking them up while it is open; they
 * come out only at a bank, by destroying the bag or by dying. Check only shows the contents.
 */
const { ItemOnGroundManager } = require("../../src/main/typescript/elvarg/game/entity/impl/grounditem/ItemOnGroundManager");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { MAX_STACK_AMOUNT } = require("../../src/main/typescript/elvarg/game/model/container/StackType");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const Food = require("./Food.plugin");
const Potions = require("./Potions.plugin");
const { isInsideEnclave } = require("../areas/ferox/Bounds.FeroxEnclave");

const BAG_DATA = "lootingBag";
/** Settings: store everything used on the bag without asking; keep picked-up supplies out of it. */
const STORE_ALL_ATTRIBUTE = "looting-bag:store-everything";
const SKIP_SUPPLIES_ATTRIBUTE = "looting-bag:skip-supplies";
const CLOSED_BAG_ID = 11941;
const OPEN_BAG_ID = 22586;
/** inv looting_bag, which the bag's interface and the bank's looting bag view draw. */
const BAG_INVENTORY = 516;
/** inv inv: the deposit view draws the player's own inventory. */
const PLAYER_INVENTORY = 93;
const SIDEBAR_TARGET = (161 << 16) | 74;
const BAG_SIZE = 28;
/** wilderness_lootingbag and its items and total components. */
const BAG_INTERFACE = 81;
const BAG_ITEMS = (BAG_INTERFACE << 16) | 5;
const BAG_TOTAL = (BAG_INTERFACE << 16) | 6;
/** wilderness_lootingbag_setup (title, deposit) and wilderness_lootingbag_setprices (inv, 28 prices). */
const SETUP_SCRIPT = 495;
const PRICES_SCRIPT = 1235;
/** Captured if_setevents on wilderness_lootingbag:items: Examine to check; Store-1/5/All/X and Examine to deposit. */
const CHECK_FLAGS = 1 << 10;
const DEPOSIT_FLAGS = 0b11110 | (1 << 9);
const STORE_OPS = { 1: 1, 2: 5, 3: Number.MAX_SAFE_INTEGER };
const STORE_X_OP = 4;
/** The bank's looting bag view (captured): bank_viewcontainer 1, its items' OP1-OP7 and OP10. */
const BANK_VIEW = 1;
const BANK_VIEW_OP = 1;
const BANK_ITEM_FLAGS = 0b11111110 | (1 << 10);
const BANK_SIDE = 15;
const BANK_X_PROMPT_OP = 6;
/** bank_requestedquantity: the bank's remembered X. */
const BANK_X_VARBIT = 3960;
const AMOUNT_PROMPT = "Enter amount:";
const MESSAGE = {
  WILDERNESS_ONLY: "You can't put items in the looting bag unless you're in the Wilderness.",
  UNTRADEABLE: "Only tradeable items can be put in the bag.",
  BAGCEPTION: "You may be surprised to learn that bagception is not permitted.",
  FULL: "The bag's too full.",
  PICKUP_FULL: "You don't have space in your looting bag for that.",
  OPEN: "You open your looting bag, ready to fill it.",
  CLOSE: "You close your looting bag.",
  STORE_ALL: "When using items on the bag, you will immediately store as many of that item as possible in the bag.",
  ASK: "When using items on the bag, you will be asked how many of that item you wish to store in the bag.",
  SKIP_SUPPLIES: "Food and potions will not go into an open looting bag when picked up.",
  TAKE_SUPPLIES: "Food and potions will automatically go into an open looting bag when picked up.",
  DESTROY_QUESTION: "Are you sure you want to destroy the bag?",
  DESTROY_FULL: "If you destroy it, the contents will be lost.",
  DESTROY_EMPTY: "The bag is empty. Are you sure you want to destroy it?",
};
const pendingDeaths = new WeakMap();
const depositing = new WeakSet();

let api = null;
let core = null;

const isBag = (item) => item?.getDefinition?.()?.getName?.() === "Looting bag";
const bagItems = (bag) => (bag?.getMetaValue?.(BAG_DATA) ?? []).filter((item) =>
  Number.isInteger(item?.id) && item.id > 0 && Number.isInteger(item.amount) && item.amount > 0
);
const setBagItems = (bag, items) => bag.setMetaValue(BAG_DATA, items);
const bagFor = (player) => player.getInventory().getValidItems().find(isBag);
const itemKey = (item) => `${item.getId()}:${JSON.stringify(item.getMeta?.() ?? null)}`;
const entryKey = (entry) => `${entry.id}:${JSON.stringify(entry.meta ?? null)}`;
const isStackable = (id) => ItemDefinition.forId(id).isStackable();
const isSupply = (id) => {
  const base = ItemDefinition.forId(id).unNote();
  return Food.isFoodItem(base) || Potions.isPotionItem(base);
};
// Destroying the bag in the wilderness drops what survives to the floor: un-noted
// food, potions and vials of water are destroyed outright, while noted items (and
// everything else) drop where anyone can pick them up.
const isDestroyedOnDestroy = (id) => !ItemDefinition.forId(id).isNoted()
  && (isSupply(id) || id === ItemIdentifiers.VIAL_OF_WATER);
const canUseBag = (player) => Wilderness.isIn(player) || isInsideEnclave(player.getLocation?.());
const setting = (player, key) => player.getAttribute(key) === true;

function canStore(item) {
  return item?.isValid?.() && item.isTradeable() && !isBag(item);
}

/**
 * How much of `entry` (`{ id, amount, meta }`) the bag can take: 28 slots, where stackable items
 * stack as they do in the inventory, up to the same maximum stack, and every other item takes a
 * slot of its own (Wiki).
 */
function room(items, entry) {
  if (isStackable(entry.id)) {
    const existing = items.find((stored) => entryKey(stored) === entryKey(entry));
    if (existing) return Math.min(entry.amount, Math.max(0, MAX_STACK_AMOUNT - existing.amount));
    return items.length < BAG_SIZE ? Math.min(entry.amount, MAX_STACK_AMOUNT) : 0;
  }
  return Math.min(entry.amount, BAG_SIZE - items.length);
}

/** Puts up to `entry.amount` into the bag, as much as fits; returns how much went in. */
function storeEntry(bag, entry) {
  const items = bagItems(bag);
  const amount = room(items, entry);
  if (amount <= 0) return 0;
  const existing = isStackable(entry.id) && items.find((stored) => entryKey(stored) === entryKey(entry));
  if (existing) existing.amount += amount;
  else if (isStackable(entry.id)) items.push({ id: entry.id, amount, meta: entry.meta ?? null });
  else for (let n = 0; n < amount; n++) items.push({ id: entry.id, amount: 1, meta: entry.meta ?? null });
  setBagItems(bag, items);
  return amount;
}

function store(bag, item, amount = item.getAmount()) {
  if (!canStore(item) || amount <= 0) return 0;
  return storeEntry(bag, { id: item.getId(), amount, meta: item.getMeta?.() ?? null });
}

/** The unnoted item's Grand Exchange guide price: the bag's interfaces price check their items (Wiki). */
function price(id) {
  const definition = ItemDefinition.forId(ItemDefinition.forId(id).unNote());
  return Math.max(0, Math.floor(definition.getGrandExchangeValue?.() ?? 0) || 0);
}

function valueText(label, entries) {
  if (!entries.length) return `${label}: -`;
  const total = entries.reduce((sum, entry) => sum + price(entry.id) * entry.amount, 0);
  return `${label}: ${Math.min(total, Number.MAX_SAFE_INTEGER).toLocaleString("en-US")} coins`;
}

function sendContents(player, bag) {
  player.getPacketSender().sendInventory(BAG_INVENTORY, BAG_SIZE, bagItems(bag));
}

/** The total line and the per-slot prices of what the open view shows, as live sends after each change. */
function sendTotals(player, bag, deposit) {
  const sender = player.getPacketSender();
  const entries = bagItems(bag);
  sender.sendString(valueText(deposit ? "Bag value" : "Value", entries), BAG_TOTAL);
  const shown = deposit
    ? player.getInventory().getItems().slice(0, BAG_SIZE).map((item) => (item?.isValid?.() ? { id: item.getId() } : null))
    : entries;
  const prices = Array.from({ length: BAG_SIZE }, (_, slot) => BigInt(shown[slot] ? price(shown[slot].id) : -1));
  sender.sendInterfaceScript(PRICES_SCRIPT, [deposit ? PLAYER_INVENTORY : BAG_INVENTORY, ...prices]);
}

/** Check (the bag's contents, examine only) or Deposit (the inventory, Store-1/5/All/X), as captured. */
function sendBag(player, deposit = false) {
  const bag = bagFor(player);
  if (!bag) return false;
  if (deposit) depositing.add(player);
  else depositing.delete(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(SIDEBAR_TARGET, BAG_INTERFACE, 3);
  sendContents(player, bag);
  sender.sendInterfaceFlagsRange(BAG_ITEMS, 0, BAG_SIZE - 1, deposit ? DEPOSIT_FLAGS : CHECK_FLAGS);
  sendTotals(player, bag, deposit);
  sender.sendInterfaceScript(SETUP_SCRIPT, [deposit ? "Add to bag" : "Looting bag", deposit ? 1 : 0]);
  return true;
}

/** Why `item` can't go into the bag right now, or null when some of it can. */
function refusal(player, bag, item) {
  if (!canUseBag(player)) return MESSAGE.WILDERNESS_ONLY;
  if (isBag(item)) return MESSAGE.BAGCEPTION;
  if (!item?.isValid?.() || !item.isTradeable()) return MESSAGE.UNTRADEABLE;
  if (!room(bagItems(bag), { id: item.getId(), amount: 1, meta: item.getMeta?.() ?? null })) return MESSAGE.FULL;
  return null;
}

/** Moves up to `amount` of the inventory's `key` items into the bag, from the first slot holding one. */
function depositItem(player, bag, key, amount) {
  const inventory = player.getInventory();
  if (!Number.isSafeInteger(amount) || amount <= 0 || !inventory.getItems().includes(bag)) return;
  const first = inventory.getItems().find((item) => item?.isValid?.() && itemKey(item) === key);
  if (!first) return;
  const refused = refusal(player, bag, first);
  if (refused) return void player.sendMessage(refused);
  for (let slot = 0; slot < inventory.capacity() && amount > 0; slot++) {
    const item = inventory.getItems()[slot];
    if (!item?.isValid?.() || itemKey(item) !== key) continue;
    const moved = store(bag, item, Math.min(amount, item.getAmount()));
    if (!moved) break;
    inventory.deleteAtSlot(slot, moved, false);
    amount -= moved;
  }
  inventory.refreshItems();
  if (depositing.has(player)) {
    sendContents(player, bag);
    sendTotals(player, bag, true);
  }
}

function inventoryCount(player, key) {
  return player.getInventory().getValidItems()
    .filter((entry) => itemKey(entry) === key)
    .reduce((total, entry) => total + entry.getAmount(), 0);
}

function askAmount(player, done) {
  player.setEnteredAmountAction({ execute: (amount) => done(amount) });
  player.getPacketSender().sendEnterAmountPrompt(AMOUNT_PROMPT);
}

/** The captured "How many do you want to deposit?" choices for `count` of an item. */
function depositChoices(count) {
  if (count === 2) return [["One", 1], ["Both", 2]];
  if (count === 3) return [["One", 1], ["Two", 2], ["All", 3]];
  if (count === 4) return [["One", 1], ["All", 4], ["X", null]];
  return [["One", 1], ["Five", 5], ["All", count], ["X", null]];
}

function askHowMany(player, bag, key, count) {
  const deposit = (amount) => depositItem(player, bag, key, amount);
  const pairs = depositChoices(count).flatMap(([text, amount]) =>
    [text, () => (amount === null ? askAmount(player, deposit) : deposit(amount))]);
  api.sendMultiChatboxPrompt(player, "How many do you want to deposit?", ...pairs);
}

function useItemOnBag(event) {
  const { player } = event;
  const bag = isBag(event.usedItem) ? event.usedItem : isBag(event.usedWithItem) ? event.usedWithItem : null;
  if (!bag) return;
  const item = bag === event.usedItem ? event.usedWithItem : event.usedItem;
  event.handled = true;
  const refused = refusal(player, bag, item);
  if (refused) return void player.sendMessage(refused);
  const key = itemKey(item);
  const count = inventoryCount(player, key);
  if (count <= 1 || setting(player, STORE_ALL_ATTRIBUTE)) return depositItem(player, bag, key, count);
  askHowMany(player, bag, key, count);
}

/** Store-1/5/All/X in the Deposit view; Check offers only Examine, so nothing comes out of the bag here. */
function clickBagInterface(event) {
  if (event.groupId !== BAG_INTERFACE || event.childId !== 5 || !Number.isInteger(event.slot)) return;
  const { player } = event;
  if (!depositing.has(player)) return;
  const item = player.getInventory().getItems()[event.slot];
  const bag = bagFor(player);
  if (!bag || !item?.isValid?.() || item.getId() !== event.itemId) return;
  const op = Number(event.action);
  const key = itemKey(item);
  if (op === STORE_X_OP) {
    event.handled = true;
    askAmount(player, (amount) => depositItem(player, bag, key, amount));
  } else if (STORE_OPS[op]) {
    event.handled = true;
    depositItem(player, bag, key, Math.min(STORE_OPS[op], inventoryCount(player, key)));
  }
}

function openBag({ player, item }) {
  if (!isBag(item)) return false;
  item.setId(OPEN_BAG_ID);
  item.setMetaValue(`${BAG_DATA}:open`, undefined);
  player.getInventory().refreshItems();
  player.sendMessage(MESSAGE.OPEN);
  return true;
}

function closeBag({ player, item }) {
  if (!isBag(item)) return false;
  item.setId(CLOSED_BAG_ID);
  item.setMetaValue(`${BAG_DATA}:open`, undefined);
  player.getInventory().refreshItems();
  player.sendMessage(MESSAGE.CLOSE);
  return true;
}

function checkBag({ player, item }) {
  return isBag(item) && sendBag(player);
}

function depositOption({ player, item }) {
  if (!isBag(item)) return false;
  if (!canUseBag(player)) {
    player.sendMessage(MESSAGE.WILDERNESS_ONLY);
    return true;
  }
  return sendBag(player, true);
}

function toggle(player, key, on, off) {
  const value = !setting(player, key);
  player.setAttribute(key, value);
  player.sendMessage(value ? on : off);
}

/** The captured two-line settings menu: each line names the opposite of the current choice. */
function settings({ player, item }) {
  if (!isBag(item)) return false;
  const storeAll = setting(player, STORE_ALL_ATTRIBUTE);
  const skipSupplies = setting(player, SKIP_SUPPLIES_ATTRIBUTE);
  api.sendMultiChatboxPrompt(player, "Select an option",
    storeAll ? "Ask how many items to store when using items on the bag." : "Store everything when using items on the bag.",
    () => toggle(player, STORE_ALL_ATTRIBUTE, MESSAGE.STORE_ALL, MESSAGE.ASK),
    skipSupplies ? "Put supplies into the looting bag." : "Don't put supplies into the looting bag.",
    () => toggle(player, SKIP_SUPPLIES_ATTRIBUTE, MESSAGE.SKIP_SUPPLIES, MESSAGE.TAKE_SUPPLIES));
  return true;
}

/** The shared destroy confirmation, worded for the bag as live words it. */
function destroyPrompt(event) {
  if (!isBag(event.item)) return;
  event.question = MESSAGE.DESTROY_QUESTION;
  event.warning = bagItems(event.item).length ? MESSAGE.DESTROY_FULL : MESSAGE.DESTROY_EMPTY;
}

/**
 * A confirmed Destroy (the destroy prompt's second drop-policy pass). In the wilderness the
 * surviving contents drop to the floor, where everyone can see and pick them up; un-noted food,
 * potions and vials of water are destroyed instead, and noted items drop. Outside the wilderness
 * (including inside the Ferox Enclave) every stored item is lost.
 */
function destroyBag(event) {
  if (!isBag(event.item) || event.dropToGround !== false) return;
  const { player, item } = event;
  const slot = player.getInventory().getItems().indexOf(item);
  if (slot < 0) return;
  if (Wilderness.isIn(player)) {
    for (const stored of bagItems(item)) {
      if (isDestroyedOnDestroy(stored.id)) continue;
      ItemOnGroundManager.registerGlobal(player, new Item(stored.id, stored.amount, stored.meta));
    }
  }
  player.getInventory().deleteAtSlot(slot, 1);
  event.handled = true;
}

/** An open bag in the Wilderness takes what is picked up, unless it is a supply the player keeps out. */
function pickUp(event) {
  const { player } = event;
  const bag = bagFor(player);
  const item = event.groundItem.getItem();
  if (!bag || bag.getId() !== OPEN_BAG_ID || !canUseBag(player) || !canStore(item)) return;
  if (setting(player, SKIP_SUPPLIES_ATTRIBUTE) && isSupply(item.getId())) return;
  if (room(bagItems(bag), { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null }) < item.getAmount()) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE.PICKUP_FULL);
    return;
  }
  store(bag, item);
  ItemOnGroundManager.deregister(event.groundItem);
  player.getLastItemPickup().reset();
  player.sendMessage(`You put the ${item.getDefinition().getName().toLowerCase()} in your Looting bag.`);
  event.handled = true;
}

function bankViewing(player) {
  const { Bank } = core;
  return Bank.isOpen(player) && player.getPacketSender().getVarbit(Bank.VIEW_CONTAINER_VARBIT) === BANK_VIEW;
}

function bankComponents() {
  const id = (name) => core.CacheDefinitions.getComponentId(name);
  return { items: id("bankside:lootingbag_items"), bankAll: id("bankside:lootingbag_bankall"), dismiss: id("bankside:lootingbag_dismiss") };
}

/** The bag's op1 in the bank's inventory panel shows its contents in place of the inventory. */
function viewInBank(event) {
  if (!isBag(event.item) || event.op !== BANK_VIEW_OP) return;
  event.handled = true;
  const { player, item } = event;
  const { Bank } = core;
  const sender = player.getPacketSender();
  if (sender.getVarbit(Bank.VIEW_CONTAINER_VARBIT) !== BANK_VIEW) sender.sendVarbit(Bank.VIEW_CONTAINER_VARBIT, BANK_VIEW);
  sender.sendConfig(Bank.VIEW_CONTAINER_OBJ_VARP, item.getId());
  sendContents(player, item);
  sender.sendInterfaceFlagsRange(bankComponents().items, 0, BAG_SIZE - 1, BANK_ITEM_FLAGS);
}

function dismissBankView(player) {
  const { Bank } = core;
  player.getPacketSender().sendVarbit(Bank.VIEW_CONTAINER_VARBIT, 0).sendConfig(Bank.VIEW_CONTAINER_OBJ_VARP, -1);
}

function refreshBank(player) {
  const { Bank } = core;
  if (player.isSearchingBank()) player.getBank(Bank.BANK_SEARCH_TAB_INDEX).refreshItems();
  else player.getBank(player.getCurrentBankTab()).refreshItems();
}

/** Banks up to `amount` of the bag's slot `slot`: a stack from that slot, single items from it onwards. */
function bankSlot(player, bag, slot, amount) {
  const items = bagItems(bag);
  const entry = items[slot];
  if (!entry || amount <= 0) return false;
  const tab = player.getBank(core.Bank.getTabForItem(player, entry.id));
  const slots = isStackable(entry.id) ? [slot]
    : [slot, ...items.map((_, index) => index).filter((index) => index !== slot && entryKey(items[index]) === entryKey(entry))];
  let left = amount;
  const emptied = new Set();
  for (const index of slots) {
    if (left <= 0) break;
    const stored = items[index];
    const moving = Math.min(stored.amount, left);
    const banked = new Item(stored.id, moving, stored.meta);
    if (tab.getAddableAmount(banked) < moving) {
      tab.full();
      break;
    }
    tab.add(banked, false);
    stored.amount -= moving;
    left -= moving;
    if (!stored.amount) emptied.add(index);
  }
  setBagItems(bag, items.filter((_, index) => !emptied.has(index)));
  return left < amount;
}

function bankAll(player, bag) {
  while (bagItems(bag).length) {
    if (!bankSlot(player, bag, 0, bagItems(bag)[0].amount)) break;
  }
}

/** "Deposit loot", "Dismiss" and the Deposit-1/5/10/X/All ops on the bank's looting bag view. */
function clickBankView(event) {
  if (event.groupId !== BANK_SIDE) return;
  const { items, bankAll: bankAllButton, dismiss } = bankComponents();
  const buttonId = (event.groupId << 16) | event.childId;
  if (buttonId !== items && buttonId !== bankAllButton && buttonId !== dismiss) return;
  event.handled = true;
  const { player } = event;
  const bag = bagFor(player);
  if (!bankViewing(player) || !bag) return;
  if (buttonId === dismiss) return dismissBankView(player);
  if (buttonId === bankAllButton) bankAll(player, bag);
  else if (Number.isInteger(event.slot)) {
    const entry = bagItems(bag)[event.slot];
    if (!entry) return;
    const op = Number(event.action);
    if (op === BANK_X_PROMPT_OP) {
      return askAmount(player, (amount) => {
        if (!(amount > 0)) return;
        player.setBankCustomQuantity(amount);
        player.getPacketSender().sendVarbit(BANK_X_VARBIT, amount);
        if (!bankViewing(player) || bagFor(player) !== bag) return;
        bankSlot(player, bag, event.slot, amount);
        refreshBank(player);
        sendContents(player, bag);
      });
    }
    const available = bagItems(bag).filter((stored) => entryKey(stored) === entryKey(entry))
      .reduce((total, stored) => total + stored.amount, 0);
    const amount = core.Bank.actionAmount("withdraw", op, event.option, available,
      player.getBankCustomQuantity(), player.getBankQuantityMode());
    bankSlot(player, bag, event.slot, amount);
  }
  refreshBank(player);
  sendContents(player, bag);
}

function dropOnDeath(event) {
  if (!isBag(event.item)) return;
  pendingDeaths.set(event.player, { items: bagItems(event.item), location: event.location });
  event.handled = true;
}

function giveToKiller({ killer, victim }) {
  const pending = pendingDeaths.get(victim);
  pendingDeaths.delete(victim);
  if (!pending) return;
  for (const item of pending.items) {
    if (!isSupply(item.id)) ItemOnGroundManager.registerLocation(killer ?? victim, new Item(item.id, item.amount, item.meta), pending.location);
  }
}

/**
 * "looting-bag:store" `{ player, items: [{ id, amount }], check?, result }`: another plugin puts loot
 * straight into the player's open bag (the Wilderness Agility dispenser). `result` is "no-bag" without
 * an open bag in the inventory, "full" when not all of `items` fit, else "stored" (nothing is stored
 * when `check` is set, or on "full").
 */
function storeLoot(event) {
  const bag = bagFor(event.player);
  if (!bag || bag.getId() !== OPEN_BAG_ID) return void (event.result = "no-bag");
  const trial = bagItems(bag).map((entry) => ({ ...entry }));
  const fits = event.items.every(({ id, amount }) => {
    const entry = { id, amount, meta: null };
    if (room(trial, entry) < amount) return false;
    const existing = isStackable(id) && trial.find((stored) => entryKey(stored) === entryKey(entry));
    if (existing) existing.amount += amount;
    else for (let n = 0; n < (isStackable(id) ? 1 : amount); n++) trial.push(entry);
    return true;
  });
  if (!fits) return void (event.result = "full");
  event.result = "stored";
  if (event.check) return;
  for (const { id, amount } of event.items) storeEntry(bag, { id, amount, meta: null });
}

/** Public read-only contents query; the bag owner keeps its metadata private. */
function answerContents(event) {
  if (!isBag(event.item)) return;
  event.contents.push(...bagItems(event.item).map(({ id, amount }) => ({ id, amount })));
  event.handled = true;
}

module.exports = {
  name: "LootingBag",
  members: true,
  dependsOn: ["Wilderness", "Food", "Potions", "LootKeys"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(STORE_ALL_ATTRIBUTE, false);
    api.persistAttribute(SKIP_SUPPLIES_ATTRIBUTE, false);
    api.onCustomEvent("storage:contents", answerContents);
    api.onCustomEvent("looting-bag:store", storeLoot);
    api.onCustomEvent("destroy-item:prompt", destroyPrompt);
    api.onCustomEvent(core.Bank.INVENTORY_OP_EVENT, viewInBank);
    api.onGroundItemPickup(pickUp);
    api.onItemOnItem(useItemOnBag);
    api.onItemAction("Looting bag", { Open: openBag, Close: closeBag, Check: checkBag, Deposit: depositOption, Settings: settings });
    api.onItemDropPolicy(destroyBag);
    api.onInterfaceActionClick(clickBagInterface);
    api.onInterfaceActionClick(clickBankView);
    api.onPlayerDeathItemDrop(dropOnDeath);
    api.onPlayerDefeated(giveToKiller);
  },
  _test: { bagItems, canStore, isBag, store, storeLoot, depositChoices, room, valueText },
};
