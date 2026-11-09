// The crystal extractor (https://oldschool.runescape.wiki/w/Crystal_extractor; docs/sailing.md).
// Built in the shipyard like any facility; at sea:
// - Activate: the player turns to it, plays the activate animation a tick later, and two ticks
//   after that "The crystal extractor is now enabled.", sound 10899 and the switched-on loc.
// - Switched on, it harvests a crystal mote 105 ticks after it was enabled or last emptied:
//   "Your crystal extractor has harvested a crystal mote!" and the loc's extracted animation. It
//   holds one mote.
// - Harvest: with a mote, the collect animation and 4 ticks later sound 1298, 250 Sailing XP, a
//   wind mote for a wind or gale catcher that's on and has room (sound 10895), and after Song of
//   the Elves a 1 in 6 chance of a crystal shard; the extractor starts on the next mote. Moving
//   off first cancels it. Without one: "There are no motes in the crystal extractor."
// - Deactivate (ours, no capture): "The crystal extractor is now disabled." and the switched-off
//   loc; the mote being made is lost, one already made is kept.
// Ours: it charges only while its owner is aboard; the crystal-flecked waters' second shard and
// live's refusals ("The crystal extractor doesn't seem to respond in this area.", which the Wiki
// now keeps for bank boats) aren't modelled.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { animateDeckLoc, playSound } = require("./SailingContent.Sailing");
const { EXTRACTOR_SWITCHED_ON } = require("./BoatFacilities.Sailing");
const windCatcher = require("./WindCatcher.Helm");

const EXTRACTOR_OFF = 59703;
const EXTRACTOR_ON = EXTRACTOR_SWITCHED_ON[EXTRACTOR_OFF];
const SEQ_ACTIVATE = 13176; // sailing_human_crystal_extractor_kandarin_activate_01
const SEQ_COLLECT = 13178; // sailing_human_crystal_extractor_kandarin_collect_01
const LOC_INACTIVE = 13174; // sailing_boats_crystal_extractor_kandarin_inactive_01
const LOC_ACTIVE = 13175; // sailing_boats_crystal_extractor_kandarin_active_01
const LOC_EXTRACTED = 13177; // sailing_boats_crystal_extractor_kandarin_extracted_01
const SOUND_ENABLE = 10899;
const SOUND_HARVEST = 1298;
const SOUND_WIND_MOTE = 10895;
const CRYSTAL_SHARD = 23962; // prif_crystal_shard
const SONG_OF_THE_ELVES = "song_of_the_elves";
const MOTE_TICKS = 105;
const ACTIVATE_ANIM_TICKS = 1;
const ACTIVATE_TICKS = 3;
const HARVEST_TICKS = 4;
const HARVEST_XP = 250;
const SHARD_CHANCE = 1 / 6;

const ENABLED = "The crystal extractor is now enabled.";
const DISABLED = "The crystal extractor is now disabled.";
const HARVESTED = "<col=00e6e6>Your crystal extractor has harvested a crystal mote!";
const NO_MOTES = "There are no motes in the crystal extractor.";

