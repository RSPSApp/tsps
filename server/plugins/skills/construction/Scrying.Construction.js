"use strict";

const { api, CountdownTask, DialogueChainBuilder, StatementDialogue, ActionDialogue, Location, TaskManager, World } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const Estate = require("./Estate.Construction");
const House = require("./House.Construction");
const Portals = require("./Portals.Construction");

// The scrying pool (rsprox captures): Scry asks "Observe which location?" with the room's directed
// portals and "Entrance portal" ("You cannot use the scrying pool while in building mode."), then
// moves the player's view there: the player is placed at the destination with the poh_scrying_pool
// overlay and "You view <place>..." ("You view the Yanille portal..." for the entrance) until they
// continue, when "You see N adventurers in the area." ("You see no adventurers in the area.") and
// they come back to the pool. The portal nexus's Scry Mode views the same way (Nexus).
// Direct-portal is the portal chamber's (Portals). The live game hides the scrying player; this
// server has no hidden players, so they stand at the destination while they look.
const OVERLAY = Ids.iface("poh_scrying_pool");
const OVERLAY_ATMOSPHERE_UID = Ids.component("toplevel_osrs_stretch:overlay_atmosphere");
const LOOK_TICKS = 50;
/** Ours: how far from the viewed tile other players count as "in the area" (the view distance). */
const AREA_DISTANCE = 15;
/** Where a view looks from, when it isn't the teleport's landing (captured views). */
const VIEW_TILES = new Map([
  ["lumbridge", [3219, 3217, 0]], ["falador", [2960, 3385, 0]], ["the grand exchange", [3161, 3479, 0]],
  ["seers' village", [2724, 3487, 0]], ["arceuus library", [1637, 3844, 0]],
]);

/** player -> where to put them back */
const scrying = new WeakMap();

function poolAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture?.buildableKey === "SCRYING_POOL" ? house : null;
}

function title(name) {
  return name.replace(/ teleport$/, "").replace(/\b\w/g, letter => letter.toUpperCase());
}

/** The place's name in "You view ...": the Grand Exchange takes "the" (captured). */
function viewName(name) {
  return name === "Grand Exchange" ? `the ${name}` : name;
}

/** The tile a view of `name` looks from: the captured one, else `fallback` (the teleport's landing). */
function viewTile(name, fallback) {
  const tile = VIEW_TILES.get(name.toLowerCase());
  return tile ? new Location(...tile) : fallback;
}

/** "You see N adventurers in the area.", counting the other players near `tile`. */
function adventurers(player, tile) {
  let count = 0;
  for (const other of World.getPlayers()) {
    if (other && other !== player && other.getLocation().isWithinDistance(tile, AREA_DISTANCE)) count++;
  }
  // Ours: the wording for one player.
  const seen = count === 0 ? "no adventurers" : count === 1 ? "1 adventurer" : `${count} adventurers`;
  return `You see ${seen} in the area.`;
}

function entranceName(house) {
  return `the ${Estate.houseLocation(house.save).name} portal`;
}

function scry(event) {
  const house = poolAt(event);
  if (!house) return false;
  const player = event.player;
  if (house.buildingMode) return player.sendMessage("You cannot use the scrying pool while in building mode."), true;
  const position = house.getRoomPositionAt(event.location);
  const portals = Object.values(house.getRoom(position)?.furnitureByLocation ?? {})
    .filter(value => value.buildableKey.endsWith("_PORTAL_FRAME") && value.destinations?.[0]);
  const known = Portals.houseDestinations();
  const choices = portals.map(portal => known.find(data => data.name === portal.destinations[0]))
    .filter(Boolean).slice(0, 4).map(data => [title(data.name), title(data.name), data.destination]);
  choices.push(["Entrance portal", entranceName(house), Estate.houseExit(house.save)]);
  api.sendMultiChatboxPrompt(player, "Observe which location?", ...choices.flatMap(([label, name, destination]) =>
    [label, () => look(player, house, viewName(name), viewTile(viewName(name), destination))]));
  return true;
}

/** Views `destination` as `name` ("You view <name>..."), then brings the player back. */
function look(player, house, name, destination) {
  if (House.houseFor(player) !== house || house.buildingMode) return;
  const at = player.getLocation();
  const position = house.getRoomPositionAt({ x: at.getX(), y: at.getY(), z: at.getZ() });
  const corner = house.roomCorner(position);
  const tile = destination.clone ? destination.clone() : new Location(destination.getX(), destination.getY(), destination.getZ());
  const back = { owner: house.owner.getUsername(), own: house.owner === player, position, dx: at.getX() - corner.getX(), dy: at.getY() - corner.getY(), exit: Estate.houseExit(house.save), houseLocation: Estate.houseLocation(house.save).id, tile };
  scrying.set(player, back);
  house.exitHouse(player, tile.clone());
  player.getMovementQueue().setBlockMovement(true).reset();
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, OVERLAY, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, `You view ${name}...`),
    new ActionDialogue(1, { execute: () => comeBack(player, true) }),
  ));
  TaskManager.submit(new CountdownTask(player, LOOK_TICKS, () => comeBack(player)));
}

/**
 * Back to the pool: the owner's own house loads again; a guest visits the owner again if they can.
 * Continuing the view first says how many players are there.
 */
function comeBack(player, continued = false) {
  const back = scrying.get(player);
  if (!back || !player.isRegistered()) return;
  scrying.delete(player);
  if (continued) player.sendMessage(adventurers(player, back.tile));
  player.getMovementQueue().setBlockMovement(false);
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  player.getPacketSender().sendInterfaceRemoval();
  if (back.own) House.enterHouse(player, false);
  else House.visitHouse(player, back.owner, back.houseLocation);
  const house = House.houseFor(player);
  if (!house) return player.moveTo(back.exit);
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (House.houseFor(player) !== house || !house.getRoom(back.position)) return;
    const corner = house.roomCorner(back.position);
    player.moveTo(new Location(corner.getX() + back.dx, corner.getY() + back.dy, corner.getZ()));
  }));
}

/** onPlayerLogout mid-scry: they log back in at the house's entrance. */
function loggedOut({ player }) {
  const back = scrying.get(player);
  if (!back) return;
  scrying.delete(player);
  player.moveTo(back.exit);
}

function attachScrying(api) {
  api.onObjectInteraction("Scrying pool", { Scry: scry });
  api.onPlayerLogout(loggedOut);
}

Object.assign(module.exports, { attachScrying, look, viewName, viewTile, adventurers, entranceName });
