/**
 * Gnome gliders (https://oldschool.runescape.wiki/w/Gnome_glider), from
 * data/definitions/gnome-gliders.json.
 *
 * The cache's glider map (interface 138) draws the flight itself from pilot_journey (varp 153,
 * from << 14 | to), and the pilots are multi-NPCs whose "Glider-to <last destination>" option
 * follows pilot_previous_destination (varbit 9584). As in an rsprox capture of a flight to every
 * destination, on the click: the journey and a fade-out; a tick later the player lands; two
 * ticks after that the last destination and the fade-in; and a tick later all is closed again.
 * The quick option ("Glider-to ...") opens the map with the fade on the click tick.
 *
 * Needs The Grand Tree. Feldip Hills and Ape Atoll need One Small Favour and Monkey Madness II,
 * which are not implemented here, so they stay locked (the map hides their buttons until the
 * quests' own varps say otherwise).
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const QuestRuntime = require("../quests/QuestRuntime");

const GLIDER_MAP = 138;
const PILOT_JOURNEY_VARP = 153;
const PREVIOUS_DESTINATION_VARBIT = 9584;
/** Feldip Hills' and Ape Atoll's pilots read these (as pilot_multinpc_var 9567) instead. */
const MULTINPC_DEST_VARBIT = 9575;
const MULTINPC_VISIBLE_VARBIT = 9576;
const BUSY_VARBIT = 12393;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
/** The captured fade: colour 1512708 over 20 client cycles. */
const FADE_COLOUR = 1512708;
const FADE_CYCLES = 20;
/** How far a pilot may stand from his glider's landing tile. */
const PILOT_RANGE = 16;

const PREVIOUS_ATTRIBUTE = "gnome-gliders:previous";
const MULTINPC_ATTRIBUTE = "gnome-gliders:multinpc-dest";
const ORIGIN_ATTRIBUTE = "gnome-gliders:origin";
const FLYING_ATTRIBUTE = "gnome-gliders:flying";

const DATA = JSON.parse(
  fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "gnome-gliders.json"), "utf8"),
);
const DESTINATIONS = DATA.destinations.map((entry) => ({
  ...entry,
  location: new Location(entry.x, entry.y, entry.z ?? 0),
}));
const BY_BUTTON = new Map(DESTINATIONS.map((destination) => [destination.button, destination]));
const BY_OPTION = new Map(DESTINATIONS.map((destination) => [`Glider-to ${destination.name}`, destination]));
const PILOT_NAMES = [...new Set(DESTINATIONS.flatMap((destination) => destination.pilots))];

let TaskManager;

/** A quest this server does not have counts as not done: its gliders stay locked. */
function questComplete(player, name) {
  if (!name) return true;
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === name);
  return quest ? quest.isComplete(player) : false;
}

function mayFly(player) {
  if (questComplete(player, DATA.requires)) return true;
  player.sendMessage(`You need to have completed ${DATA.requires} to use the gnome gliders.`);
  return false;
}

/** The glider a pilot flies from: one listing his name whose landing tile he stands by. */
function originOf(npc, name) {
  const at = npc.getLocation();
  return DESTINATIONS.find((destination) => destination.pilots.includes(name) &&
    destination.location.getZ() === at.getZ() &&
    Math.abs(destination.location.getX() - at.getX()) <= PILOT_RANGE &&
    Math.abs(destination.location.getY() - at.getY()) <= PILOT_RANGE) ?? null;
}

