/**
 * The wind and gale catchers (rsprox, rev 235: recordings 907, 908, 936, 1031, 4306; the cache;
 * docs/sailing.md). Built in the shipyard like any facility; at sea:
 * - Activate (op1, from the helm too): the next tick "The wind catcher is now enabled.",
 *   sailing_captain_wind_catcher_enabled 1, the loc switched on (59683 / 59686), sound 10899; the
 *   tick after, the side panel's copy. Deactivate (op2): "The wind catcher is now disabled.", back.
 * - Switched on, with room (2 motes, a gale catcher 3), a trimmed gust is kept as a wind mote: "You
 *   trim the sails, catching the wind and storing a wind mote in your helm." ("... in your sails."
 *   away from the helm), "For storing a wind mote, you'll receive full XP the next time you consume
 *   one.", three quarters of the trim's XP, graphic 3535 on the catcher, no burst of speed. The
 *   motes owed full XP go up at once (at most 3), the charges the next tick. A crewmate's trim:
 *   "I've caught a wind mote!" over their head, no full XP owed. A Gwenith Glide crystal mote adds
 *   one too.
 * - Release-mote (op1 switched on, or the side panel's "Release wind mote": the first button of the
 *   catcher's hotspot row, 937:25 slot 12 on hotspot 0 as in every recording): "You
 *   release the wind mote for a burst of speed!", graphic 3536 on the catcher, the trim's burst
 *   (Trim.Helm.js releaseBurst); 40 XP for a mote owed full XP (a gale catcher's 70), else 10.
 *   None left: "There are no wind motes in the wind catcher."
 * - The Special Attack orb, at the helm of your own boat with a catcher, is the client's "Release"
 *   on "Wind Mote" (script 9482) unless All Settings 501 turns it off: op1 releases a mote, as
 *   Release-mote does. The client shows that only while the boat's max charges (11629) are set,
 *   which go out with boarding and back to 0 with leaving.
 * - The motes, the switch and the motes owed are kept with the boat; the side panel's charges show
 *   while aboard. A Barracuda Trial's start empties the motes (the owed count stays).
 * Ours: the deactivate sound (10239, captured on rev 229 only); what a crewmate assigned to the
 * catcher does (live's switch it on and off; here they don't).
 */
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Graphic } = require("../../../src/main/typescript/elvarg/game/model/Graphic");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { SIDEPANEL_GROUP, SIDEPANEL_FACILITIES_CHILD, facilityRowSlot, playSound, getVarbit } = require("./SailingContent.Sailing");

/** Each catcher's locs (off, on), how many motes it holds and what a mote owed full XP pays. */
const CATCHERS = [
  { off: 59684, on: 59683, capacity: 2, fullXp: 40 },
  { off: 59685, on: 59686, capacity: 3, fullXp: 70 },
];
const VARBIT_ENABLED = 19124;
const VARBIT_OWED = 19126;
const VARBIT_CHARGES = 19178;
const VARBIT_PANEL_ENABLED = 19179;
const VARBIT_MAX_CHARGES = 11629;
/** All Settings 501 "Special Attack orb releases wind motes": ticked while 0. */
const VARBIT_ORB_DISABLED = 11624;
const SPECIAL_ATTACK_ORBS = ["orbs:specbutton", "orbs_nomap:specbutton", "orbs_osm:specbutton", "orbs_osm_nomap:specbutton"];
let specialAttackOrbIds;
const MAX_OWED = 3;
const MOTE_XP = 10;
const SOUND_ENABLE = 10899;
const SOUND_DISABLE = 10239;
const GRAPHIC_STORED = 3535;
const GRAPHIC_RELEASED = 3536;

