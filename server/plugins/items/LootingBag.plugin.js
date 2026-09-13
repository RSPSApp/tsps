const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { ItemOnGroundManager } = require("../../src/main/typescript/elvarg/game/entity/impl/grounditem/ItemOnGroundManager");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const {
  FLAG_OP1,
  FLAG_OP2,
  FLAG_OP3,
  TYPE_LAYER,
  TYPE_RECTANGLE,
  TYPE_TEXT,
  TYPE_GRAPHIC,
  createWidgetGroup,
} = require("../interface/widgetGroup");

const CLOSED_BAG_ID = 11941;
const OPEN_BAG_ID = 22586;
const BAG_IDS = new Set([CLOSED_BAG_ID, OPEN_BAG_ID]);

const BAG_CAPACITY = 28;
const BAG_ATTRIBUTE = "lootingBagContents";
const MAIN_MODAL_UID = (161 << 16) | 16;
const INTERFACE_ID = 30009; // Custom Looting Bag interface

const COMPONENT = {
  ROOT: 0,
  FRAME: 1,
  TITLE: 2,
  CLOSE_BUTTON: 3,
  CONTAINER: 4,
  VALUE_TEXT: 5,
  INVENTORY_CONTAINER: 6,
};

const uid = (comp) => (INTERFACE_ID << 16) | comp;
const CLOSE_BUTTON_UID = uid(COMPONENT.CLOSE_BUTTON);
const CONTAINER_UID = uid(COMPONENT.CONTAINER);
const INVENTORY_CONTAINER_UID = uid(COMPONENT.INVENTORY_CONTAINER);
const VALUE_TEXT_UID = uid(COMPONENT.VALUE_TEXT);

const SLOT_BACKGROUND_START = 100;
const SLOT_ITEM_START = 200;

function isLootingBag(itemOrId) {
  const id = typeof itemOrId === "number" ? itemOrId : itemOrId?.getId?.() ?? itemOrId?.id;
  return BAG_IDS.has(id);
}

function isOpenBag(itemOrId) {
  const id = typeof itemOrId === "number" ? itemOrId : itemOrId?.getId?.() ?? itemOrId?.id;
  return id === OPEN_BAG_ID;
}

function getBagItems(player) {
  const raw = player.getAttribute?.(BAG_ATTRIBUTE);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => Number.isInteger(item?.id) && item.id > 0 && Number.isInteger(item?.amount) && item.amount > 0);
}

function setBagItems(player, items) {
  player.setAttribute?.(BAG_ATTRIBUTE, items.filter((item) => Number.isInteger(item?.id) && item.id > 0 && Number.isInteger(item?.amount) && item.amount > 0));
}

function countBagItems(player) {
  return getBagItems(player).length;
}

function hasBagSpace(player, itemId, amount) {
  const items = getBagItems(player);
  const def = ItemDefinition.forId(itemId);
  const isStackable = def?.isStackable?.() === true;
  if (isStackable) {
    const existing = items.find((i) => i.id === itemId);
    if (existing) return true;
  }
  return items.length < BAG_CAPACITY;
}

function itemValue(item) {
  return (ItemDefinition.forId(item?.id ?? item?.getId?.())?.getValue?.() ?? 0) * (item?.amount ?? item?.getAmount?.() ?? 0);
}

function totalBagValue(player) {
  return getBagItems(player).reduce((acc, i) => acc + itemValue(i), 0);
}

function hasSameItem(container, item) {
  return container.getValidItems().some((existing) => existing.getId() === item.id && JSON.stringify(existing.getMeta?.() ?? null) === JSON.stringify(item.meta ?? null));
}

