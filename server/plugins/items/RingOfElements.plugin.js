/**
 * Ring of the elements (Wiki): teleports beside the four elemental runic altars.
 * Charges are stored per player (1-10,000), each teleport costing one charge;
 * the ring is charged by using one air, water, earth, fire and law rune on it.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const UNCHARGED_RING_ID = ItemIdentifiers.RING_OF_THE_ELEMENTS;
const CHARGED_RING_ID = ItemIdentifiers.RING_OF_THE_ELEMENTS_4;
const MAX_CHARGES = 10000;
const CHARGES_ATTRIBUTE = "ring-of-elements:charges";
const LAST_DESTINATION_ATTRIBUTE = "ring-of-elements:last-destination";
const RUNE_IDS = [
  ItemIdentifiers.AIR_RUNE,
  ItemIdentifiers.WATER_RUNE,
  ItemIdentifiers.EARTH_RUNE,
  ItemIdentifiers.FIRE_RUNE,
  ItemIdentifiers.LAW_RUNE,
];

/** Wiki teleport locations and their cache planes. */
const TELEPORTS = [
  { label: "Air Altar", destination: new Location(2981, 3276, 0) },
  { label: "Water Altar", destination: new Location(3170, 3155, 0) },
  { label: "Earth Altar", destination: new Location(3288, 3468, 0) },
  { label: "Fire Altar", destination: new Location(3314, 3279, 0) },
];

/** Worn options in cache order: Last Destination, Air, Water, Earth, Fire. */
const WORN_ACTIONS = [
  { type: "last" },
  { type: "teleport", teleport: TELEPORTS[0] },
  { type: "teleport", teleport: TELEPORTS[1] },
  { type: "teleport", teleport: TELEPORTS[2] },
  { type: "teleport", teleport: TELEPORTS[3] },
];

function isRingOfElements(itemId) {
  const id = Number(itemId);
  return id === UNCHARGED_RING_ID || id === CHARGED_RING_ID;
}

function getCharges(player) {
  const charges = Number(player.getAttribute?.(CHARGES_ATTRIBUTE));
  return Number.isFinite(charges) && charges > 0 ? Math.min(MAX_CHARGES, Math.floor(charges)) : 0;
}

function setCharges(player, charges) {
  player.setAttribute?.(CHARGES_ATTRIBUTE, Math.max(0, Math.min(MAX_CHARGES, Math.floor(charges))));
}

/** The charged ring is untradeable, so the id follows the charge count. */
function syncRing(player, item, charges = getCharges(player)) {
  if (!item) {
    return;
  }
  const targetId = charges > 0 ? CHARGED_RING_ID : UNCHARGED_RING_ID;
  if (item.getId?.() !== targetId) {
    item.setId?.(targetId);
  }
  player.getInventory?.().refreshItems?.();
  player.getEquipment?.().refreshItems?.();
}

function sourceMatches(player, event, item) {
  const container = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID
    ? player.getEquipment()
    : player.getInventory();
  return container?.getItems?.()[event.slot] === item;
}

function teleport(player, item, destination, label) {
  const charges = getCharges(player);
  if (charges <= 0) {
    player.sendMessage("Your ring of the elements has no charges left.");
    return false;
  }
  if (!TeleportHandler.checkReqs(player, destination)) {
    return false;
  }
  setCharges(player, charges - 1);
  player.setAttribute?.(LAST_DESTINATION_ATTRIBUTE, label);
  syncRing(player, item, charges - 1);
  TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false);
  return true;
}

function lastDestinationTeleport(player, item) {
  const label = player.getAttribute?.(LAST_DESTINATION_ATTRIBUTE);
  const teleportOption = TELEPORTS.find(({ label: option }) => option === label);
  if (!teleportOption) {
    return false;
  }
  return teleport(player, item, teleportOption.destination, teleportOption.label);
}

function openTeleportPrompt(api, event) {
  const { player, item } = event;
  if (getCharges(player) <= 0) {
    player.sendMessage("Your ring of the elements has no charges left.");
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    "Where would you like to teleport to?",
    ...TELEPORTS.flatMap(({ label, destination }) => [
      label,
      () => teleport(player, item, destination, label),
    ])
  );
}

function teleportForOption(option) {
  const normalized = String(option ?? "").toLowerCase();
  return TELEPORTS.find(({ label }) => normalized.startsWith(label.toLowerCase())) ?? null;
}

function handleRingAction(event, action) {
  if (!action) {
    return false;
  }
  event.handled = true;
  if (action.type === "teleport") {
    return teleport(event.player, event.item, action.teleport.destination, action.teleport.label);
  }
  return lastDestinationTeleport(event.player, event.item);
}

function handleItemAction(api, event) {
  if (!isRingOfElements(event.itemId)) {
    return;
  }
  event.handled = true;
  const option = String(event.option ?? "").toLowerCase();
  const teleportOption = teleportForOption(option);
  if (teleportOption) {
    teleport(event.player, event.item, teleportOption.destination, teleportOption.label);
    return;
  }
  if (option.startsWith("last destination")) {
    if (!lastDestinationTeleport(event.player, event.item)) {
      openTeleportPrompt(api, event);
    }
    return;
  }
  const submenuAction = Number.isInteger(event.subOpId) ? WORN_ACTIONS[event.subOpId - 1] : null;
  const equippedAction = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID
    ? WORN_ACTIONS[event.clickType - 2]
    : null;
  if (handleRingAction(event, submenuAction ?? equippedAction)) {
    return;
  }
  openTeleportPrompt(api, event);
}

/** Using any of the five runes on the ring consumes one of each per charge. */
function handleChargeAttempt(player, ring) {
  const inventory = player.getInventory();
  const hasAll = RUNE_IDS.every((runeId) => inventory.contains(runeId));
  if (!hasAll) {
    player.sendMessage("You need one of each elemental rune and a law rune to charge the ring.");
    return false;
  }
  if (getCharges(player) >= MAX_CHARGES) {
    player.sendMessage("Your ring of the elements is fully charged.");
    return false;
  }
  for (const runeId of RUNE_IDS) {
    inventory.deleteNumber(runeId, 1);
  }
  setCharges(player, getCharges(player) + 1);
  syncRing(player, ring);
  player.sendMessage("You charge the ring of the elements.");
  return true;
}

module.exports = {
  name: "RingOfElements",
  members: true,
  _test: {
    TELEPORTS, WORN_ACTIONS, MAX_CHARGES, getCharges, setCharges, syncRing, handleChargeAttempt,
  },
  register(api) {
    api.persistAttribute(CHARGES_ATTRIBUTE);
    api.persistAttribute(LAST_DESTINATION_ATTRIBUTE);
    api.onItemAction((event) => handleItemAction(api, event));
    api.onItemOnItem((event) => {
      if (!isRingOfElements(event.usedItemId) && !isRingOfElements(event.usedWithItemId)) {
        return;
      }
      const ring = isRingOfElements(event.usedItemId) ? event.usedItem : event.usedWithItem;
      const runeId = isRingOfElements(event.usedItemId) ? event.usedWithItemId : event.usedItemId;
      if (!RUNE_IDS.includes(Number(runeId))) {
        return;
      }
      event.handled = handleChargeAttempt(event.player, ring);
    });
    api.log("registered", { teleports: TELEPORTS.length });
  },
};
