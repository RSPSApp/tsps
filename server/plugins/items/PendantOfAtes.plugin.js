"use strict";

/**
 * Pendant of Ates (https://oldschool.runescape.wiki/w/Pendant_of_Ates, /w/Frozen_tear and
 * /w/Statue_(Ates); docs/pendant-of-ates.md).
 *
 * A frozen tear is one charge, up to 1,000 per pendant. The charges are the item's own, so two
 * charged pendants do not share them or stack. Each teleport costs one. Only a statue the player has
 * activated can be teleported to, and a pendant can be uncharged for its tears or, inert, dismantled
 * into 100 of them. The messages are this server's own: no capture or Wiki line gives them.
 */

const CHARGES_META_KEY = "pendant-of-ates:charges";
const STATUES_ATTRIBUTE = "pendant-of-ates:statues";
const MAX_CHARGES = 1000;
const DISMANTLE_TEARS = 100;
const WILDERNESS_LEVEL = 20;
// Equipment clicks: op 1 removes the item and the worn options follow, held as item params (shared with Jewellery.plugin.js).
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

/**
 * The six teleports in the cache's order (the Rub submenu and the worn options 451-456), each with
 * its `pendant_of_ates_*_found` varbit, the inactive statue (`ates_statue_*_inactive`) and the
 * landing tile: the statue's map pin on the Wiki, except Twilight Temple's, which is the statue's
 * own tile, so the landing is the one south of it. The Aldarin statue is Death on the Isle's: its
 * icon unlocks it and that quest sends the varbit, so the pendant only reads it.
 */