function bankForItem(player, item) {
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && hasSameItem(player.getBank(tab), item)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, item.id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

function buildInterface() {
  const { widgets, add } = createWidgetGroup(INTERFACE_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 494,
    rawHeight: 334,
    width: 494,
    height: 334,
    xPositionMode: 1,
    yPositionMode: 1,
  });

  // Background frame
  add(COMPONENT.FRAME, root, {
    type: TYPE_RECTANGLE,
    rawWidth: 494,
    rawHeight: 334,
    width: 494,
    height: 334,
    filled: true,
    color: 0x2b241b,
    opacity: 16,
  });

  // Title
  add(COMPONENT.TITLE, root, {
    type: TYPE_TEXT,
    rawX: 18,
    rawY: 10,
    rawWidth: 458,
    rawHeight: 24,
    width: 458,
    height: 24,
    text: "Looting Bag",
    fontId: 496,
    textColor: 0xffd27f,
    textShadowed: true,
    xTextAlignment: 1,
    yTextAlignment: 1,
  });

  // Close button
  add(COMPONENT.CLOSE_BUTTON, root, {
    type: TYPE_TEXT,
    rawX: 450,
    rawY: 10,
    rawWidth: 30,
    rawHeight: 24,
    width: 30,
    height: 24,
    text: "<col=ff0000>X</col>",
    fontId: 496,
    textColor: 0xff0000,
    textShadowed: true,
    xTextAlignment: 1,
    yTextAlignment: 1,
    actions: ["Close"],
    flags: FLAG_OP1,
  });

  // Bag items grid (4 columns x 7 rows = 28 slots)
  const container = add(COMPONENT.CONTAINER, root, {
    rawX: 30,
    rawY: 45,
    rawWidth: 200,
    rawHeight: 250,
    width: 200,
    height: 250,
  });

  for (let slot = 0; slot < BAG_CAPACITY; slot++) {
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    const x = col * 46;
    const y = row * 34;

    add(SLOT_BACKGROUND_START + slot, container, {
      type: TYPE_RECTANGLE,
      rawX: x,
      rawY: y,
      rawWidth: 42,
      rawHeight: 32,
      width: 42,
      height: 32,
      filled: true,
      color: 0x241e16,
      opacity: 64,
    });

    add(SLOT_ITEM_START + slot, container, {
      type: TYPE_GRAPHIC,
      rawX: x + 2,
      rawY: y + 2,
      rawWidth: 38,
      rawHeight: 28,
      width: 38,
      height: 28,
      itemQuantityMode: 2,
      borderType: 1,
      actions: ["Examine"],
      flags: FLAG_OP1,
      isHidden: true,
      hidden: true,
    });
  }

  // Value text
  add(COMPONENT.VALUE_TEXT, root, {
    type: TYPE_TEXT,
    rawX: 30,
    rawY: 300,
    rawWidth: 434,
    rawHeight: 24,
    width: 434,
    height: 24,
    text: "Total value: 0 coins",
    fontId: 494,
    textColor: 0xe8ded0,
    textShadowed: true,
    yTextAlignment: 1,
  });

  return { groupId: INTERFACE_ID, widgets };
}

const INTERFACE_DEFINITION = buildInterface();

function renderBagInterface(player) {
  const sender = player.getPacketSender();
  const items = getBagItems(player);
  const val = totalBagValue(player);

  for (let slot = 0; slot < BAG_CAPACITY; slot++) {
    const item = items[slot];
    const itemUid = uid(SLOT_ITEM_START + slot);
    if (item) {
      sender.sendItemOnInterface(itemUid, item.id, slot, item.amount);
      sender.sendInterfaceDisplayState(itemUid, false);
    } else {
      sender.clearItemOnInterface(itemUid);
      sender.sendInterfaceDisplayState(itemUid, true);
    }
  }

  sender.sendString(`Total value: ${Misc.insertCommasToNumber(val)} coins`, VALUE_TEXT_UID);
}

function openCheckInterface(player) {
  player.setInterfaceId(INTERFACE_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, INTERFACE_ID, 0);
  renderBagInterface(player);
}

function toggleBag(player, item, slot) {
  const currentId = item.getId();
  const newId = currentId === CLOSED_BAG_ID ? OPEN_BAG_ID : CLOSED_BAG_ID;
  const inv = player.getInventory();
  inv.getItems()[slot] = new Item(newId, 1, item.getMeta?.());
  inv.refreshItems();
  const state = newId === OPEN_BAG_ID ? "opened" : "closed";
  player.getPacketSender().sendMessage(`You have ${state} your looting bag.`);
}

function isPlayerInWilderness(player) {
  if (!player) return false;
  try {
    if (Wilderness.isIn(player)) return true;
  } catch {}
  try {
    const loc = player.getLocation?.();
    if (loc) {
      if (Wilderness.isInLocation(loc)) return true;
      const x = typeof loc.getX === "function" ? loc.getX() : loc.x;
      const y = typeof loc.getY === "function" ? loc.getY() : loc.y;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (y >= 3523 && y <= 3968 && x >= 2940 && x <= 3392) return true;
        if (y >= 9900 && y <= 10400 && x >= 2940 && x <= 3400) return true;
      }
    }
    const wildyLevel = player.getWildernessLevel?.();
    if (Number.isFinite(wildyLevel) && wildyLevel > 0) return true;
  } catch {}
  return false;
}

