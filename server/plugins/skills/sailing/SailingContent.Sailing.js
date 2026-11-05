// Shared by the sailing plugins: boat and dock data, cache ids and small client helpers.
// Cache ids come from xrsps's sailing port, which took them from rsmod's live traces
// (https://github.com/rsmod/rsmod, ISC) and checked them against the rev 237 cache.
const fs = require("fs");
const path = require("path");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { ChatType } = require("../../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const StaticShips = require("./StaticShips.Sailing");

const VARBIT = {
  // The Pandemonium is done (50): the boat customisation refuses every build below it (9022).
  SAILING_INTRO: 18314,
  LAST_PERSONAL_BOAT_BOARDED: 18554, // boat slot, from 1
  PLAYER_IS_ON_PLAYER_BOAT: 19104, // gangplank: Board / Disembark
  FACILITY_LOCKEDIN: 19105, // helm: Navigate / Stop-navigating (3)
  PRELOADED_ANIMS: 19118,
  BOAT_SPAWNED: 19121, // boat slot, from 1
  BOARDED_BOAT_WORLD: 19122,
  PREVIOUS_BOAT_DATA_SLOT: 19130, // boat slot, from 1
  BOARDED_BOAT: 19136,
  BOARDED_BOAT_TYPE: 19137, // raft 0, skiff 1, sloop 2
  PREVIOUS_BOAT_TYPE_ID: 19143,
  SIDEPANEL_VISIBLE: 19151,
  SIDEPANEL_FACILITY_SAIL: 19154,
  SIDEPANEL_FACILITY_HELM: 19155,
  SIDEPANEL_VISIBLE_FROM_COMBAT_TAB: 19153,
  SIDEPANEL_FACILITY_HOTSPOT0: 19156, // hotspot n: + n (0-10)
  SIDEPANEL_FACILITY_KEEL: 19167,
  SIDEPANEL_FACILITY_HULL: 19168,
  SIDEPANEL_FACILITY_TRIM: 19172,
  SHIPYARD_MODE: 19173,
  SIDEPANEL_SAIL_BUTTON_TOGGLED: 19174,
  SIDEPANEL_BOAT_MOVE_MODE: 19175,
  SIDEPANEL_HELM_STATUS: 19176,
  SIDEPANEL_BOAT_HP_MAX: 19177,
  SIDEPANEL_BOAT_HP: 19181,
  SIDEPANEL_PLAYER_AT_HELM: 19205,
  SIDEPANEL_REPAIRKITS: 19210, // repair kit uses in the cargo hold: 5 per kit
  SIDEPANEL_PLAYER_ROLE: 19233,
  SIDEPANEL_PLAYERS_ON_BOARD_TOTAL: 19235,
  SIDEPANEL_BOAT_STORMRESISTANCE: 19248,
  SIDEPANEL_BOAT_RAPIDRESISTANCE: 19249,
  SIDEPANEL_BOAT_BASESPEED: 19250,
  SIDEPANEL_BOAT_SPEEDCAP: 19251,
  SIDEPANEL_BOAT_FETIDWATER_RESISTANT: 19252,
  SIDEPANEL_BOAT_CRYSTALFLECKED_RESISTANT: 19253,
  SIDEPANEL_BOAT_SPEEDBOOST_DURATION: 19256,
  SIDEPANEL_BOAT_ACCELERATION: 19257,
  MINIMAP_STATE: 6719,
};
const VARP_SIDEPANEL_BOAT_TYPE = 5117;
/** The sidepanel's boat defence stats, by `stats` field in boats.json. */
const VARP_SIDEPANEL_DEFENCE = {
  defence: 5147,
  armour: 5148,
  stabDefence: 5159,
  slashDefence: 5160,
  crushDefence: 5161,
  magicDefence: 5162,
  heavyRangedDefence: 5163,
  standardRangedDefence: 5164,
  lightRangedDefence: 5165,
};

const MOVE_MODE = { STOPPED: 0, HALF: 1, FULL: 2, REVERSE: 3, MOORED: 4 };
const HELM_STATUS = { FREE: 1, NAVIGATING: 2 };
const ROLE_CAPTAIN = 10;

const SIDEPANEL_GROUP = 937;
const SIDEPANEL_FACILITIES_CHILD = 25;
/**
 * The facilities list (937:25) has a row of four buttons per facility: the sails, the helm, hull
 * repairs, then hotspot n at row 3 + n (cache script 9027); the fourth button picks a crewmate.
 */
const FACILITY_ROW_BUTTONS = 4;
const FACILITY_ROW_HOTSPOT0 = 3;

/** The 937:25 slot of a hotspot row's button (0-3). */
function facilityRowSlot(hotspot, button) {
  return (FACILITY_ROW_HOTSPOT0 + hotspot) * FACILITY_ROW_BUTTONS + button;
}
const COMBAT_TAB_UID = (161 << 16) | 76;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY_GROUP = 174;
const SCRIPT_FADE = 948;
const FADE_CYCLES = 15;
const SCRIPT_SIDEPANEL_INIT = 8776;
const SCRIPT_HELM_UPDATE = 8778;
const SCRIPT_SIDEBUTTON_SWITCH = 915;

let loaded = null;

/** Loads boats.json and sailing-docks.json into Sailing (and sailing-cargo.json) once, for every plugin. */
function content() {
  if (loaded) return loaded;
  const read = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", file), "utf8"));
  const boats = read("boats.json");
  // Every port and mooring point from the cache (sailing-ports.json), with what only some have
  // (a shipwright, the shipyard) from sailing-docks.json.
  const extras = read("sailing-docks.json");
  const docks = read("sailing-ports.json").map((port) => ({ ...port, ...extras.find((extra) => extra.id === port.id) }));
  const cargo = read("sailing-cargo.json");
  const names = read("sailing-boat-names.json");
  const parts = read("sailing-parts.json");
  const salvage = read("sailing-salvage.json");
  for (const boat of boats) Sailing.registerBoatType(boat);
  for (const dock of docks) Sailing.registerDock(dock);
  loaded = { boats, docks, cargo, names, parts, salvage };
  return loaded;
}

function boatType(type) {
  return content().boats.find((boat) => boat.type === type);
}

/** Authored sailing content for a registered physical ship, without a personal boat record. */
function suppliedBoatProfile(boat) {
  const ship = boat && StaticShips.get(boat.entityIndex);
  return ship && ship.boat === boat ? ship.definition.sailing : undefined;
}

/** A boat's animations by name from boats.json `anims` (helm, sail, trim), if known. */
function boatAnim(boat, name) {
  return (boatType(BoatManager.getSpec(boat)?.type) ?? suppliedBoatProfile(boat))?.anims?.[name];
}

/**
 * The dock or mooring point nearest the player within `range` tiles of its gangplank or landing,
 * or undefined (the cache's dock zones are server side, so near is a distance here).
 */
function dockNear(player, range) {
  const here = player.getLocation();
  const distance = (tile) => (tile && tile.z === here.getZ()
    ? Math.max(Math.abs(tile.x - here.getX()), Math.abs(tile.y - here.getY()))
    : Infinity);
  let best;
  let bestDistance = range + 1;
  for (const dock of content().docks) {
    const d = Math.min(distance(dock.gangplank), distance(dock.landing));
    if (d < bestDistance) {
      best = dock;
      bestDistance = d;
    }
  }
  return best;
}

function dockById(id) {
  return content().docks.find((dock) => dock.id === id);
}

/**
 * A boat's name from its three word numbers (1-based, 0 = none): the words from cache db rows
 * 8545-8547 (sailing-boat-names.json), joined with spaces, or "Boat" with none.
 */
function boatName(boat) {
  const { words, unnamed } = content().names;
  const parts = (Array.isArray(boat?.name) ? boat.name : []).map((word, list) => words[list]?.[word - 1]).filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : unnamed;
}

/** A random name, as a new boat gets: a word from each list that has any. */
function randomBoatName() {
  return content().names.words.map((list) => list.length > 0 ? 1 + Math.floor(Math.random() * list.length) : 0);
}

/** The dock whose gangplank is at (or right by) a clicked loc. */
function dockAtGangplank(location) {
  return content().docks.find((dock) =>
    Math.max(Math.abs(dock.gangplank.x - location.x), Math.abs(dock.gangplank.y - location.y)) <= 1);
}

/** The dock whose docking buoy is at a location. */
function dockAtBuoy(location) {
  return content().docks.find((dock) => dock.buoy && dock.buoy.x === location.x && dock.buoy.y === location.y);
}

function setVarbit(player, id, value) {
  player.getPacketSender().sendVarbit(id, value);
}

function getVarbit(player, id) {
  return player.getPacketSender().getVarbit(id);
}

function playSound(player, soundId, delay = 0) {
  player.getPacketSender().sendSoundEffect(soundId, 1, delay, 10);
}

/** A line on the spam chat channel (105), as live sends sailing's repeated lines. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, text);
}

/** Plays a loc animation on the boat's deck for the player and everyone who sees them. */
function animateDeckLocs(player, boat, isLoc, animId) {
  const spec = BoatManager.getSpec(boat);
  const locs = boatType(spec?.type)?.locs ?? (suppliedBoatProfile(boat) ? spec?.locs : undefined);
  for (const loc of locs ?? []) {
    if (isLoc(loc)) animateDeckLoc(player, boat, loc, animId);
  }
}

/** Plays a loc animation on one deck loc, for the player and everyone who sees them. */
function animateDeckLoc(player, boat, loc, animId) {
  const viewers = [player, ...player.getLocalPlayers().filter((other) => other.getLocalPlayers().includes(player))];
  const drawn = {
    getId: () => loc.id,
    getLocation: () => new Location(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level),
    getType: () => loc.shape,
    getFace: () => loc.rotation,
  };
  for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(drawn, new Animation(animId));
}

function isHelm(loc) {
  return loc.helm === true;
}

function isSail(loc) {
  return loc.sail === true;
}

function isSailCloth(loc) {
  return loc.sailCloth === true;
}

/**
 * The sail cloth's op flags: only "Set" (op2) while the sails aren't set, only "Un-set" (op5)
 * while they are, and "Trim" (op1) as well while a gust can be caught.
 */
const SAIL_CLOTH_OPS = Object.freeze({ set: 0b10000, unset: 0b10, trim: 0b1 });

/**
 * Re-sends the sail cloth with the options that fit the sails, as live does on every sail change
 * (rsprox): sent straight to the viewers, before the change's animations, since a loc that arrives
 * after its animation starts over without it. Set means moving under sail or reversing; stopped and
 * moored are unset. `trim` adds Trim to set sails (a gust of wind).
 */
function setSailClothOps(player, boat, set, trim = false) {
  const spec = BoatManager.getSpec(boat);
  if (!spec) return;
  const viewers = [player, ...player.getLocalPlayers().filter((other) => other.getLocalPlayers().includes(player))];
  for (const loc of spec.locs.filter(isSailCloth)) {
    const opFlags = set ? SAIL_CLOTH_OPS.set | (trim ? SAIL_CLOTH_OPS.trim : 0) : SAIL_CLOTH_OPS.unset;
    const changed = { ...loc, opFlags };
    BoatManager.updateDeckLoc(boat, changed);
    const drawn = {
      getId: () => changed.id,
      getLocation: () => new Location(boat.deckBaseX + changed.x, boat.deckBaseY + changed.y, changed.level),
      getType: () => changed.shape,
      getFace: () => changed.rotation,
      getOpFlags: () => changed.opFlags,
    };
    for (const viewer of viewers) viewer.getPacketSender().sendObject(drawn);
  }
}

/**
 * Sets the sails from one state to another (down, half or full), as live does (rsprox): the
 * change's animation on the mast and, with its `_offset` twin, the sail cloth on the same tick
 * (the state's own loop when it doesn't change), then the new state's loop on both a tick later.
 * `settle: false` plays just the first part (boarding shows the sails at rest once).
 */
function animateSails(player, boat, from, to, { settle = true } = {}) {
  const sail = boatAnim(boat, "sail");
  if (!sail) return;
  const play = (name) => {
    if (sail.mast?.[name] !== undefined) animateDeckLocs(player, boat, isSail, sail.mast[name]);
    if (sail.cloth?.[name] !== undefined) animateDeckLocs(player, boat, isSailCloth, sail.cloth[name]);
  };
  play(from === to ? to : `${from}_to_${to}`);
  if (!settle) return;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, boat, false); }
    execute() {
      this.stop();
      if (BoatManager.getSpec(boat)) play(to);
    }
  })());
}

