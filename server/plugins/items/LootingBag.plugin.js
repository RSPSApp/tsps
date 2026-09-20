const { ItemOnGroundManager } = require("../../src/main/typescript/elvarg/game/entity/impl/grounditem/ItemOnGroundManager");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const Food = require("./Food.plugin");
const Potions = require("./Potions.plugin");
const LootKeys = require("./LootKeys.plugin");

const BAG_DATA = "lootingBag";
const DEPOSIT_RESTRICTION = "You can only deposit items into the looting bag in the wilderness";
const CLOSED_BAG_ID = 11941;
const OPEN_BAG_ID = 22586;
const BAG_INVENTORY = 517;
const SIDEBAR_TARGET = (161 << 16) | 74;
const BAG_SIZE = 28;
const BAG_INTERFACE = 81;
const BAG_ITEMS = (BAG_INTERFACE << 16) | 5;
const BAG_TOTAL = (BAG_INTERFACE << 16) | 6;
const ITEM_FLAGS = (1 << 11) - 2;
const pendingDeaths = new WeakMap();
const depositing = new WeakSet();

const isBag = (item) => item?.getDefinition?.()?.getName?.() === "Looting bag";
const bagItems = (bag) => (bag?.getMetaValue?.(BAG_DATA) ?? []).filter((item) =>
  Number.isInteger(item?.id) && item.id > 0 && Number.isInteger(item.amount) && item.amount > 0
);
const setBagItems = (bag, items) => bag.setMetaValue(BAG_DATA, items);
const bagFor = (player) => player.getInventory().getValidItems().find(isBag);
const itemKey = (item) => `${item.getId()}:${JSON.stringify(item.getMeta?.() ?? null)}`;
const isSupply = (id) => Food.isFoodItem(id) || Potions.isPotionItem(id);
const canUseBag = (player) => Wilderness.isIn(player) || LootKeys.isInsideEnclave(player.getLocation?.());
const copyItem = (item, amount = item.getAmount()) => ({
  id: item.getId(), amount, meta: item.getMeta?.() ?? null,
});

function canStore(item) {
  return item?.isValid?.() && item.isTradeable() && !isBag(item);
}

function store(bag, item, amount = item.getAmount()) {
  if (!canStore(item) || amount <= 0) return 0;
  const items = bagItems(bag);
  const existing = items.find((stored) => itemKey(new Item(stored.id, stored.amount, stored.meta)) === itemKey(item));
  if (!existing && items.length >= BAG_SIZE) return 0;
  if (existing) existing.amount += amount;
  else items.push(copyItem(item, amount));
  setBagItems(bag, items);
  return amount;
}

function take(bag, index, amount) {
  const items = bagItems(bag);
  const stored = items[index];
  if (!stored) return 0;
  const taken = Math.min(stored.amount, Math.max(1, amount));
  stored.amount -= taken;
  if (!stored.amount) items.splice(index, 1);
  setBagItems(bag, items);
  return new Item(stored.id, taken, stored.meta);
}

