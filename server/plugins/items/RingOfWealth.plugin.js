const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");

const RING_OF_WEALTH_SCROLL = 12783;
const IMBUE_COST = 50000;
const COINS = 995;
const AUTO_COLLECT_ATTRIBUTE = "ring-of-wealth-auto-collect";
const INVENTORY_INTERFACE_ID = 3214;
const CHARGED_RINGS = new Map([
  [11980, { charges: 5, nextId: 11982, imbuedId: 20786 }],
  [11982, { charges: 4, nextId: 11984, imbuedId: 20787 }],
  [11984, { charges: 3, nextId: 11986, imbuedId: 20788 }],
  [11986, { charges: 2, nextId: 11988, imbuedId: 20789 }],
  [11988, { charges: 1, nextId: 2572, imbuedId: 20790 }],
  [20786, { charges: 5, nextId: 20787, imbuedId: 20786, imbued: true }],
  [20787, { charges: 4, nextId: 20788, imbuedId: 20787, imbued: true }],
  [20788, { charges: 3, nextId: 20789, imbuedId: 20788, imbued: true }],
  [20789, { charges: 2, nextId: 20790, imbuedId: 20789, imbued: true }],
  [20790, { charges: 1, nextId: 12785, imbuedId: 20790, imbued: true }],
  [21456, { charges: 5, nextId: 11982, imbuedId: 21458 }],
  [21457, { charges: 1, nextId: 2572, imbuedId: 21459 }],
  [21458, { charges: 5, nextId: 20787, imbuedId: 21458, imbued: true }],
  [21459, { charges: 1, nextId: 12785, imbuedId: 21459, imbued: true }],
]);
const UNCHARGED_RINGS = new Map([[2572, 11980], [12785, 20786]]);
const IMBUED_RING_IDS = new Set([12785, 20786, 20787, 20788, 20789, 20790, 21458, 21459]);
const UNIMBUED_RING_IDS = new Map([
  [12785, 2572], [20786, 11980], [20787, 11982], [20788, 11984], [20789, 11986], [20790, 11988],
  [21458, 21456], [21459, 21457],
]);
const RING_IDS = new Set([...CHARGED_RINGS.keys(), ...UNCHARGED_RINGS.keys()]);
const TELEPORTS = [
  { label: "Grand Exchange", destination: new Location(3163, 3485, 0) },
  { label: "Miscellania", destination: new Location(2539, 3864, 0) },
  { label: "Falador Park", destination: new Location(2994, 3377, 0) },
  { label: "Dondakan", destination: new Location(2824, 10168, 0) },
];
/**
 * The ring's options in the cache's order (item params 451-456: Miscellania, Grand Exchange,
 * Falador, Dondakan, Boss Log, Coin Collection), which both the inventory Rub submenu (by sub-op)
 * and the worn options follow.
 */
const ACTIONS = [
  { type: "teleport", teleport: TELEPORTS[1] },
  { type: "teleport", teleport: TELEPORTS[0] },
  { type: "teleport", teleport: TELEPORTS[2] },
  { type: "teleport", teleport: TELEPORTS[3] },
  { type: "boss-log" },
  { type: "coin-collection" },
];

function ringState(itemId) {
  return CHARGED_RINGS.get(Number(itemId)) ?? null;
}

function isRingOfWealth(itemId) {
  return RING_IDS.has(Number(itemId));
}

function isImbuedRingOfWealth(itemId) {
  return IMBUED_RING_IDS.has(Number(itemId));
}

function isWearingRingOfWealth(player) {
  const ring = player?.getEquipment?.()?.get?.(Equipment.RING_SLOT);
  return isRingOfWealth(ring?.getId?.());
}

function isWearingImbuedRingOfWealth(player) {
  const ring = player?.getEquipment?.()?.get?.(Equipment.RING_SLOT);
  return isImbuedRingOfWealth(ring?.getId?.());
}

function autoCollectCurrencies(player) {
  return player?.getAttribute?.(AUTO_COLLECT_ATTRIBUTE) !== false;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function sourceMatches(player, event, item) {
  const container = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID
    ? player.getEquipment()
    : player.getInventory();
  return container?.getItems?.()[event.slot] === item;
}

function consumeCharge(player, item) {
  const state = ringState(item.getId());
  if (!state) {
    return false;
  }
  item.setId(state.nextId);
  refresh(player);
  if (state.charges === 1) {
    player.sendMessage("Your ring of wealth has run out of charges.");
  }
  return true;
}

function teleport(player, event, item, destination) {
  if (!sourceMatches(player, event, item)) {
    return;
  }
  if (!ringState(item.getId())) {
    player.sendMessage("Your ring of wealth has no charges left.");
    return;
  }
  // Members' dragonstone jewellery works through level 30 Wilderness, unlike spells.
  if (!TeleportHandler.checkReqs(player, destination, 30)) {
    return;
  }
  consumeCharge(player, item);
  TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false);
}

function recharge(player, item) {
  const chargedId = UNCHARGED_RINGS.get(item.getId())
    ?? (isImbuedRingOfWealth(item.getId()) ? 20786 : 11980);
  if (item.getId() === chargedId || item.getId() === 21456 || item.getId() === 21458) {
    player.sendMessage("Your ring of wealth is already fully charged.");
    return;
  }
  item.setId(chargedId);
  refresh(player);
  player.sendMessage("You recharge your ring of wealth at the Fountain of Rune.");
}

