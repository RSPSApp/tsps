/**
 * Ring of the elements: teleports beside the four elemental runic altars.
 * Charges are stored per player (1-10,000), each teleport costing one charge; the ring is
 * charged by using one air, water, earth, fire and law rune per charge on it, and uncharged
 * (runes back) at a bank. Live behaviour is in docs/ring-of-the-elements.md.
 */
const { refundsFit, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MAX_CHARGES = 10000;
const CHARGES_ATTRIBUTE = "ring-of-elements:charges";
const LAST_DESTINATION_ATTRIBUTE = "ring-of-elements:last-destination";
const CHARGES_VARBIT = "ring_of_the_elements_charges";
const LAST_DESTINATION_VARBIT = "ring_of_elements_last_destination";
/** Teleport message colour (game warning red), sent once five or fewer charges remain. */
const LOW_CHARGES_COLOUR = "ef1c1c";
const LOW_CHARGES_AT = 5;
const CAST_GRAPHIC_HEIGHT = 92;
/** A bank is a loc (booth, counter) or NPC with this option within this many tiles. */
const BANK_ACTION = "Bank";
const BANK_DISTANCE = 3;

const NO_CHARGES = "Your ring of the elements has no charges remaining.";
const MISSING_RUNES = "You require at least one air, water, earth, fire and law rune to charge your Ring of the Elements.";
const NO_SPACE = "You don't have enough inventory space to do that.";

let core = null;
let api = null;
let ringIds = null;
let runeIds = null;
let teleports = null;
let chargesVarbit = null;
let lastDestinationVarbit = null;

/**
 * Landing tiles as recorded (rsprox 364, 365): air (2980, 3278), earth (3286, 3467-3468), fire
 * (3314, 3276), water (3165-3167, 3156-3160). Rubbing shows `label`; `lastDestination` is the
 * value of ring_of_elements_last_destination after landing.
 */
const DESTINATIONS = [
  { label: "Air Altar", tile: [2980, 3278, 0], graphic: "teleport_casting_air", lastDestination: 1 },
  { label: "Water Altar", tile: [3165, 3160, 0], graphic: "teleport_casting_water", lastDestination: 2 },
  { label: "Earth Altar", tile: [3286, 3468, 0], graphic: "teleport_casting_earth", lastDestination: 3 },
  { label: "Fire Altar", tile: [3314, 3276, 0], graphic: "teleport_casting_fire", lastDestination: 4 },
];

function initialize(coreApi) {
  core = coreApi;
  const { ItemIdentifiers, CacheDefinitions, Location, TeleportType, Animation, Priority, Graphic } = core;
  ringIds = new Set([ItemIdentifiers.RING_OF_THE_ELEMENTS, ItemIdentifiers.RING_OF_THE_ELEMENTS_4]);
  runeIds = [
    ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE,
    ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.LAW_RUNE,
  ];
  chargesVarbit = CacheDefinitions.getVarbitId(CHARGES_VARBIT);
  lastDestinationVarbit = CacheDefinitions.getVarbitId(LAST_DESTINATION_VARBIT);
  // Standard jewellery teleport (TeleportType.NORMAL) with the altar's own casting graphic.
  teleports = DESTINATIONS.map((destination) => ({
    ...destination,
    destination: new Location(...destination.tile),
    type: new TeleportType(3,
      new Animation(714, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION,
      new Graphic(CacheDefinitions.getSpotanimId(destination.graphic), 0, CAST_GRAPHIC_HEIGHT),
      null, null, { busy: true, repeatEndAnimation: true, areaSoundRange: 10 }),
  }));
}

function isRingOfElements(itemId) {
  return ringIds.has(Number(itemId));
}

function getCharges(player) {
  const charges = Number(player.getAttribute?.(CHARGES_ATTRIBUTE));
  return Number.isFinite(charges) && charges > 0 ? Math.min(MAX_CHARGES, Math.floor(charges)) : 0;
}

function setCharges(player, charges) {
  const stored = Math.max(0, Math.min(MAX_CHARGES, Math.floor(charges)));
  player.setAttribute?.(CHARGES_ATTRIBUTE, stored);
  player.getPacketSender?.().sendVarbit(chargesVarbit, stored);
}

function lastDestinationValue(player) {
  const label = player.getAttribute?.(LAST_DESTINATION_ATTRIBUTE);
  return teleports.find((entry) => entry.label === label)?.lastDestination ?? 0;
}

/** Sends the stored charges and last destination the client's ring menus read. */
function syncVarbits(event) {
  const { player } = event;
  player.getPacketSender().sendVarbit(chargesVarbit, getCharges(player));
  player.getPacketSender().sendVarbit(lastDestinationVarbit, lastDestinationValue(player));
}

/** The charged ring is untradeable, so the id follows the charge count. */
function syncRing(player, item, charges = getCharges(player)) {
  if (!item) {
    return;
  }
  const targetId = charges > 0 ? core.ItemIdentifiers.RING_OF_THE_ELEMENTS_4 : core.ItemIdentifiers.RING_OF_THE_ELEMENTS;
  if (item.getId?.() !== targetId) {
    item.setId?.(targetId);
  }
  player.getInventory?.().refreshItems?.();
  player.getEquipment?.().refreshItems?.();
}

/** Updates every ring the player carries, wherever it moved meanwhile. */
function syncAllRings(player, charges) {
  for (const container of [player.getInventory?.(), player.getEquipment?.()]) {
    for (const ring of container?.getItems?.() ?? []) {
      if (ring && isRingOfElements(ring.getId?.())) syncRing(player, ring, charges);
    }
  }
}

function startDialogue(player, ...dialogues) {
  const chain = new core.DialogueChainBuilder();
  for (const dialogue of dialogues) chain.add(dialogue);
  player.getDialogueManager().startDialogues(chain);
}

function statement(player, text) {
  startDialogue(player, new core.StatementDialogue(0, text));
}

/** Rubbing an empty ring shows the ring in an item box (rsprox 364, 365). */
function noCharges(player) {
  startDialogue(player, new core.ItemStatementDialogue(0, core.ItemIdentifiers.RING_OF_THE_ELEMENTS, NO_CHARGES));
}

function teleport(player, destination) {
  if (getCharges(player) <= 0) {
    noCharges(player);
    return false;
  }
  if (!core.TeleportHandler.checkReqs(player, destination.destination)) {
    return false;
  }
  // The charge goes on arrival, like the other teleport jewellery (Jewellery.plugin.js).
  core.TeleportHandler.teleport(player, destination.destination, destination.type, false, () => arrive(player, destination));
  return true;
}

function remainingMessage(remaining) {
  const noun = remaining === 1 ? "charge" : "charges";
  return `<col=${LOW_CHARGES_COLOUR}>Your ring of elements has ${remaining} ${noun} remaining.`;
}

/** Spends the player's charge on landing and updates every ring they carry. */
function arrive(player, destination) {
  const charges = getCharges(player);
  if (charges <= 0) {
    return;
  }
  const remaining = charges - 1;
  setCharges(player, remaining);
  player.setAttribute?.(LAST_DESTINATION_ATTRIBUTE, destination.label);
  player.getPacketSender?.().sendVarbit(lastDestinationVarbit, destination.lastDestination);
  syncAllRings(player, remaining);
  if (remaining > 0 && remaining <= LOW_CHARGES_AT) {
    player.sendMessage(remainingMessage(remaining));
  }
}

function destinationLabelled(option) {
  const normalized = String(option ?? "").toLowerCase();
  return teleports.find(({ label }) => normalized.startsWith(label.toLowerCase())) ?? null;
}

function lastDestinationTeleport(player) {
  const label = player.getAttribute?.(LAST_DESTINATION_ATTRIBUTE);
  const destination = teleports.find((entry) => entry.label === label);
  return destination ? teleport(player, destination) : false;
}

function openTeleportPrompt(player) {
  if (getCharges(player) <= 0) {
    noCharges(player);
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    "Where would you like to teleport to?",
    ...teleports.flatMap((destination) => [destination.label, () => teleport(player, destination)])
  );
}

/** Worn options in cache order: Last Destination, Air, Water, Earth, Fire. */
function wornDestination(event) {
  const index = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID ? event.clickType - 2 : -1;
  const submenu = Number.isInteger(event.subOpId) ? event.subOpId - 1 : index;
  if (submenu < 0 || submenu > teleports.length) {
    return undefined;
  }
  return submenu === 0 ? null : teleports[submenu - 1];
}

function nearBank(player) {
  const { MapObjects, RegionManager } = core;
  const here = player.getLocation();
  const [x, y, z] = [here.getX(), here.getY(), here.getZ()];
  RegionManager.loadMapFiles(x, y);
  for (let dx = -BANK_DISTANCE; dx <= BANK_DISTANCE; dx++) {
    for (let dy = -BANK_DISTANCE; dy <= BANK_DISTANCE; dy++) {
      const objects = MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? [];
      if (objects.some((object) => (object.getDefinition?.()?.getActions?.() ?? []).includes(BANK_ACTION))) return true;
    }
  }
  const list = player.getLocalNpcs?.();
  const npcs = Array.isArray(list) ? list : list ? [...list.values()] : [];
  return npcs.some((npc) => (npc?.getDefinition?.()?.getActions?.() ?? []).includes(BANK_ACTION)
    && npc.getLocation().getZ() === z && here.getDistance(npc.getLocation()) <= BANK_DISTANCE);
}

function chargeNoun(count) {
  return count === 1 ? "charge" : "charges";
}

/** Uncharge asks at a bank (rsprox 364) and only tells the charges anywhere else. */
function uncharge(event) {
  const { player } = event;
  const charges = getCharges(player);
  if (charges <= 0) {
    noCharges(player);
    return;
  }
  // The charge is spent on landing, so uncharging mid-teleport would be a free teleport.
  if (player.isTeleportingReturn?.()) {
    return;
  }
  if (!nearBank(player)) {
    statement(player, `The Ring of the Elements has ${charges} ${chargeNoun(charges)}. You can uncharge it at a bank.`);
    return;
  }
  startDialogue(player, new core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (Number(option) === 1 && nearBank(player)) refundRunes(player);
    },
  }, "Yes - uncharge it", "No - keep the charges").setTitle(`Ring of the Elements charges: ${charges}. Uncharge it?`));
}

