/**
 * Fossil Island's rowboats and the sea floor north of it: https://oldschool.runescape.wiki/w/Underwater
 *
 * The camp, north-shore and small-island rowboats row between each other, and the small island's
 * boat dives to the sea floor (Ceto, drift nets, Mernia's seaweed). Down there an oxygen bar
 * drains 1% every 3 ticks unless a fishbowl helmet and diving apparatus, or the Medallion of the
 * Deep, are worn; at 0% the player drowns, losing 10-20 mermaid's tears, and wakes on the small
 * island. The anchor rope climbs back up to it.
 *
 * Captures (rsprox): each boat's menu and its "You row ..." message, the fade, the dive landing at
 * 3732,10281 on plane 1 with fossil_underwater_oxygen at 1000 and the fossil_underwater overlay
 * (underwater_shallow in its water_overlay), the "Dive without diving gear?" warning after the
 * player's line, the rope's bubbles and 3769,3898. The barge routes are left out: the barge isn't
 * in this map (see BoneVoyage.Quest.js). Not done yet: air bubbles and pufferfish refilling
 * oxygen, and the "Your hands are full." swim prompt.
 *
 * The drift-net area is a private instance, so the sea floor can't be an Area that players stay
 * in: underwater players are followed per map square, and one task visits only them.
 */
const DATA = require("./data/fossil-island-underwater.json");

const OXYGEN_VARBIT = 5811; // fossil_underwater_oxygen
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const UNDERWATER_OVERLAY = 609; // fossil_underwater
const WATER_OVERLAY_UID = (UNDERWATER_OVERLAY << 16) | 2; // fossil_underwater:water_overlay
const SHALLOW_WATER = 169; // underwater_shallow
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const BUBBLES_GRAPHIC = 603; // 100_pirate_bubbles_spotanim
// Stand, turn, walk, turn around, turn right, turn left, run: human_real_swimming_ready / human_real_swimming.
const SWIM_ANIMATIONS = [3418, 3415, 3415, 3415, 3415, 3415, 3415];
const MOVE_TICKS = 2;
const NO_DIVE_WARNING_ATTRIBUTE = "fossil-island:no-dive-warning";
const SEA_FOUND_ATTRIBUTE = "fossil-island:sea-found";

const NO_GEAR_LINE = "Hmm, it would be easier if I had some method of breathing under water.";
const NO_WARNING_MESSAGE = "Speak to Mairin if you ever want to re-enable the warning.";
const SEA_FOUND_MESSAGE = "Now you have discovered this area, you'll be able to row here directly from the camp!";
// ponytail: no capture or Wiki quote for drowning; this line is ours.
const DROWN_MESSAGE = "You run out of oxygen and are dragged back to the surface.";

let core;
let pluginApi;
let BOATS = new Map();
let UNDERWATER_SQUARES = new Set();

/** Underwater players and their oxygen, 0 to DATA.oxygen.max. */
const oxygen = new Map();
const drainTicks = new Map();

function defineData() {
  const { ObjectIdentifiers: Objects } = core;
  BOATS = new Map([[Objects.ROWBOAT_6, "camp"], [Objects.ROWBOAT_11, "north"], [Objects.ROWBOAT_12, "diving"]]);
  const [minX, maxX, minY, maxY] = DATA.underwater.box;
  UNDERWATER_SQUARES = new Set();
  for (let x = minX >> 6; x <= maxX >> 6; x++) {
    for (let y = minY >> 6; y <= maxY >> 6; y++) UNDERWATER_SQUARES.add(`${x},${y}`);
  }
}

function toLocation([x, y, z]) {
  return new core.Location(x, y, z);
}