/** Fades the screen out (or back in) with interface 174 and `fade_overlay` (script 948). */
/** `minimap: false` leaves the minimap shown (a crewmate banking cargo fades without hiding it, rsprox). */
function fade(player, out, cycles = FADE_CYCLES, { minimap = true } = {}) {
  const args = out ? [0, 255, 0, 0, cycles] : [0, 0, 0, 255, cycles];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY_GROUP, 1, {
    postScripts: [{ scriptId: SCRIPT_FADE, args }],
  });
  if (minimap) setVarbit(player, VARBIT.MINIMAP_STATE, out ? 2 : 0);
}

module.exports = {
  dockNear,
  VARBIT,
  VARP_SIDEPANEL_BOAT_TYPE,
  VARP_SIDEPANEL_DEFENCE,
  MOVE_MODE,
  HELM_STATUS,
  ROLE_CAPTAIN,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  FACILITY_ROW_BUTTONS,
  FACILITY_ROW_HOTSPOT0,
  facilityRowSlot,
  COMBAT_TAB_UID,
  SCRIPT_SIDEPANEL_INIT,
  SCRIPT_HELM_UPDATE,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  boatType,
  suppliedBoatProfile,
  boatAnim,
  dockById,
  boatName,
  randomBoatName,
  dockAtGangplank,
  dockAtBuoy,
  setVarbit,
  getVarbit,
  playSound,
  spam,
  fade,
  animateDeckLocs,
  animateDeckLoc,
  isHelm,
  isSail,
  isSailCloth,
  animateSails,
  setSailClothOps,
  SAIL_CLOTH_OPS,
};