const NO_MOTES = "There are no wind motes in the wind catcher.";
const RELEASED = "You release the wind mote for a burst of speed!";
const OWED = "For storing a wind mote, you'll receive full XP the next time you consume one.";

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The player's own boat they're aboard, with its saved state, or undefined. */
function ownBoat(player) {
  const boat = Sailing.instanceAboard(player);
  const owned = boat && Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** The catcher on the boat's deck: its kind and its deck loc, or undefined without one. */
function catcherOf(boat) {
  for (const loc of BoatManager.getSpec(boat)?.locs ?? []) {
    const kind = CATCHERS.find((catcher) => catcher.off === loc.id || catcher.on === loc.id);
    if (kind) return { kind, loc };
  }
  return undefined;
}

function isCatcherLoc(id) {
  return CATCHERS.some((catcher) => catcher.off === id || catcher.on === id);
}

function catcherTile(boat, loc) {
  return new Location(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level);
}

function sendCharges(player, owned) {
  player.getPacketSender().sendVarbit(VARBIT_CHARGES, owned?.windMotes ?? 0);
}

/** Switches the catcher on or off: the message, the loc and its varbits (rsprox 907 11533). */
function setEnabled(player, on) {
  const aboard = ownBoat(player);
  const catcher = aboard && catcherOf(aboard.boat);
  if (!catcher || aboard.owned.windCatcherOn === on) return;
  later(player, 1, () => {
    if (ownBoat(player)?.boat !== aboard.boat) return;
    aboard.owned.windCatcherOn = on;
    player.sendMessage(`The wind catcher is now ${on ? "enabled" : "disabled"}.`);
    player.getPacketSender().sendVarbit(VARBIT_ENABLED, on ? 1 : 0);
    const current = catcherOf(aboard.boat);
    if (current) BoatManager.setDeckLoc(aboard.boat, { ...current.loc, id: on ? current.kind.on : current.kind.off });
    playSound(player, on ? SOUND_ENABLE : SOUND_DISABLE);
    later(player, 1, () => player.getPacketSender().sendVarbit(VARBIT_PANEL_ENABLED, on ? 1 : 0));
  });
}

/** Adds a mote if the catcher is on and has room: the charges the next tick (or now). */
function addMote(player, aboard, { owed = false, delay = 0 } = {}) {
  const catcher = catcherOf(aboard.boat);
  const { owned } = aboard;
  if (!catcher || !owned.windCatcherOn || (owned.windMotes ?? 0) >= catcher.kind.capacity) return undefined;
  owned.windMotes = (owned.windMotes ?? 0) + 1;
  if (owed) {
    owned.windMotesOwed = Math.min(MAX_OWED, (owned.windMotesOwed ?? 0) + 1);
    player.getPacketSender().sendVarbit(VARBIT_OWED, owned.windMotesOwed);
  }
  if (delay > 0) later(player, delay, () => sendCharges(player, owned));
  else sendCharges(player, owned);
  return catcher;
}

/**
 * A trim with the catcher on: keeps the gust as a mote (the messages, the graphic) and returns
 * true, or false when there's no catcher on with room, for an ordinary trim.
 */
function storeFromTrim(player, boat, { actor = player, crew = false } = {}) {
  const aboard = ownBoat(player);
  if (!aboard || aboard.boat !== boat) return false;
  const catcher = addMote(player, aboard, { owed: !crew, delay: 1 });
  if (!catcher) return false;
  if (crew) {
    actor.forceChat?.("I've caught a wind mote!");
  } else {
    const where = boat.helmPlayerId === player.getIndex() ? "helm" : "sails";
    player.sendMessage(`You trim the sails, catching the wind and storing a wind mote in your ${where}.`);
    player.sendMessage(OWED);
  }
  player.getPacketSender().sendGraphic(new Graphic(GRAPHIC_STORED), catcherTile(boat, catcher.loc));
  return true;
}

/**
 * A crystal mote (a Gwenith Glide's, a crystal extractor's): a charge if the catcher is on and has
 * room. Returns whether it was stored.
 */
function addCrystalMote(player) {
  const aboard = ownBoat(player);
  return aboard ? addMote(player, aboard) !== undefined : false;
}

/** Releases a mote for a burst of speed (rsprox 907 11637). */
function release(player) {
  const aboard = ownBoat(player);
  const catcher = aboard && catcherOf(aboard.boat);
  if (!catcher || !aboard.owned.windCatcherOn) return;
  const { owned, boat } = aboard;
  if ((owned.windMotes ?? 0) <= 0) {
    player.sendMessage(NO_MOTES);
    return;
  }
  owned.windMotes -= 1;
  const fullXp = (owned.windMotesOwed ?? 0) > 0;
  if (fullXp) {
    owned.windMotesOwed -= 1;
    player.getPacketSender().sendVarbit(VARBIT_OWED, owned.windMotesOwed);
  }
  sendCharges(player, owned);
  player.sendMessage(RELEASED);
  player.getPacketSender().sendGraphic(new Graphic(GRAPHIC_RELEASED), catcherTile(boat, catcher.loc));
  require("./Trim.Helm").releaseBurst(player, boat);
  player.getSkillManager().addExperiences(Skill.SAILING, fullXp ? catcher.kind.fullXp : MOTE_XP);
}

/** A Barracuda Trial's start or reset: the motes go, the owed count stays (rsprox 907 11701). */
function empty(player) {
  const aboard = ownBoat(player);
  if (!aboard || !(aboard.owned.windMotes > 0)) return;
  aboard.owned.windMotes = 0;
  sendCharges(player, aboard.owned);
}

function onLoc(event) {
  if (!isCatcherLoc(event.objectId)) return;
  const on = CATCHERS.some((catcher) => catcher.on === event.objectId);
  if (!on && event.clickType === 1) {
    event.handled = true;
    setEnabled(event.player, true);
  } else if (on && event.clickType === 1) {
    event.handled = true;
    release(event.player);
  } else if (on && event.clickType === 2) {
    event.handled = true;
    setEnabled(event.player, false);
  }
}

/** The side panel's "Release wind mote": the first button of the catcher's hotspot row. */
function onPanelClick(event) {
  if (event.groupId !== SIDEPANEL_GROUP || event.childId !== SIDEPANEL_FACILITIES_CHILD) return;
  const aboard = ownBoat(event.player);
  const catcher = aboard && catcherOf(aboard.boat);
  if (catcher?.loc.hotspot === undefined || event.slot !== facilityRowSlot(catcher.loc.hotspot, 0)) return;
  event.handled = true;
  release(event.player);
}

function isSpecialAttackOrb(widgetId) {
  if (!specialAttackOrbIds?.size) {
    specialAttackOrbIds = new Set(SPECIAL_ATTACK_ORBS.map((name) => CacheDefinitions.getComponentId(name)).filter(Number.isInteger));
  }
  return specialAttackOrbIds.has(widgetId);
}

/** The Special Attack orb's op1 at the helm, while it shows the wind mote: a release, not a special attack. */
function onOrbClick(event) {
  const { player, packet } = event;
  if (packet?.buttonNum !== 1 || !isSpecialAttackOrb(packet.widgetId)) return;
  const aboard = ownBoat(player);
  if (!aboard || aboard.boat.helmPlayerId !== player.getIndex() || !catcherOf(aboard.boat)) return;
  if (getVarbit(player, VARBIT_ORB_DISABLED) === 1) return;
  event.handled = true;
  release(player);
}

/** Aboard: the catcher's capacity at once; the panel's charges and switch a tick later; ashore they clear (rsprox 4306 12251 -> 12296). */
function onBoarded({ player, owned }) {
  const aboard = ownBoat(player);
  const catcher = aboard && catcherOf(aboard.boat);
  if (catcher) player.getPacketSender().sendVarbit(VARBIT_MAX_CHARGES, catcher.kind.capacity);
  later(player, 1, () => {
    sendCharges(player, owned);
    player.getPacketSender().sendVarbit(VARBIT_PANEL_ENABLED, owned?.windCatcherOn ? 1 : 0);
  });
}

function onLeft({ player, reason }) {
  if (reason === "logout") return;
  player.getPacketSender().sendVarbit(VARBIT_CHARGES, 0).sendVarbit(VARBIT_PANEL_ENABLED, 0).sendVarbit(VARBIT_MAX_CHARGES, 0);
}

function onLogin({ player }) {
  const owned = Sailing.activeBoat(player);
  player.getPacketSender()
    .sendVarbit(VARBIT_ENABLED, owned?.windCatcherOn ? 1 : 0)
    .sendVarbit(VARBIT_OWED, owned?.windMotesOwed ?? 0);
}

function attach(api) {
  api.onObjectInteraction(onLoc);
  api.onInterfaceActionClick(onPanelClick);
  api.onCustomEvent("player:widget-action", onOrbClick);
  api.onCustomEvent("sailing:boarded", onBoarded);
  api.onCustomEvent("sailing:left", onLeft);
  api.onPlayerLogin(onLogin);
}

module.exports = {
  attach,
  storeFromTrim,
  addCrystalMote,
  release,
  empty,
  setEnabled,
  isCatcherLoc,
  CATCHERS,
};