let pluginApi = null;
/** Each player whose extractor is making a mote: that mote's token, so a restart drops the old one. */
const charging = new Map();

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The player's own boat they're aboard and its saved state, or undefined. */
function ownBoat(player) {
  const boat = Sailing.instanceAboard(player);
  const owned = boat && Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** The extractor's deck loc on the boat, or undefined without one. */
function extractorOf(boat) {
  return BoatManager.getSpec(boat)?.locs.find((loc) => loc.id === EXTRACTOR_OFF || loc.id === EXTRACTOR_ON);
}

/** Whether `ticks` later the player is still on the same boat, which still has its extractor. */
function stillAboard(player, boat) {
  return ownBoat(player)?.boat === boat && extractorOf(boat) !== undefined;
}

function setLoc(boat, id) {
  const loc = extractorOf(boat);
  if (loc && loc.id !== id) BoatManager.setDeckLoc(boat, { ...loc, id });
  return extractorOf(boat);
}

/** The mote being made is done: it waits in the extractor until harvested. */
function moteReady(player, token) {
  if (charging.get(player) !== token) return;
  charging.delete(player);
  const aboard = ownBoat(player);
  const loc = aboard && extractorOf(aboard.boat);
  if (!loc || !aboard.owned.crystalExtractorOn || aboard.owned.crystalMote) return;
  aboard.owned.crystalMote = true;
  player.sendMessage(HARVESTED);
  animateDeckLoc(player, aboard.boat, loc, LOC_EXTRACTED);
}

/** Starts the extractor on its next mote, if it's on and empty. */
function startCharging(player, owned) {
  if (!owned.crystalExtractorOn || owned.crystalMote) return;
  const token = {};
  charging.set(player, token);
  later(player, MOTE_TICKS, () => moteReady(player, token));
}

function faceExtractor(player, boat, loc) {
  player.setPositionToFace?.(new Location(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level));
}

function activate(player, aboard, loc) {
  faceExtractor(player, aboard.boat, loc);
  later(player, ACTIVATE_ANIM_TICKS, () => {
    if (stillAboard(player, aboard.boat)) player.performAnimation(new Animation(SEQ_ACTIVATE));
  });
  later(player, ACTIVATE_TICKS, () => {
    if (!stillAboard(player, aboard.boat) || aboard.owned.crystalExtractorOn) return;
    aboard.owned.crystalExtractorOn = true;
    player.sendMessage(ENABLED);
    playSound(player, SOUND_ENABLE);
    const on = setLoc(aboard.boat, EXTRACTOR_ON);
    animateDeckLoc(player, aboard.boat, on, aboard.owned.crystalMote ? LOC_EXTRACTED : LOC_ACTIVE);
    startCharging(player, aboard.owned);
  });
}

function deactivate(player, aboard) {
  later(player, 1, () => {
    if (!stillAboard(player, aboard.boat) || !aboard.owned.crystalExtractorOn) return;
    aboard.owned.crystalExtractorOn = false;
    charging.delete(player);
    player.sendMessage(DISABLED);
    animateDeckLoc(player, aboard.boat, setLoc(aboard.boat, EXTRACTOR_OFF), LOC_INACTIVE);
  });
}

function songOfTheElvesComplete(player) {
  const request = { player, key: SONG_OF_THE_ELVES, complete: false };
  pluginApi?.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function harvest(player, aboard, loc) {
  faceExtractor(player, aboard.boat, loc);
  if (!aboard.owned.crystalMote) {
    later(player, 1, () => player.sendMessage(NO_MOTES));
    return;
  }
  const from = player.getLocation();
  player.performAnimation(new Animation(SEQ_COLLECT));
  later(player, HARVEST_TICKS, () => {
    const now = player.getLocation();
    if (!stillAboard(player, aboard.boat) || !aboard.owned.crystalMote) return;
    if (now.getX() !== from.getX() || now.getY() !== from.getY()) return;
    collectMote(player, aboard);
  });
}

function collectMote(player, aboard) {
  aboard.owned.crystalMote = false;
  playSound(player, SOUND_HARVEST);
  player.getSkillManager().addExperiences(Skill.SAILING, HARVEST_XP);
  if (windCatcher.addCrystalMote(player)) playSound(player, SOUND_WIND_MOTE);
  if (songOfTheElvesComplete(player) && Math.random() < SHARD_CHANCE) {
    player.getInventory().add(new Item(CRYSTAL_SHARD, 1), true);
  }
  const loc = extractorOf(aboard.boat);
  if (loc) animateDeckLoc(player, aboard.boat, loc, LOC_ACTIVE);
  startCharging(player, aboard.owned);
}

function onExtractor(event) {
  const id = event.objectId;
  if (id !== EXTRACTOR_OFF && id !== EXTRACTOR_ON) return;
  const aboard = ownBoat(event.player);
  const loc = aboard && extractorOf(aboard.boat);
  if (!loc) return;
  if (id === EXTRACTOR_OFF && event.clickType === 1) {
    event.handled = true;
    activate(event.player, aboard, loc);
  } else if (id === EXTRACTOR_ON && event.clickType === 1) {
    event.handled = true;
    harvest(event.player, aboard, loc);
  } else if (id === EXTRACTOR_ON && event.clickType === 2) {
    event.handled = true;
    deactivate(event.player, aboard);
  }
}

/** Aboard a boat whose extractor was left on: it carries on making a mote. */
function onBoarded({ player, boat, owned }) {
  if (owned && Sailing.instanceAboard(player) === boat && extractorOf(boat)) startCharging(player, owned);
}

function onLeft({ player }) {
  charging.delete(player);
}

module.exports = {
  name: "SailingCrystalExtractor",
  description: "The crystal extractor: switched on at sea it makes a crystal mote every 105 ticks, harvested for Sailing XP, a wind mote and sometimes a crystal shard.",
  members: true,
  MOTE_TICKS,
  register(api) {
    pluginApi = api;
    api.onObjectInteraction(onExtractor);
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
  },
};
