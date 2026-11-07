/**
 * The Wilderness obelisks (https://oldschool.runescape.wiki/w/Wilderness_Obelisk), from
 * plugins/areas/data/wilderness-obelisks.json and rsprox recording 3886:
 * - Activate, or Teleport to Destination, starts the obelisk unless it's already going: everyone
 *   on its 3x3 pad goes "following rules set by the first player who activated it". Activate's
 *   destination is "completely random, and players may even be teleported to the same location";
 *   Teleport to Destination's is the one the player set.
 * - The recorded sequence, by ticks after the click: the four stones glow with synth 204 four
 *   times; at 7 a smokepuff and area sound 1930; at 10 the stones are back; at 11 the portal on
 *   the pad's nine tiles; at 13 the teleport, each player to a tile of the destination's pad.
 *   Tele Blocked players stay behind.
 * - Set Destination (after the hard Wilderness Diary) opens the menu (187) listing the six by
 *   level; the choice is varbit wilderness_portal_choice (1-6), saved with the player.
 * - Whoever has logged out or left the pad by the teleport stays. A shutdown puts glowing stones
 *   back and ends every activation, so none is left going.
 */
const fs = require("fs");
const path = require("path");

const DESTINATION_ATTRIBUTE = "wilderness-obelisks:destination";
const MENU_ATTRIBUTE = "wilderness-obelisks:menu";
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_RESTORE_INPUT = 2158;
/** menu:lj_layer1, whose pause button's sub is the option. */
const MENU_CHOICES = 3;
const PAUSE_BUTTON = 1;
const VIEW_DISTANCE = 15;

let api = null;
let core = null;
let data = null;
let choiceVarbit = -1;
/** Obelisk index -> its activation, while it's going. */
const active = new Map();

function load() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wilderness-obelisks.json"), "utf8"));
}

const indexOfId = (id) => data.obelisks.findIndex((obelisk) => obelisk.id === id);

/** The obelisk whose stone was clicked: its id, and one of its own four stones (the map has a stray copy of one). */
function obeliskOf({ objectId, object, location }) {
  const index = indexOfId(objectId);
  if (index < 0) return -1;
  const at = object?.getLocation?.() ?? (location ? { getX: () => location.x, getY: () => location.y } : null);
  if (!at) return index;
  return stones(data.obelisks[index]).some(([x, y]) => x === at.getX() && y === at.getY()) ? index : -1;
}

/** The four stones: the south-west corner and 4 tiles east, north and north-east. */
function stones(obelisk) {
  const [x, y] = obelisk.corner;
  return [[x, y], [x + 4, y], [x, y + 4], [x + 4, y + 4]];
}

/** The 3x3 pad between the stones. */
function padTiles(obelisk) {
  const [x, y] = obelisk.corner;
  const tiles = [];
  for (let dx = 1; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) tiles.push([x + dx, y + dy]);
  return tiles;
}

function onPad(player, obelisk) {
  const at = player.getLocation();
  const [x, y] = obelisk.corner;
  return at.getZ() === 0 && at.getX() > x && at.getX() < x + 4 && at.getY() > y && at.getY() < y + 4;
}

function nearby(obelisk) {
  const [x, y] = obelisk.corner;
  const players = [];
  for (const player of core.World.getPlayers()) {
    const at = player?.getLocation?.();
    if (at && at.getZ() === 0 && Math.abs(at.getX() - (x + 2)) <= VIEW_DISTANCE && Math.abs(at.getY() - (y + 2)) <= VIEW_DISTANCE) players.push(player);
  }
  return players;
}

function setStones(obelisk, id) {
  const { MapObjects, ObjectManager, GameObject } = core;
  for (const [x, y] of stones(obelisk)) {
    const tile = new core.Location(x, y, 0);
    const old = MapObjects.get(id === data.glowing ? obelisk.id : data.glowing, tile, null);
    if (old) {
      MapObjects.remove(old);
      ObjectManager.deregister(old, false);
    }
    ObjectManager.register(new GameObject(id, tile, 10, 0, null), true);
  }
}

function graphicAt(viewers, id, height, [x, y]) {
  const location = new core.Location(x, y, 0);
  const graphic = new core.Graphic(id, 0, height);
  for (const viewer of viewers) viewer.getPacketSender().sendGraphic(graphic, location);
}

function isTeleblocked(player) {
  return player?.getCombat?.()?.getTeleblockTimer?.()?.finished?.() === false;
}