function sendBag(player, deposit = false) {
  const bag = bagFor(player);
  if (!bag) return false;
  if (deposit) depositing.add(player);
  else depositing.delete(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(SIDEBAR_TARGET, BAG_INTERFACE, 3);
  sender.sendString("Looting bag", (BAG_INTERFACE << 16) | 1);
  sender.sendInterfaceFlagsRange(BAG_ITEMS, 0, BAG_SIZE - 1, ITEM_FLAGS);
  sender.sendInterfaceScript(149, [BAG_ITEMS, deposit ? 93 : BAG_INVENTORY, 4, 7, 1, -1, deposit ? "Deposit" : "Withdraw", "", "", "", ""],
    undefined, undefined, { [BAG_INVENTORY]: { capacity: BAG_SIZE,
      slots: bagItems(bag).map((item, slot) => ({ slot, itemId: item.id, quantity: item.amount })) } });
  const value = bagItems(bag).reduce((total, item) => {
    const base = ItemDefinition.forId(item.id).unNote();
    const price = Math.max(1, Math.min(0x7fffffff, Math.floor(ItemDefinition.forId(base).getValue()) || 1));
    return total + price * item.amount;
  }, 0);
  // Match coin stacks in ItemIconRenderer.
  const amount = value >= 10_000_000 ? `${Math.floor(value / 1_000_000)}M`
    : value >= 100_000 ? `${Math.floor(value / 1_000)}K` : String(value);
  const colour = value >= 10_000_000 ? "00ff80" : value >= 100_000 ? "ffffff" : "ffff00";
  sender.sendString(`Value: <col=${colour}>${amount}</col> gp`, BAG_TOTAL);
  return true;
}

function withdraw(player, slot, amount) {
  const bag = bagFor(player);
  const item = bag && bagItems(bag)[slot];
  if (!item) return false;
  const definition = ItemDefinition.forId(item.id);
  const inventory = player.getInventory();
  const stackable = definition.isStackable();
  if (!stackable && inventory.getFreeSlots() < Math.min(item.amount, amount)) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  if (stackable && inventory.getFreeSlots() < 1 && !inventory.getValidItems().some((entry) => entry.getId() === item.id)) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  const moved = take(bag, slot, amount);
  inventory.add(moved, false);
  inventory.refreshItems();
  sendBag(player);
  return true;
}

function itemAction(player, item, option) {
  if (!isBag(item)) return false;
  const action = String(option ?? "").toLowerCase();
  if (action === "open" || action === "close") {
    item.setId(action === "open" ? OPEN_BAG_ID : CLOSED_BAG_ID);
    item.setMetaValue(`${BAG_DATA}:open`, undefined);
    player.getInventory().refreshItems();
    player.sendMessage(`Your Looting bag is now ${action === "open" ? "open" : "closed"}.`);
    return true;
  }
  if (action === "check") return sendBag(player);
  if (action === "deposit") {
    if (!canUseBag(player)) {
      player.sendMessage(DEPOSIT_RESTRICTION);
      return true;
    }
    return sendBag(player, true);
  }
  if (action === "settings") {
    player.sendMessage("Looting bag deposits store as many items as possible.");
    return true;
  }
  if (action !== "destroy") return false;
  const slot = player.getInventory().getItems().indexOf(item);
  if (slot < 0) return true;
  if (canUseBag(player)) {
    for (const stored of bagItems(item)) {
      if (!isSupply(stored.id)) ItemOnGroundManager.registerGlobal(player, new Item(stored.id, stored.amount, stored.meta));
    }
  }
  player.getInventory().deleteAtSlot(slot, 1);
  return true;
}

function handleInterface(event) {
  if (event.groupId !== BAG_INTERFACE) return false;
  if (event.childId !== 5 || !Number.isInteger(event.slot)) return false;
  if (depositing.has(event.player)) {
    if (event.action !== 1) return true;
    const item = event.player.getInventory().getItems()[event.slot];
    const bag = bagFor(event.player);
    if (bag && canStore(item) && item.getId() === event.itemId) {
      depositItem(event.player, bag, itemKey(item), item.getAmount());
      sendBag(event.player, true);
    }
    return true;
  }
  const option = String(event.option ?? "").toLowerCase();
  const amount = option === "" || option.includes("all") ? Number.MAX_SAFE_INTEGER : option.includes("10") ? 10 : option.includes("5") ? 5 : 1;
  if (option.includes("withdraw") || event.action > 0) return withdraw(event.player, event.slot, amount);
  return false;
}

function depositItem(player, bag, key, amount) {
  const inventory = player.getInventory();
  if (!Number.isSafeInteger(amount) || amount <= 0 ||
    !inventory.getItems().includes(bag)) return;
  if (!canUseBag(player)) {
    player.sendMessage(DEPOSIT_RESTRICTION);
    return;
  }
  for (let slot = 0; slot < inventory.capacity() && amount > 0; slot++) {
    const item = inventory.getItems()[slot];
    if (!item?.isValid?.() || itemKey(item) !== key) continue;
    const moved = store(bag, item, Math.min(amount, item.getAmount()));
    if (!moved) break;
    inventory.deleteAtSlot(slot, moved, false);
    amount -= moved;
  }
  inventory.refreshItems();
}

function handleItemOnItem(event) {
  const { player } = event;
  const bag = isBag(event.usedItem) ? event.usedItem : isBag(event.usedWithItem) ? event.usedWithItem : null;
  const item = bag === event.usedItem ? event.usedWithItem : event.usedItem;
  if (!bag) return;
  if (!canUseBag(player)) {
    event.handled = true;
    player.sendMessage(DEPOSIT_RESTRICTION);
    return;
  }
  if (!canStore(item)) return;
  event.handled = true;
  const key = itemKey(item);
  const count = player.getInventory().getValidItems()
    .filter((entry) => itemKey(entry) === key)
    .reduce((total, entry) => total + entry.getAmount(), 0);
  if (count <= 1) return depositItem(player, bag, key, count);
  player.setEnteredAmountAction({ execute: (amount) => depositItem(player, bag, key, amount) });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to store?");
}

module.exports = {
  name: "LootingBag",
  dependsOn: ["Wilderness", "Food", "Potions", "LootKeys"],
  register(api) {
    api.onGroundItemPickup((event) => {
      const bag = bagFor(event.player);
      const item = event.groundItem.getItem();
      if (!bag || bag.getId() !== OPEN_BAG_ID || !canUseBag(event.player)) return;
      if (!canStore(item) || !store(bag, item)) return;
      ItemOnGroundManager.deregister(event.groundItem);
      event.player.getLastItemPickup().reset();
      event.player.sendMessage(`You put the ${item.getDefinition().getName().toLowerCase()} in your Looting bag.`);
      event.handled = true;
    });
    api.onItemOnItem(handleItemOnItem);
    api.onItemAction("Looting bag", {
      Open: ({ player, item }) => itemAction(player, item, "open"),
      Close: ({ player, item }) => itemAction(player, item, "close"),
      Check: ({ player, item }) => itemAction(player, item, "check"),
      Deposit: ({ player, item }) => itemAction(player, item, "deposit"),
      Settings: ({ player, item }) => itemAction(player, item, "settings"),
      Destroy: ({ player, item }) => itemAction(player, item, "destroy"),
    });
    api.onInterfaceActionClick((event) => { if (handleInterface(event)) event.handled = true; });
    api.onPlayerDeathItemDrop((event) => {
      if (!isBag(event.item)) return;
      pendingDeaths.set(event.player, { items: bagItems(event.item), location: event.location });
      event.handled = true;
    });
    api.onPlayerDefeated(({ killer, victim }) => {
      const pending = pendingDeaths.get(victim);
      pendingDeaths.delete(victim);
      if (!pending) return;
      for (const item of pending.items) {
        if (!isSupply(item.id)) ItemOnGroundManager.registerLocation(killer ?? victim, new Item(item.id, item.amount, item.meta), pending.location);
      }
    });
  },
  _test: { bagItems, canStore, isBag, store },
};