function depositItemIntoBag(player, item, slot, requestedAmount = Number.MAX_SAFE_INTEGER) {
  if (!isPlayerInWilderness(player)) {
    player.getPacketSender().sendMessage("You can only put items into the looting bag while in the Wilderness.");
    return false;
  }
  if (isLootingBag(item)) {
    player.getPacketSender().sendMessage("You cannot put a looting bag inside another looting bag.");
    return false;
  }
  const def = item.getDefinition?.() ?? ItemDefinition.forId(item.getId?.() ?? item.id);
  if (!def?.isTradeable?.()) {
    player.getPacketSender().sendMessage("You cannot put untradeable items in the looting bag.");
    return false;
  }

  const items = getBagItems(player);
  const isStackable = def.isStackable?.() === true;
  const existingIndex = isStackable ? items.findIndex((i) => i.id === item.getId()) : -1;

  if (existingIndex < 0 && items.length >= BAG_CAPACITY) {
    player.getPacketSender().sendMessage("Your looting bag is full.");
    return false;
  }

  const currentInvAmount = item.getAmount();
  const amountToMove = Math.min(requestedAmount, currentInvAmount);
  if (amountToMove <= 0) return false;

  if (existingIndex >= 0) {
    items[existingIndex].amount += amountToMove;
  } else {
    items.push({ id: item.getId(), amount: amountToMove, meta: item.getMeta?.() ?? null });
  }

  setBagItems(player, items);

  const inv = player.getInventory();
  if (amountToMove >= currentInvAmount) {
    inv.deleteAtSlot(slot, currentInvAmount);
  } else {
    item.decrementAmountBy(amountToMove);
    inv.refreshItems();
  }

  player.getPacketSender().sendMessage(`You deposit ${amountToMove > 1 ? amountToMove + " x " : ""}${def.getName()} into your looting bag.`);
  Sounds.sendSound(player, Sound.DROP_ITEM);
  return true;
}

function promptDepositAmount(player, item, slot) {
  if (!isPlayerInWilderness(player)) {
    player.getPacketSender().sendMessage("You can only put items into the looting bag while in the Wilderness.");
    return;
  }
  const count = item.getAmount();
  if (count <= 1) {
    depositItemIntoBag(player, item, slot, 1);
    return;
  }

  const choose = (amount) => () => depositItemIntoBag(player, item, slot, amount);
  const promptX = () => {
    player.setEnteredAmountAction({
      execute: (entered) => {
        if (Number.isInteger(entered) && entered > 0) {
          depositItemIntoBag(player, item, slot, entered);
        }
      },
    });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to deposit?");
  };

  player.getPacketSender().sendEnterAmountPrompt ? promptX() : choose(count)();
}

function promptBagDepositMenu(api, player) {
  if (!isPlayerInWilderness(player)) {
    player.getPacketSender().sendMessage("You can only put items into the looting bag while in the Wilderness.");
    return;
  }
  const validItems = player.getInventory().getValidItems().filter((item) => !isLootingBag(item) && item.getDefinition().isTradeable?.());
  if (!validItems.length) {
    player.getPacketSender().sendMessage("You do not have any tradeable items in your inventory to deposit.");
    return;
  }

  api.sendMultiChatboxPrompt(
    player,
    "Deposit items into Looting bag",
    "Deposit all tradeable items",
    () => {
      let depositedAny = false;
      const invItems = player.getInventory().getItems();
      for (let slot = 0; slot < invItems.length; slot++) {
        const it = invItems[slot];
        if (!it || !it.isValid?.() || isLootingBag(it) || !it.getDefinition().isTradeable?.()) continue;
        if (hasBagSpace(player, it.getId(), it.getAmount())) {
          depositItemIntoBag(player, it, slot, it.getAmount());
          depositedAny = true;
        }
      }
      if (!depositedAny) {
        player.getPacketSender().sendMessage("Could not deposit items into the looting bag.");
      }
    },
    "Choose item manually (use item on bag)",
    () => {
      player.getPacketSender().sendMessage("Use an item from your inventory on the looting bag to deposit it.");
    },
    "Never mind",
    () => {}
  );
}

function depositBagToBank(player) {
  const items = getBagItems(player);
  if (!items.length) return false;

  let movedAny = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const bank = bankForItem(player, item);
    if (!bank) continue;
    bank.add(new Item(item.id, item.amount, item.meta), false);
    items.splice(i, 1);
    movedAny = true;
  }

  setBagItems(player, items);
  if (movedAny) {
    player.getPacketSender().sendMessage("You deposit the contents of your looting bag into your bank.");
    Sounds.sendSound(player, Sound.CONTAINER_OPEN);
  }
  if (items.length > 0) {
    player.getPacketSender().sendMessage("There was not enough room in your bank to deposit everything.");
  }
  return movedAny;
}