/** Runs `action` `ticks` ticks from now (a world task: an obelisk outlives its activator). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function randomTile(obelisk) {
  const tiles = padTiles(obelisk);
  const [x, y] = tiles[Math.floor(Math.random() * tiles.length)];
  return new core.Location(x, y, 0);
}

/** The recorded sequence; `to` is the destination's index, `chosen` whether it was set. */
function activate(player, index, to, chosen) {
  if (active.has(index)) return false;
  const obelisk = data.obelisks[index];
  const { timeline } = data;
  const activation = { to, chosen };
  active.set(index, activation);
  const going = () => active.get(index) === activation;
  setStones(obelisk, data.glowing);
  for (let i = 0; i < timeline.glowSounds; i++) player.getPacketSender().sendSound(timeline.glowSound, 1, timeline.glowSoundDelay);
  // Recorded: the smoke and sound on the pad's middle column, its south row (3156,3619 at level 13).
  const centre = [obelisk.corner[0] + 2, obelisk.corner[1] + 1];
  later(timeline.smokeAt, () => {
    if (!going()) return;
    graphicAt(nearby(obelisk), timeline.smokeGraphic, timeline.smokeHeight, centre);
    for (const viewer of nearby(obelisk)) viewer.getPacketSender().sendAreaSound(timeline.areaSound, centre[0], centre[1], 0, 1, 0, timeline.areaSoundRadius);
  });
  later(timeline.revertAt, () => going() && setStones(obelisk, obelisk.id));
  later(timeline.portalAt, () => {
    if (!going()) return;
    const viewers = nearby(obelisk);
    for (const tile of padTiles(obelisk)) graphicAt(viewers, timeline.portalGraphic, timeline.portalHeight, tile);
  });
  later(timeline.teleportAt, () => {
    if (!going()) return;
    active.delete(index);
    const destination = data.obelisks[to];
    for (const traveller of core.World.getPlayers()) {
      if (!traveller?.isRegistered?.() || !onPad(traveller, obelisk)) continue;
      if (traveller.getHitpoints?.() <= 0 || traveller.isDyingReturn?.() === true) continue;
      if (isTeleblocked(traveller)) {
        traveller.sendMessage(data.messages.teleblocked);
        continue;
      }
      traveller.sendMessage(chosen ? data.messages.chosen : data.messages.random);
      const from = traveller.getLocation?.()?.clone?.() ?? null;
      const landing = randomTile(destination);
      traveller.moveTo(landing);
      // As the core's teleports do ("teleport:landed"): where it began, for content that remembers it.
      api?.emitCustomEvent?.("teleport:landed", { player: traveller, from, fromInstance: false, to: landing });
    }
  });
  return true;
}

/** Server shutdown: glowing stones go back and no activation is left going. */
function resetActive() {
  for (const index of active.keys()) setStones(data.obelisks[index], data.obelisks[index].id);
  active.clear();
}

function hardDiary(player) {
  const request = { player, diary: "wilderness", tier: "hard", claimed: false };
  api.emitCustomEvent("diary:is-reward-claimed", request);
  return request.claimed === true;
}

/** The saved choice, 1-6, or 0. */
function savedChoice(player) {
  const choice = Number(player.getAttribute(DESTINATION_ATTRIBUTE)) || 0;
  return choice >= 1 && choice <= data.obelisks.length ? choice : 0;
}

function activateOption(event) {
  const { player } = event;
  const index = obeliskOf(event);
  if (index < 0) return false;
  activate(player, index, Math.floor(Math.random() * data.obelisks.length), false);
  return true;
}

function teleportToDestination(event) {
  const { player } = event;
  const index = obeliskOf(event);
  if (index < 0) return false;
  if (!hardDiary(player)) return player.sendMessage(data.messages.needsDiary);
  const choice = savedChoice(player);
  if (!choice) return player.sendMessage(data.messages.noDestination);
  activate(player, index, choice - 1, true);
  return true;
}

function setDestination(event) {
  const { player } = event;
  if (obeliskOf(event) < 0) return false;
  if (!hardDiary(player)) return player.sendMessage(data.messages.needsDiary);
  const { menu } = data;
  const sender = player.getPacketSender();
  player.setAttribute(MENU_ATTRIBUTE, true);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(menu.interface);
  sender.sendSubInterface(MAIN_MODAL, menu.interface, 0);
  sender.sendClientScript(menu.script, menu.title, data.obelisks.map((obelisk) => obelisk.level).join("|"), 1);
  sender.sendInterfaceFlagsRange((menu.interface << 16) | MENU_CHOICES, 0, 512, PAUSE_BUTTON);
  return true;
}

function closeMenu(player) {
  player.setAttribute(MENU_ATTRIBUTE, null);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  player.setInterfaceId(-1);
}

function chooseDestination(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== data.menu.interface || (event.childId ?? (buttonId & 0xffff)) !== MENU_CHOICES) return;
  const { player } = event;
  if (player.getAttribute(MENU_ATTRIBUTE) !== true) return;
  if (player.getInterfaceId?.() !== data.menu.interface) {
    player.setAttribute(MENU_ATTRIBUTE, null);
    return;
  }
  const sub = Number(event.action);
  if (!Number.isInteger(sub) || sub < 0 || sub >= data.obelisks.length) return;
  event.handled = true;
  player.setAttribute(DESTINATION_ATTRIBUTE, sub + 1);
  player.getPacketSender().sendVarbit(choiceVarbit, sub + 1);
  closeMenu(player);
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId === data.menu.interface && player.getAttribute(MENU_ATTRIBUTE) === true) player.setAttribute(MENU_ATTRIBUTE, null);
}

function login({ player }) {
  player.getPacketSender().sendVarbit(choiceVarbit, savedChoice(player));
}

module.exports = {
  name: "WildernessObelisks",
  members: true,
  _test: { activate, activateOption, teleportToDestination, setDestination, chooseDestination, resetActive, padTiles, stones, active, get data() { return data; } },
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    data = load();
    choiceVarbit = core.CacheDefinitions.getVarbitId(data.choiceVarbit);
    if (choiceVarbit === null || choiceVarbit === undefined) throw new Error(`[WildernessObelisks] unknown varbit ${data.choiceVarbit}`);
    api.persistAttribute(DESTINATION_ATTRIBUTE, 0);
    api.onObjectInteraction("Obelisk", {
      Activate: activateOption,
      "Teleport to Destination": teleportToDestination,
      "Set Destination": setDestination,
    });
    api.onInterfaceActionClick(chooseDestination);
    api.onCustomEvent("interface:closed", menuClosed);
    api.onPlayerLogin(login);
    api.onServerShutdown(resetActive);
  },
};
