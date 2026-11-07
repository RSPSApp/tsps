"use strict";

const { Location, Animation, Graphic, Priority, TeleportHandler, TeleportType } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const { JEWELLERY, DEFAULT_WILDERNESS_LEVEL, LOCKED_DESTINATION_MESSAGE } = require("../../items/Teleports.Jewellery");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");

// rsprox captures: the mounted talisman casts arceuus_necromancy_anim with xeric_teleport_spotanim
// and lands three ticks later, with no landing animation.
const XERICS_TELEPORT = new TeleportType(3, new Animation(Ids.seq("arceuus_necromancy_anim"), Priority.HIGH), null, null, new Graphic(Ids.spotanim("xeric_teleport_spotanim")), null, null);
const MYTHS_GUILD = [2458, 2850, 0];

const destinationsOf = key => JEWELLERY.find(piece => piece.key === key).destinations;
const entryOf = (key, label) => destinationsOf(key).find(entry => entry.label === label || entry.aliases?.includes(label));
const tileOf = (key, label) => entryOf(key, label).tile;
/** Wiki (Digsite pendant): the mounted one has "the same locations as the normal unmounted version", quests included. */
const questOf = (key, label) => entryOf(key, label).quest ?? null;

/**
 * Mounted amulets in the portal nexus room. Each left-click setting is its own loc, so configuring
 * one swaps the furniture's displayed loc; the base loc has no left-click teleport.
 * Destinations, menu titles and labels are from rsprox captures (script 217 arguments).
 * Xeric's tiles are the middle of the captured landing spots: tsps has no Xeric's talisman item.
 */
const AMULETS = {
  "Xeric's Talisman": {
    base: Ids.loc("poh_amulet_xeric"),
    teleportTitle: "Xeric's Talisman teleports",
    configTitle: "Xeric's Talisman left click",
    teleportType: XERICS_TELEPORT,
    destinations: [
      { label: "Xeric's Lookout", option: "Look out", loc: Ids.loc("poh_amulet_xeric_lookout"), tile: [1578, 3529, 0] },
      { label: "Xeric's Glade", option: "Glade", loc: Ids.loc("poh_amulet_xeric_glade"), tile: [1751, 3566, 0] },
      { label: "Xeric's Inferno", option: "Inferno", loc: Ids.loc("poh_amulet_xeric_inferno"), tile: [1505, 3819, 0] },
      { label: "Xeric's Heart", option: "Heart", loc: Ids.loc("poh_amulet_xeric_heart"), tile: [1642, 3673, 0] },
      // As the worn talisman: Honour needs its ancient tablet unlock (KourendTravelItems answers).
      { label: "Xeric's Honour", option: "Honour", loc: Ids.loc("poh_amulet_xeric_honour"), tile: [1254, 3563, 0], honour: true },
    ],
  },
  "Digsite Pendant": {
    base: Ids.loc("poh_amulet_digsite"),
    teleportTitle: "Digsite Pendant teleport",
    configTitle: "Digsite Pendant left click",
    teleportType: TeleportType.NORMAL,
    destinations: [
      { label: "Digsite", option: "Digsite", loc: Ids.loc("poh_amulet_dig_digsite"), tile: tileOf("digsite", "Digsite") },
      { label: "Fossil Island", option: "Fossil Island", loc: Ids.loc("poh_amulet_dig_fossil"), tile: tileOf("digsite", "Fossil Island"), quest: questOf("digsite", "Fossil Island") },
      { label: "Lithkren", option: "Lithkren", loc: Ids.loc("poh_amulet_dig_lithkren"), tile: tileOf("digsite", "Lithkren"), quest: questOf("digsite", "Lithkren") },
    ],
  },
};
const NOWHERE = "Nowhere";

function inHouse(event) {
  return House.houseFor(event.player) ? event.player : null;
}

function teleport(player, tile, teleportType = TeleportType.NORMAL) {
  const target = new Location(...tile);
  if (!TeleportHandler.checkReqs(player, target, DEFAULT_WILDERNESS_LEVEL)) return;
  TeleportHandler.teleport(player, target, teleportType, false);
}

/** Mounted amulet of glory: each op is a destination, in the amulet's order. */
function gloryTeleport(event) {
  const player = inHouse(event);
  if (!player) return false;
  teleport(player, tileOf("glory", event.definition.getInteractions()[event.clickType - 1]));
  return true;
}

function mythicalCapeTeleport(event) {
  const player = inHouse(event);
  if (!player) return false;
  teleport(player, MYTHS_GUILD);
  return true;
}

function amuletOf(event) {
  return inHouse(event) ? AMULETS[event.definition?.getName()] : null;
}

let pluginApi = null;

/** A mounted destination's quest lock, as the worn piece checks it; refused with the Wiki's line. */
function destinationUnlocked(player, destination) {
  if (destination.honour) {
    const query = { player, unlocked: false };
    pluginApi.emitCustomEvent("xerics-talisman:honour-unlocked", query);
    if (query.unlocked === true) return true;
  } else {
    if (!destination.quest) return true;
    const query = { player, key: destination.quest.key, complete: false };
    pluginApi.emitCustomEvent("quest:is-complete", query);
    if (query.complete === true) return true;
  }
  const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, LOCKED_DESTINATION_MESSAGE)));
  return false;
}

function amuletTeleport(event) {
  const amulet = amuletOf(event);
  const destination = amulet?.destinations.find(entry => entry.loc === event.objectId);
  if (!destination) return false;
  if (destinationUnlocked(event.player, destination)) teleport(event.player, destination.tile, amulet.teleportType);
  return true;
}

function amuletTeleportMenu(event) {
  const amulet = amuletOf(event);
  if (!amulet) return false;
  const labels = [...amulet.destinations.map(entry => entry.label), NOWHERE];
  Menu.openMenu(event.player, amulet.teleportTitle, labels, index => {
    const destination = amulet.destinations[index];
    if (destination && destinationUnlocked(event.player, destination)) teleport(event.player, destination.tile, amulet.teleportType);
  });
  return true;
}

function amuletConfiguration(event) {
  const amulet = amuletOf(event);
  if (!amulet) return false;
  const house = House.houseFor(event.player);
  if (house.owner !== event.player) {
    event.player.sendMessage("Only the house owner can change that.");
    return true;
  }
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture) return false;
  const labels = [...amulet.destinations.map(entry => entry.label), NOWHERE];
  Menu.openMenu(event.player, amulet.configTitle, labels, index => {
    if (House.houseFor(event.player) !== house) return;
    const destination = amulet.destinations[index];
    if (destination) furniture.displayObjectId = destination.loc;
    else delete furniture.displayObjectId;
    House.saveHouse(house);
    house.redrawFurniture();
  });
  return true;
}

const GLORY_OPTIONS = Object.fromEntries(destinationsOf("glory").map(entry => [entry.label, gloryTeleport]));
const AMULET_OPTIONS = {
  "Teleport menu": amuletTeleportMenu,
  Configuration: amuletConfiguration,
  ...Object.fromEntries(Object.values(AMULETS).flatMap(amulet => amulet.destinations.map(entry => [entry.option, amuletTeleport]))),
};

function attachMountedItems(api) {
  pluginApi = api;
  api.onObjectInteraction("Amulet of Glory", GLORY_OPTIONS);
  api.onObjectInteraction("Mythical cape", { Teleport: mythicalCapeTeleport });
  for (const name of Object.keys(AMULETS)) api.onObjectInteraction(name, AMULET_OPTIONS);
}

Object.assign(module.exports, { attachMountedItems, mythicalCapeTeleport });
