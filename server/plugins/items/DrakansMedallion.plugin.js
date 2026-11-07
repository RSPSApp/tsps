"use strict";

/**
 * Drakan's medallion (https://oldschool.runescape.wiki/w/Drakan%27s_medallion).
 *
 * Inventory "Teleport" asks where; the worn amulet lists the destinations as its own options
 * (the cache's worn params 451-454: Ver Sinhaza, Darkmeyer, Slepe, Castle Drakan). Each is a
 * standard teleport (rsprox recordings 396, 403, 1429, 4266, 4269, 4288: teleport_casting and
 * human_castteleport on the click, the move on tick 3) that cannot go past level 20 Wilderness.
 *
 * - Ver Sinhaza (3649,3230) has no unlock, so A Taste of Hope's reward works at once;
 * - Darkmeyer (3592,3337) is added by Sins of the Father, Castle Drakan by The Blood Moon Rises,
 *   through the "drakan-medallion:destinations" event;
 * - Slepe (3166,7711, the Sisterhood Sanctuary) is unlocked by using a Slepey tablet on the
 *   medallion, which uses the tablet up (Wiki: Slepey tablet).
 */
const SLEPE_UNLOCKED_ATTRIBUTE = "drakans-medallion:slepe-unlocked";
const DESTINATIONS_EVENT = "drakan-medallion:destinations";
const WILDERNESS_LIMIT = 20;
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;
const PROMPT = "Where would you like to teleport?";

const VER_SINHAZA = { label: "Ver Sinhaza", tile: { x: 3649, y: 3230, z: 0 } };
const SLEPE = { label: "Slepe", tile: { x: 3166, y: 7711, z: 0 } };
/** The cache's worn option order, which the menu keeps. */
const DESTINATION_ORDER = ["Ver Sinhaza", "Darkmeyer", "Slepe", "Castle Drakan"];

let api = null;
let core = null;

/** Quests label theirs "Castle Drakan." for the prompt; the worn options have no full stop. */
function labelOf(destination) {
  return String(destination.label).replace(/\.$/, "");
}

function destinationsFor(player) {
  const destinations = [VER_SINHAZA];
  if (player.getAttribute(SLEPE_UNLOCKED_ATTRIBUTE) === true) destinations.push(SLEPE);
  api.emitCustomEvent(DESTINATIONS_EVENT, { player, destinations });
  return destinations
    .map((destination) => ({ ...destination, label: labelOf(destination) }))
    .sort((a, b) => DESTINATION_ORDER.indexOf(a.label) - DESTINATION_ORDER.indexOf(b.label));
}

function teleportTo(player, destination) {
  const target = new core.Location(destination.tile.x, destination.tile.y, destination.tile.z);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LIMIT)) return;
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => destination.onTeleport?.());
}

function chooseDestination(player) {
  const options = destinationsFor(player).flatMap((destination) => [
    `${destination.label}.`,
    () => teleportTo(player, destination),
  ]);
  api.sendMultiChatboxPrompt(player, PROMPT, ...options);
}

function wornOptionName(itemId, clickType) {
  const index = clickType - FIRST_WORN_OPTION_CLICK;
  if (index < 0) return null;
  return core.CacheDefinitions.getItem(itemId)?.params?.get?.(WORN_OPTION_PARAM + index) ?? null;
}

/** A worn destination option; one the player has not unlocked does nothing. */
function teleportWorn(event) {
  if (event.interfaceId !== core.Equipment.INVENTORY_INTERFACE_ID) return false;
  const option = String(event.option ?? wornOptionName(event.itemId, event.clickType) ?? "");
  const destination = destinationsFor(event.player).find((entry) => entry.label === option);
  if (destination) teleportTo(event.player, destination);
  return destination !== undefined;
}

function teleportFromInventory(event) {
  chooseDestination(event.player);
  return true;
}

function useSlepeyTablet(event) {
  const { player } = event;
  const tabletSlot = event.usedItemId === core.ItemIdentifiers.SLEPEY_TABLET ? event.usedItemSlot : event.usedWithItemSlot;
  event.handled = true;
  if (player.getAttribute(SLEPE_UNLOCKED_ATTRIBUTE) === true) return;
  player.getInventory().deleteAtSlot(tabletSlot, 1);
  player.setAttribute(SLEPE_UNLOCKED_ATTRIBUTE, true);
}

module.exports = {
  name: "DrakansMedallion",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(SLEPE_UNLOCKED_ATTRIBUTE, false);
    api.onItemAction("Drakan's medallion", {
      Teleport: teleportFromInventory,
      "Ver Sinhaza": teleportWorn,
      Darkmeyer: teleportWorn,
      Slepe: teleportWorn,
      "Castle Drakan": teleportWorn,
    });
    api.onItemOnItem("Slepey tablet", "Drakan's medallion", useSlepeyTablet, { noted: false });
  },
};