const DESTINATIONS = [
  { label: "Darkfrost", varbit: 11175, statue: 54544, tile: [1491, 3283, 0] },
  { label: "Twilight Temple", varbit: 11176, statue: 54547, tile: [1668, 3222, 0] },
  { label: "Ralos' Rise", varbit: 11177, statue: 54550, tile: [1459, 3138, 0] },
  { label: "North Aldarin", varbit: 11178, statue: 54553, tile: [1426, 2995, 0], quest: true },
  { label: "Kastori", varbit: 16752, statue: 56918, tile: [1366, 3086, 0] },
  { label: "Nemus Retreat", varbit: 16757, statue: 56921, tile: [1364, 3277, 0] },
];

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function plural(count, noun) {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function held(player, pendant) {
  return [player.getInventory(), player.getEquipment()].some((container) => container.getItems().includes(pendant));
}

/** The charge count decides the id: charged with any, inert with none. */
function setCharges(player, pendant, count) {
  const { ItemIdentifiers } = core;
  pendant.setId(count > 0 ? ItemIdentifiers.PENDANT_OF_ATES : ItemIdentifiers.PENDANT_OF_ATES_INERT_);
  pendant.setMetaValue(CHARGES_META_KEY, count > 0 ? count : undefined);
  refresh(player);
}

// ------------------------------------------------------------------ statues

function statueBit(index) {
  return 1 << index;
}

function activated(player, destination) {
  return player.getPacketSender().getVarbit(destination.varbit) === 1;
}

/**
 * Activating a statue unlocks its teleport for good; its varbit is what the client swaps the statue by.
 * The click carries the multiloc's parent id, so the inactive statue is read from its definition.
 */
function activateStatue({ player, definition }) {
  const index = DESTINATIONS.findIndex((destination) => destination.statue === definition?.id && !destination.quest);
  if (index < 0) return false;
  player.setAttribute(STATUES_ATTRIBUTE, (Number(player.getAttribute(STATUES_ATTRIBUTE)) || 0) | statueBit(index));
  player.getPacketSender().sendVarbit(DESTINATIONS[index].varbit, 1);
  player.sendMessage("You activate the statue. You can now teleport here with a Pendant of Ates.");
  return true;
}

/** The varbits are not saved with the player: resend the statues activated before. */
function sendStatues({ player }) {
  const saved = Number(player.getAttribute(STATUES_ATTRIBUTE)) || 0;
  DESTINATIONS.forEach((destination, index) => {
    if (!destination.quest && saved & statueBit(index)) player.getPacketSender().sendVarbit(destination.varbit, 1);
  });
}

// ------------------------------------------------------------------ teleporting

function teleport(player, pendant, destination) {
  if (!held(player, pendant)) return;
  if (charges(pendant) <= 0) {
    player.sendMessage("Your Pendant of Ates has no charges left.");
    return;
  }
  if (!activated(player, destination)) {
    player.sendMessage(`You have not activated the statue at ${destination.label} yet.`);
    return;
  }
  const { Location, TeleportHandler, TeleportType } = core;
  const target = new Location(...destination.tile);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return;
  // Equipping during the animation clones the item, so pay before it can move.
  const left = charges(pendant) - 1;
  setCharges(player, pendant, left);
  if (left === 0) player.sendMessage("Your Pendant of Ates has run out of charges.");
  TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
}

/** A worn option names its destination: the cache holds them as item params from the first worn option on. */
function wornTeleport({ player, item, itemId, clickType }) {
  const label = core.CacheDefinitions.getItem(itemId)?.params?.get(WORN_OPTION_PARAM + clickType - FIRST_WORN_OPTION_CLICK);
  const destination = DESTINATIONS.find((entry) => entry.label === label);
  if (!destination) return false;
  teleport(player, item, destination);
}

/** The Rub submenu: its entries arrive as sub-operations numbered from 1, in the cache's order. */
function rub({ player, item, subOpId }) {
  const destination = DESTINATIONS[subOpId - 1];
  if (!destination) return false;
  teleport(player, item, destination);
}

// ------------------------------------------------------------------ charges

function check({ player, item }) {
  const count = charges(item);
  player.sendMessage(count > 0 ? `Your Pendant of Ates has ${plural(count, "charge")} left.` : "Your Pendant of Ates has no charges.");
}

function chargeWithTears({ player, usedItem, usedItemId, usedWithItem }) {
  const pendant = usedItemId === core.ItemIdentifiers.FROZEN_TEAR ? usedWithItem : usedItem;
  const have = charges(pendant);
  const tears = player.getInventory().getAmount(core.ItemIdentifiers.FROZEN_TEAR);
  if (have >= MAX_CHARGES) {
    player.sendMessage("Your Pendant of Ates cannot hold any more charges.");
    return;
  }
  const added = Math.min(tears, MAX_CHARGES - have);
  player.getInventory().deleteNumber(core.ItemIdentifiers.FROZEN_TEAR, added);
  setCharges(player, pendant, have + added);
  player.sendMessage(`You charge your Pendant of Ates with ${plural(added, "frozen tear")}. It now has ${plural(have + added, "charge")}.`);
}

function hasRoomForTears(player) {
  const inventory = player.getInventory();
  return inventory.contains(core.ItemIdentifiers.FROZEN_TEAR) || inventory.getFreeSlots() > 0;
}

function uncharge({ player, item }) {
  const count = charges(item);
  if (count <= 0) return;
  if (!hasRoomForTears(player)) {
    player.sendMessage("You don't have enough inventory space to uncharge the pendant.");
    return;
  }
  setCharges(player, item, 0);
  player.getInventory().adds(core.ItemIdentifiers.FROZEN_TEAR, count);
  player.sendMessage(`You uncharge your Pendant of Ates and get back ${plural(count, "frozen tear")}.`);
}

function dismantle({ player, item, slot }) {
  const inventory = player.getInventory();
  if (inventory.getItems()[slot] !== item) return;
  inventory.deleteAtSlot(slot, 1);
  inventory.adds(core.ItemIdentifiers.FROZEN_TEAR, DISMANTLE_TEARS);
  player.sendMessage(`You dismantle the pendant and get ${plural(DISMANTLE_TEARS, "frozen tear")}.`);
}

function attach(pluginApi) {
  init(pluginApi);
  pluginApi.persistAttribute(STATUES_ATTRIBUTE, 0);
  pluginApi.onPlayerLogin(sendStatues);
  pluginApi.onObjectInteraction("Statue", { Activate: activateStatue });
  pluginApi.onItemOnItem("Frozen tear", "Pendant of Ates (inert)", chargeWithTears);
  pluginApi.onItemOnItem("Frozen tear", "Pendant of Ates", chargeWithTears);
  pluginApi.onItemAction("Pendant of Ates (inert)", { Check: check, Dismantle: dismantle });
  pluginApi.onItemAction("Pendant of Ates", {
    Rub: rub,
    Check: check,
    Uncharge: uncharge,
    Darkfrost: wornTeleport,
    "Twilight Temple": wornTeleport,
    "Ralos' Rise": wornTeleport,
    "North Aldarin": wornTeleport,
    Kastori: wornTeleport,
    "Nemus Retreat": wornTeleport,
  });
}

module.exports = {
  name: "PendantOfAtes",
  description: "Charges the Pendant of Ates with frozen tears and teleports to the Ates statues the player has activated, one charge each.",
  members: true,
  register: attach,
  CHARGES_META_KEY,
  MAX_CHARGES,
  DESTINATIONS,
  _test: { charges, setCharges, chargeWithTears, uncharge, dismantle, teleport, rub, activateStatue, sendStatues, check },
};