module.exports = {
  name: "LootingBag",
  dependsOn: ["Wilderness"],
  register(api) {
    api.persistAttribute(BAG_ATTRIBUTE);
    api.registerCustomInterface(INTERFACE_DEFINITION);

    // Open/close, check, deposit item actions
    api.onItemAction((event) => {
      if (!isLootingBag(event.item)) return;
      const option = String(event.option ?? "").toLowerCase();
      if (option === "open" || option === "close") {
        event.handled = true;
        toggleBag(event.player, event.item, event.slot);
        return;
      }
      if (option === "check") {
        event.handled = true;
        openCheckInterface(event.player);
        return;
      }
      if (option === "deposit") {
        event.handled = true;
        promptBagDepositMenu(api, event.player);
        return;
      }
      if (option === "destroy") {
        event.handled = true;
        api.sendMultiChatboxPrompt(
          event.player,
          "Destroy Looting bag? Items stored inside will be lost.",
          "Destroy",
          () => {
            const slot = event.player.getInventory().getItems().indexOf(event.item);
            if (slot >= 0) {
              event.player.getInventory().deleteAtSlot(slot, 1);
              setBagItems(event.player, []);
            }
          },
          "Cancel",
          () => {}
        );
        return;
      }
    });

    // Close button on Looting Bag interface
    api.onInterfaceActionButton(CLOSE_BUTTON_UID, ({ player }) => {
      player.setInterfaceId(-1);
      player.getPacketSender().closeSubInterface(MAIN_MODAL_UID);
      return true;
    });

    // Item on Bag: Deposit item into looting bag
    api.onItemOnItem((event) => {
      let bagItem, bagSlot, targetItem, targetSlot;
      if (isLootingBag(event.usedItem)) {
        bagItem = event.usedItem;
        bagSlot = event.usedItemSlot;
        targetItem = event.usedWithItem;
        targetSlot = event.usedWithItemSlot;
      } else if (isLootingBag(event.usedWithItem)) {
        bagItem = event.usedWithItem;
        bagSlot = event.usedWithItemSlot;
        targetItem = event.usedItem;
        targetSlot = event.usedItemSlot;
      }
      if (!bagItem || !targetItem) return;

      event.handled = true;
      promptDepositAmount(event.player, targetItem, targetSlot);
    });

    // Ground Item pickup: If bag is OPEN in Wilderness, auto-loot into bag
    api.onItemPickup((event) => {
      const { player, groundItem, itemId } = event;
      if (!isPlayerInWilderness(player)) return;

      const openBag = player.getInventory().getItems().find((i) => i && isOpenBag(i));
      if (!openBag) return;

      const def = ItemDefinition.forId(itemId);
      if (!def?.isTradeable?.()) return;

      const groundAmount = groundItem.getItem().getAmount();
      if (!hasBagSpace(player, itemId, groundAmount)) return;

      // Item goes directly into looting bag
      const items = getBagItems(player);
      const isStackable = def.isStackable?.() === true;
      const existingIndex = isStackable ? items.findIndex((i) => i.id === itemId) : -1;

      if (existingIndex >= 0) {
        items[existingIndex].amount += groundAmount;
      } else {
        items.push({ id: itemId, amount: groundAmount, meta: groundItem.getItem().getMeta?.() ?? null });
      }

      setBagItems(player, items);
      ItemOnGroundManager.deregister(groundItem);
      Sounds.sendSound(player, Sound.PICK_UP_ITEM);
      player.getLastItemPickup().reset();
      player.getPacketSender().sendMessage(`You pick up ${groundAmount > 1 ? groundAmount + " x " : ""}${def.getName()} and put it into your looting bag.`);
      event.handled = true;
    });

    // Banking: Player deposits items at bank
    api.onCanBank((event) => {
      depositBagToBank(event.player);
    });

    // Death drops: If player dies, drop all stored items in the looting bag to the ground for killer
    api.onPlayerDeathItemDrop((event) => {
      if (isLootingBag(event.item)) {
        const items = getBagItems(event.player);
        if (items.length) {
          const dropRecipient = event.killer ? event.killer : event.player;
          for (const item of items) {
            ItemOnGroundManager.registerLocation(
              dropRecipient,
              new Item(item.id, item.amount, item.meta),
              event.location.clone ? event.location.clone() : event.location
            );
          }
          setBagItems(event.player, []);
        }
      }
    });
  },
  _test: {
    CLOSED_BAG_ID,
    OPEN_BAG_ID,
    INTERFACE_ID,
    isLootingBag,
    isOpenBag,
    getBagItems,
    setBagItems,
    hasBagSpace,
    totalBagValue,
    isPlayerInWilderness,
    depositItemIntoBag,
    depositBagToBank,
  },
};
