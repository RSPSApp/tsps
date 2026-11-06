"use strict";

const { api, Location, TeleportHandler, TeleportType } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const { JEWELLERY, RING_OF_WEALTH_DESTINATIONS, DEFAULT_WILDERNESS_LEVEL } = require("../../items/Teleports.Jewellery");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");
const BOX_DATA = require("./data/jewellery-box.json");

// rsprox captures: Teleport Menu opens this modal, its init script lays out the destinations, and
// a destination click is a resume_pausebutton on the universe layer with the slot as sub.
const JEWELLERY_BOX_INTERFACE = Ids.iface("poh_jewellery_box");
const JEWELLERY_BOX_UNIVERSE = (JEWELLERY_BOX_INTERFACE << 16) | 0;
const JEWELLERY_BOX_INIT_SCRIPT = 1685;
const PAUSE_BUTTON_EVENTS = 1;
// poh_jewellerybox_multi: the last destination (slot + 1), which also picks the box's quick-teleport op.
const LAST_DESTINATION_VARBIT = Ids.varbit("poh_jewellerybox_multi");
const LAST_DESTINATION_ATTRIBUTE = "construction:jewellery-box-last";
// The init script strikes out destinations whose bit is clear (0 Tears of Guthix, 1 Kourend,
// 2 Miscellania, 3 Dondakan's Rock, 4 Fortis Colosseum). The jewellery doesn't gate the first four
// on this server, so they stay open. rsprox captures (rev 224-239, 61 of 62 recordings) send 15:
// Fortis Colosseum stays struck out until the Colosseum's Hero title (Wiki, Ring of dueling).
const OTHER_DESTINATIONS_OPEN = 0b01111;
const COLOSSEUM_OPEN = 0b10000;

const TILES_BY_JEWELLERY = new Map([
  ...JEWELLERY.map(piece => [piece.key, piece.destinations]),
  ["wealth", RING_OF_WEALTH_DESTINATIONS],
]);
const DESTINATIONS = BOX_DATA.destinations.map(({ jewellery, label }) => {
  const destination = TILES_BY_JEWELLERY.get(jewellery)
    ?.find(entry => label.startsWith(entry.label) || entry.aliases?.includes(label));
  if (!destination) throw new Error(`Jewellery box: no ${jewellery} destination for ${label}`);
  return { label, tile: destination.tile, jewellery, colosseumRank: destination.colosseumRank, lockedMessage: destination.lockedMessage };
});
// The quick-teleport op is named after the last destination, so every label leads to it.
const BOX_OPTIONS = {
  "Teleport Menu": openTeleportMenu,
  ...Object.fromEntries(DESTINATIONS.map(destination => [destination.label, teleportToLast])),
};

const openMenus = new WeakMap();

function boxAt(event) {
  const box = BOX_DATA.boxes[event.definition?.getName()];
  return box && House.houseFor(event.player) ? box : null;
}

function destinationTile(player, slot) {
  const { tile } = DESTINATIONS[slot];
  const [x, y, z] = typeof tile === "function" ? tile(player, api) : tile;
  return new Location(x, y, z);
}

/** Whether the player has reached a Fortis Colosseum Glory title (the Colosseum plugin answers). */
function colosseumRankReached(player, rank) {
  const request = { player, rank, reached: false };
  api.emitCustomEvent("colosseum:has-rank", request);
  return request.reached === true;
}

function destinationMask(player) {
  const colosseum = DESTINATIONS.find(destination => destination.colosseumRank);
  return OTHER_DESTINATIONS_OPEN | (!colosseum || colosseumRankReached(player, colosseum.colosseumRank) ? COLOSSEUM_OPEN : 0);
}

function teleport(player, slot) {
  const { colosseumRank, lockedMessage } = DESTINATIONS[slot];
  if (colosseumRank && !colosseumRankReached(player, colosseumRank)) return Menu.refuse(player, Menu.messageBox(lockedMessage));
  const target = destinationTile(player, slot);
  if (!TeleportHandler.checkReqs(player, target, DEFAULT_WILDERNESS_LEVEL)) return;
  TeleportHandler.teleport(player, target, TeleportType.NORMAL, false, () => rememberDestination(player, slot));
}

function rememberDestination(player, slot) {
  player.setAttribute(LAST_DESTINATION_ATTRIBUTE, slot + 1);
  player.getPacketSender().sendVarbit(LAST_DESTINATION_VARBIT, slot + 1);
}

function openTeleportMenu(event) {
  const box = boxAt(event);
  if (!box) return false;
  const sender = event.player.getPacketSender();
  sender.sendInterfaceFlagsRange(JEWELLERY_BOX_UNIVERSE, 0, box.slots - 1, PAUSE_BUTTON_EVENTS);
  sender.sendInterface(JEWELLERY_BOX_INTERFACE);
  sender.sendClientScript(JEWELLERY_BOX_INIT_SCRIPT, box.tier, event.definition.getName(), destinationMask(event.player));
  openMenus.set(event.player, box);
  return true;
}

function teleportToLast(event) {
  const box = boxAt(event);
  const slot = event.player.getPacketSender().getVarbit(LAST_DESTINATION_VARBIT) - 1;
  if (!box || slot < 0 || slot >= box.slots) return false;
  teleport(event.player, slot);
  return true;
}

function chooseDestination(event) {
  if (event.groupId !== JEWELLERY_BOX_INTERFACE || event.childId !== 0) return;
  event.handled = true;
  const box = openMenus.get(event.player);
  openMenus.delete(event.player);
  event.player.getPacketSender().sendInterfaceRemoval();
  if (!box || !Number.isInteger(event.action) || event.action < 0 || event.action >= box.slots) return;
  if (!House.houseFor(event.player)) return;
  teleport(event.player, event.action);
}

function closeMenu({ player }) {
  openMenus.delete(player);
}

function restoreLastDestination({ player }) {
  const last = player.getAttribute(LAST_DESTINATION_ATTRIBUTE) ?? 0;
  if (last) player.getPacketSender().sendVarbit(LAST_DESTINATION_VARBIT, last);
}

/** The Wilderness level a box destination's own jewellery teleports from (dragonstone pieces 30, Wiki). */
function wildernessLevelOf(jewellery) {
  const piece = JEWELLERY.find((entry) => entry.key === jewellery);
  return piece?.wildernessLevel ?? (jewellery === "wealth" ? JEWELLERY.find((entry) => entry.key === "glory")?.wildernessLevel : null) ?? DEFAULT_WILDERNESS_LEVEL;
}

/**
 * "construction:jewellery-box-destinations" { player, list }: the ornate box's destinations, as
 * { label, location, wildernessLevel } (a league relic's pendant).
 */
function destinationsEvent(request) {
  if (!request?.player || !Array.isArray(request.list)) return;
  DESTINATIONS.forEach((destination, slot) => request.list.push({
    label: destination.label, location: destinationTile(request.player, slot), wildernessLevel: wildernessLevelOf(destination.jewellery),
  }));
}

function attachJewelleryBoxes(api) {
  api.persistAttribute(LAST_DESTINATION_ATTRIBUTE, 0);
  api.onCustomEvent("construction:jewellery-box-destinations", destinationsEvent);
  for (const name of Object.keys(BOX_DATA.boxes)) api.onObjectInteraction(name, BOX_OPTIONS);
  api.onInterfaceActionClick(chooseDestination);
  api.onCustomEvent("interface:close", closeMenu);
  api.onPlayerLogin(restoreLastDestination);
}

Object.assign(module.exports, { attachJewelleryBoxes });