/** One of each rune per charge comes back; nothing is taken unless every stack fits. */
function refundRunes(player) {
  const charges = getCharges(player);
  if (charges <= 0 || player.isTeleportingReturn?.()) {
    return;
  }
  const inventory = player.getInventory();
  const refunds = runeIds.map((runeId) => new core.Item(runeId, charges));
  if (!refundsFit(inventory, refunds)) {
    player.sendMessage(NO_SPACE);
    return;
  }
  for (const refund of refunds) inventory.addItem(refund);
  setCharges(player, 0);
  syncAllRings(player, 0);
}

/** Using any of the five runes on the ring asks how many charges to add. */
function chargeAttempt(player, ring) {
  const inventory = player.getInventory();
  if (runeIds.some((runeId) => plainAmount(inventory, runeId) <= 0)) {
    if (runeIds.every((runeId) => inventory.getAmount(runeId) > 0)) player.sendMessage(PRESET_TEXT);
    else statement(player, MISSING_RUNES);
    return false;
  }
  const most = Math.min(MAX_CHARGES - getCharges(player), ...runeIds.map((runeId) => plainAmount(inventory, runeId)));
  if (most <= 0) {
    player.sendMessage("Your ring of the elements is fully charged.");
    return false;
  }
  player.setEnteredAmountAction({
    execute: (amount) => {
      player.setEnteredAmountAction(null);
      addCharges(player, ring, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges would you like to add? (0-${most}).`);
  return true;
}

function addCharges(player, ring, requested) {
  const inventory = player.getInventory();
  const room = MAX_CHARGES - getCharges(player);
  const amount = Math.min(Math.floor(Number(requested)) || 0, room, ...runeIds.map((runeId) => plainAmount(inventory, runeId)));
  if (amount <= 0) {
    return false;
  }
  for (const runeId of runeIds) {
    takePlain(inventory, runeId, amount);
  }
  setCharges(player, getCharges(player) + amount);
  syncRing(player, ring);
  player.sendMessage("You charge the ring of the elements.");
  return true;
}

function ringAction(event) {
  if (!isRingOfElements(event.itemId)) {
    return;
  }
  event.handled = true;
  const { player } = event;
  const option = String(event.option ?? "").toLowerCase();
  if (option.startsWith("uncharge")) {
    uncharge(event);
    return;
  }
  const destination = destinationLabelled(option);
  if (destination) {
    teleport(player, destination);
    return;
  }
  if (option.startsWith("last destination")) {
    if (!lastDestinationTeleport(player)) openTeleportPrompt(player);
    return;
  }
  const worn = wornDestination(event);
  if (worn === null) {
    if (!lastDestinationTeleport(player)) openTeleportPrompt(player);
  } else if (worn) {
    teleport(player, worn);
  } else {
    openTeleportPrompt(player);
  }
}

function chargeWithRunes(event) {
  const ringFirst = isRingOfElements(event.usedItemId);
  if (!ringFirst && !isRingOfElements(event.usedWithItemId)) {
    return;
  }
  const ring = ringFirst ? event.usedItem : event.usedWithItem;
  const runeId = ringFirst ? event.usedWithItemId : event.usedItemId;
  if (!runeIds.includes(Number(runeId))) {
    return;
  }
  event.handled = true;
  chargeAttempt(event.player, ring);
}

function initializeFrom(coreApi, pluginApi) {
  api = pluginApi;
  initialize(coreApi);
}

module.exports = {
  name: "RingOfElements",
  members: true,
  _test: {
    destinations: () => teleports, MAX_CHARGES, getCharges, setCharges, syncRing, chargeAttempt, addCharges, teleport,
    uncharge, refundRunes, ringAction, remainingMessage, syncVarbits,
  },
  register(pluginApi) {
    pluginApi.persistAttribute(CHARGES_ATTRIBUTE, 0);
    pluginApi.persistAttribute(LAST_DESTINATION_ATTRIBUTE);
    pluginApi.onServerStartup(initializeFrom.bind(null, pluginApi.core, pluginApi));
    pluginApi.onPlayerLogin(syncVarbits);
    pluginApi.onItemAction(ringAction);
    pluginApi.onItemOnItem(chargeWithRunes);
  },
};