function later(ticks, action) {
  class FossilIslandDelay extends core.Task {
    execute() {
      this.stop();
      action();
    }
  }
  core.TaskManager.submit(new FossilIslandDelay(Math.max(1, ticks)));
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** Fades out, moves the player after MOVE_TICKS and fades back in (the sea floor's overlay replaces the fade). */
function travel(player, to) {
  fade(player, true);
  later(MOVE_TICKS, () => {
    if (!player.isRegistered()) return;
    player.moveTo(toLocation(to));
    if (isUnderwater(player.getLocation())) return;
    fade(player, false);
    later(MOVE_TICKS, () => player.isRegistered() && !oxygen.has(player) && player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  });
}

function isUnderwater(location) {
  const [minX, maxX, minY, maxY] = DATA.underwater.box;
  const x = location.getX(), y = location.getY();
  return location.getZ() === DATA.underwater.plane && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function breathingGear(player) {
  const { ItemIdentifiers: Items } = core;
  const equipment = player.getEquipment();
  return equipment.contains(Items.MEDALLION_OF_THE_DEEP)
    || (equipment.contains(Items.FISHBOWL_HELMET) && equipment.contains(Items.DIVING_APPARATUS));
}

function row(player, destination) {
  const { to, message } = DATA.destinations[destination];
  player.sendMessage(message);
  if (destination === "sea" && !player.getAttribute(SEA_FOUND_ATTRIBUTE)) {
    player.setAttribute(SEA_FOUND_ATTRIBUTE, true);
    player.sendMessage(SEA_FOUND_MESSAGE);
  }
  travel(player, to);
}

function descend(player) {
  travel(player, DATA.arrival);
}

function stopWarning(player) {
  player.setAttribute(NO_DIVE_WARNING_ATTRIBUTE, true);
  player.sendMessage(NO_WARNING_MESSAGE);
  descend(player);
}

function warnBeforeDiving(player) {
  const { DialogueChainBuilder, PlayerDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder();
  chain.add(new PlayerDialogue(0, NO_GEAR_LINE));
  chain.add(new ActionDialogue(1, { execute: () => pluginApi.sendMultiChatboxPrompt(player, "Dive without diving gear?",
    "Yes, dive anyway.", descend,
    "Yes, dive anyway, and don't ask this again.", stopWarning,
    "No.", () => {}) }));
  player.getDialogueManager().startDialogues(chain);
}

function dive({ player }) {
  if (breathingGear(player) || player.getAttribute(NO_DIVE_WARNING_ATTRIBUTE)) descend(player);
  else warnBeforeDiving(player);
  return true;
}

function boatMenu({ player, objectId }) {
  const boat = BOATS.get(objectId);
  if (!boat) return false;
  const routes = DATA.boats[boat].filter(([, to]) => boat !== "camp" || to !== "sea" || player.getAttribute(SEA_FOUND_ATTRIBUTE));
  const options = routes.flatMap(([label, to]) => [label, () => (to === "dive" ? dive({ player }) : row(player, to))]);
  pluginApi.sendMultiChatboxPrompt(player, "Select an option", ...options, "Cancel.", () => {});
  return true;
}

function boatDive(event) {
  if (BOATS.get(event.objectId) !== "diving") return false;
  return dive(event);
}

/** Ladders asks before guessing: the anchor rope goes up to the small island. */
function climbRope(request) {
  if (request.objectId !== core.ObjectIdentifiers.ANCHOR_ROPE) return;
  request.handled = true;
  const { player } = request;
  player.performGraphic(new core.Graphic(BUBBLES_GRAPHIC));
  later(MOVE_TICKS, () => player.isRegistered() && player.moveTo(toLocation(DATA.surface)));
}

function sendOxygen(player) {
  player.getPacketSender().sendVarbit(OXYGEN_VARBIT, oxygen.get(player));
}

function swim(player, swimming) {
  player.setRenderAnimations(swimming ? SWIM_ANIMATIONS : null);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function enterWater(player) {
  swim(player, true);
  oxygen.set(player, DATA.oxygen.max);
  drainTicks.set(player, 0);
  const sender = player.getPacketSender();
  sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, UNDERWATER_OVERLAY, 1);
  sender.sendSubInterface(WATER_OVERLAY_UID, SHALLOW_WATER, 1);
  sendOxygen(player);
}

function leaveWater(player) {
  if (!oxygen.delete(player)) return;
  drainTicks.delete(player);
  if (!player.isRegistered()) return;
  swim(player, false);
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** Wiki: drowning does no damage; 10-20 mermaid's tears carried are lost, and the player is back on the small island. */
function drown(player) {
  const tears = core.ItemIdentifiers.MERMAIDS_TEAR;
  const [min, max] = DATA.drownTears;
  const lost = Math.min(player.getInventory().getAmount(tears), min + Math.floor(Math.random() * (max - min + 1)));
  if (lost > 0) player.getInventory().deleteNumber(tears, lost);
  player.sendMessage(DROWN_MESSAGE);
  leaveWater(player);
  player.moveTo(toLocation(DATA.surface));
}

function breathe(player) {
  if (breathingGear(player)) {
    if (oxygen.get(player) !== DATA.oxygen.max) { oxygen.set(player, DATA.oxygen.max); sendOxygen(player); }
    return;
  }
  const ticks = drainTicks.get(player) + 1;
  if (ticks < DATA.oxygen.everyTicks) { drainTicks.set(player, ticks); return; }
  drainTicks.set(player, 0);
  oxygen.set(player, Math.max(0, oxygen.get(player) - DATA.oxygen.drain));
  sendOxygen(player);
  if (oxygen.get(player) === 0) drown(player);
}

function underwaterTick() {
  for (const player of [...oxygen.keys()]) {
    if (!player.isRegistered()) { oxygen.delete(player); drainTicks.delete(player); continue; }
    if (player.getHitpoints() > 0) breathe(player);
  }
}

function startTicking() {
  class FossilIslandUnderwaterTask extends core.Task { execute() { underwaterTick(); } }
  core.TaskManager.submit(new FossilIslandUnderwaterTask(1));
}

function followWater(player) {
  const location = player.getLocation();
  const square = UNDERWATER_SQUARES.has(`${location.getX() >> 6},${location.getY() >> 6}`);
  const below = square && isUnderwater(location);
  if (below && !oxygen.has(player)) enterWater(player);
  else if (!below) leaveWater(player);
}

function mapSquareChanged({ player }) {
  followWater(player);
}

function login({ player }) {
  followWater(player);
}

function logout({ player }) {
  oxygen.delete(player);
  drainTicks.delete(player);
}

module.exports = {
  name: "FossilIslandUnderwater",
  members: true,
  _test: { oxygen, underwaterTick, followWater, breathingGear, boatMenu, dive, climbRope },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onServerStartup(defineData);
    api.onServerStartup(startTicking);
    api.persistAttribute(NO_DIVE_WARNING_ATTRIBUTE, false);
    api.persistAttribute(SEA_FOUND_ATTRIBUTE, false);
    api.onObjectInteraction("Rowboat", { Travel: boatMenu, Dive: boatDive });
    api.onCustomEvent("ladders:climb", climbRope);
    api.onPlayerLogin(login);
    api.onPlayerMapSquareChange(mapSquareChanged);
    api.onPlayerLogout(logout);
  },
};