function fade(player, out) {
  const args = out ? [FADE_COLOUR, 255, FADE_COLOUR, 0, FADE_CYCLES] : [FADE_COLOUR, 0, FADE_COLOUR, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

class SetBusyTask extends Task {
  constructor(player) {
    super(1);
    this.player = player;
  }

  execute() {
    this.stop();
    if (this.player.getInterfaceId?.() === GLIDER_MAP) this.player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  }
}

/** One flight, tick by tick from the click, as captured. */
class FlightTask extends Task {
  constructor(player, from, to, quick) {
    // Not keyed to the player: a click must not strand them mid-air.
    super(1);
    this.player = player;
    this.from = from;
    this.to = to;
    this.quick = quick;
    this.elapsed = 0;
  }

  execute() {
    const { player, to } = this;
    const sender = player.getPacketSender();
    this.elapsed++;
    if (this.elapsed === 1) {
      if (this.quick) sender.sendVarbit(BUSY_VARBIT, 1);
      player.moveTo(to.location.clone());
    } else if (this.elapsed === 3) {
      sender.sendVarbit(PREVIOUS_DESTINATION_VARBIT, to.index);
      player.setAttribute(PREVIOUS_ATTRIBUTE, to.index);
      fade(player, false);
    } else if (this.elapsed === 4) {
      this.stop();
      sender.sendConfig(PILOT_JOURNEY_VARP, -1);
      sender.sendVarbit(BUSY_VARBIT, 0);
      if (to.multinpcVar) {
        sender.sendVarbit(MULTINPC_VISIBLE_VARBIT, 1);
        sender.sendVarbit(MULTINPC_DEST_VARBIT, to.index);
        player.setAttribute(MULTINPC_ATTRIBUTE, to.index);
      }
      sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
      sender.sendInterfaceRemoval();
      player.getMovementQueue().setBlockMovement(false);
      player.setAttribute(FLYING_ATTRIBUTE, null);
    }
  }
}

function fly(player, from, to, quick) {
  if (player.getAttribute(FLYING_ATTRIBUTE)) return;
  player.setAttribute(FLYING_ATTRIBUTE, true);
  player.setAttribute(ORIGIN_ATTRIBUTE, null);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  const sender = player.getPacketSender();
  sender.sendConfig(PILOT_JOURNEY_VARP, (from.index << 14) | to.index);
  if (quick) sender.sendInterface(GLIDER_MAP);
  fade(player, true);
  TaskManager.submit(new FlightTask(player, from, to, quick));
}

function openMap(event) {
  const { player, npc, definition } = event;
  const origin = originOf(npc, definition.getName());
  if (!origin) return false;
  if (!mayFly(player) || player.getAttribute(FLYING_ATTRIBUTE)) return true;
  player.setAttribute(ORIGIN_ATTRIBUTE, origin.index);
  player.getPacketSender().sendInterface(GLIDER_MAP);
  TaskManager.submit(new SetBusyTask(player));
  return true;
}

function quickGlide(event) {
  const { player, npc, definition } = event;
  const origin = originOf(npc, definition.getName());
  const to = BY_OPTION.get(definition.getActions()?.[event.clickType - 1]);
  if (!origin || !to) return false;
  if (!mayFly(player) || to.index === origin.index || !questComplete(player, to.requires)) return true;
  fly(player, origin, to, true);
  return true;
}

function chooseDestination(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const groupId = event.groupId ?? (buttonId >> 16);
  const childId = event.childId ?? (buttonId & 0xffff);
  if (groupId !== GLIDER_MAP) return;
  const { player } = event;
  const to = BY_BUTTON.get(childId);
  const origin = DESTINATIONS.find((destination) => destination.index === player.getAttribute(ORIGIN_ATTRIBUTE));
  if (!to || !origin || to.index === origin.index || !questComplete(player, to.requires)) return;
  fly(player, origin, to, false);
}

/** Closing the map without flying. */
function mapClosed({ player, interfaceId }) {
  if (interfaceId !== GLIDER_MAP || player.getAttribute(FLYING_ATTRIBUTE)) return;
  player.setAttribute(ORIGIN_ATTRIBUTE, null);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

function restoreVarbits({ player }) {
  const sender = player.getPacketSender();
  const previous = player.getAttribute(PREVIOUS_ATTRIBUTE);
  if (Number.isInteger(previous)) sender.sendVarbit(PREVIOUS_DESTINATION_VARBIT, previous);
  const multinpc = player.getAttribute(MULTINPC_ATTRIBUTE);
  if (Number.isInteger(multinpc)) {
    sender.sendVarbit(MULTINPC_VISIBLE_VARBIT, 1);
    sender.sendVarbit(MULTINPC_DEST_VARBIT, multinpc);
  }
}

const PILOT_ACTIONS = {
  Glider: openMap,
  ...Object.fromEntries([...BY_OPTION.keys()].map((option) => [option, quickGlide])),
};

module.exports = {
  name: "GnomeGliders",
  members: true,
  register(api) {
    TaskManager = api.getTaskManager();
    api.persistAttribute(PREVIOUS_ATTRIBUTE);
    api.persistAttribute(MULTINPC_ATTRIBUTE);
    for (const name of PILOT_NAMES) api.onNpcInteraction(name, PILOT_ACTIONS);
    api.onInterfaceActionClick(chooseDestination);
    api.onCustomEvent("interface:closed", mapClosed);
    api.onPlayerLogin(restoreVarbits);
  },
};

module.exports._test = { DESTINATIONS, openMap, quickGlide, chooseDestination, mapClosed, restoreVarbits, originOf, questComplete };