function imbue(player, ring) {
  const state = ringState(ring.getId());
  const imbuedId = state?.imbuedId ?? (ring.getId() === 2572 ? 12785 : null);
  if (!imbuedId || isImbuedRingOfWealth(ring.getId())) {
    return false;
  }
  if (player.getInventory().getAmount(COINS) < IMBUE_COST) {
    player.sendMessage("You need 50,000 coins to imbue this ring.");
    return false;
  }
  player.getInventory().deleteNumber(RING_OF_WEALTH_SCROLL, 1);
  player.getInventory().deleteNumber(COINS, IMBUE_COST);
  ring.setId(imbuedId);
  refresh(player);
  player.sendMessage("You imbue your ring of wealth.");
  return true;
}

function openTeleportPrompt(api, event) {
  const { player, item } = event;
  if (!ringState(item.getId())) {
    player.sendMessage("Your ring of wealth has no charges left.");
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    "Where would you like to teleport to?",
    ...TELEPORTS.flatMap(({ label, destination }) => [
      label,
      () => teleport(player, event, item, destination),
    ])
  );
}

function teleportForOption(option) {
  const normalized = String(option ?? "").toLowerCase();
  return TELEPORTS.find(({ label }) => normalized.startsWith(label.toLowerCase())) ?? null;
}

function actionForOption(option) {
  const teleportOption = teleportForOption(option);
  if (teleportOption) {
    return { type: "teleport", teleport: teleportOption };
  }
  const normalized = String(option ?? "").toLowerCase();
  if (normalized.startsWith("boss log")) {
    return { type: "boss-log" };
  }
  if (normalized.startsWith("coin collection")) {
    return { type: "coin-collection" };
  }
  return null;
}

function toggleAutoCollect(player) {
  const enabled = !autoCollectCurrencies(player);
  player.setAttribute?.(AUTO_COLLECT_ATTRIBUTE, enabled);
  player.sendMessage(`Your ring of wealth will ${enabled ? "now" : "no longer"} collect currency drops.`);
}

function handleRingAction(event, action) {
  if (!action) {
    return false;
  }
  event.handled = true;
  if (action.type === "teleport") {
    teleport(event.player, event, event.item, action.teleport.destination);
  } else if (action.type === "coin-collection") {
    toggleAutoCollect(event.player);
  } else {
    event.player.sendMessage("Boss log is not available yet.");
  }
  return true;
}

function removeImbueOnDeath(event, itemOnGroundManager) {
  const unimbuedId = UNIMBUED_RING_IDS.get(event.item?.getId?.());
  if (!unimbuedId) {
    return;
  }
  event.item.setId(unimbuedId);
  const coins = new Item(COINS, IMBUE_COST);
  if (event.killer?.getInventory) {
    event.killer.getInventory().forceAdd(event.killer, coins);
  } else {
    itemOnGroundManager.registerLocation(event.player, coins, event.location);
  }
}

module.exports = {
  name: "RingOfWealth",
  members: true,
  ACTIONS,
  register(api) {
    const itemOnGroundManager = api.getItemOnGroundManager();
    api.onItemAction((event) => {
      if (!isRingOfWealth(event.itemId)) {
        return;
      }
      const option = String(event.option ?? "").toLowerCase();
      const selectedAction = actionForOption(option);
      const submenuAction = Number.isInteger(event.subOpId)
        ? ACTIONS[event.subOpId - 1]
        : null;
      const equippedAction = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID
        ? ACTIONS[event.clickType - 2]
        : null;
      if (!handleRingAction(event, selectedAction ?? submenuAction ?? equippedAction) &&
          (option === "rub" || (event.clickType === 1 && event.interfaceId !== Equipment.INVENTORY_INTERFACE_ID))) {
        event.handled = true;
        openTeleportPrompt(api, event);
      } else if (!event.handled && (option === "features" || event.clickType === 2)) {
        event.handled = true;
        api.sendMultiChatboxPrompt(
          event.player,
          "Ring of wealth features",
          `Currency collection: ${autoCollectCurrencies(event.player) ? "On" : "Off"}`,
          () => toggleAutoCollect(event.player),
          "Cancel",
          () => {}
        );
      } else if (!event.handled && event.clickType === 3) {
        event.handled = true;
        openTeleportPrompt(api, event);
      }
    });

    api.onItemOnItem((event) => {
      const ring = event.usedItemId === RING_OF_WEALTH_SCROLL ? event.usedWithItem
        : event.usedWithItemId === RING_OF_WEALTH_SCROLL ? event.usedItem
        : null;
      if (!ring || !isRingOfWealth(ring.getId()) || isImbuedRingOfWealth(ring.getId())) {
        return;
      }
      event.handled = imbue(event.player, ring);
    });

    api.onItemOnObject((event) => {
      if (!isRingOfWealth(event.itemId) || ![
        ObjectIdentifiers.FOUNTAIN_OF_RUNE,
        ObjectIdentifiers.FOUNTAIN_OF_RUNE_2,
      ].includes(event.objectId)) {
        return;
      }
      event.handled = true;
      recharge(event.player, event.item);
    });

    api.onPlayerDeathItemDrop((event) => removeImbueOnDeath(event, itemOnGroundManager));
  },
  isWearingRingOfWealth,
  isWearingImbuedRingOfWealth,
  autoCollectCurrencies,
  _test: { CHARGED_RINGS, IMBUED_RING_IDS, TELEPORTS, consumeCharge, imbue, recharge, removeImbueOnDeath, ringState, teleport },
};
