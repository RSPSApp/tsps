/**
 * Gusts of wind and trimming the sails, as live (rsprox captures; docs/sailing.md):
 * - while the sails are set (half or full), a gust comes when the boat's gust timer runs out:
 *   "You feel a gust of wind.", the sound and the gust's wind on the sail cloth, which shows Trim;
 * - Trim within 14 ticks catches it: half a tile a tick more for the sails' boost duration, the
 *   helm's trim animations, and the next gust 50 ticks after the trim;
 * - left alone, the gust dies down after 14 ticks and the next comes 49 ticks later;
 * - either way the end is "The wind dies down and your sails with it."
 * The timer keeps running while the sails are down, so raising them late can catch a gust at
 * once; a boat's first one comes 49 ticks after its sails are first set.
 * A crewmate at the helm trims each gust 3 ticks in (rsprox): the captain gets the messages and a
 * share of the trim's XP ("You gain some experience by watching your crew work."), the crewmate
 * the helm's animations. Trimming is worth the sails' tier in XP (Wiki, Sails).
 */
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { BURST_STEP } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatMovement");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../../src/main/typescript/elvarg/game/model/Graphic");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { World } = require("../../../src/main/typescript/elvarg/game/World");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");
const { partTiers } = require("./BoatParts.Sailing");
const {
  boatAnim,
  animateDeckLocs,
  animateSails,
  setSailClothOps,
  isHelm,
  isSailCloth,
  playSound,
  content,
  spam,
} = require("./SailingContent.Sailing");

const GUST_TICKS = 14;
const FIRST_GUST_DELAY = 49;
const GUST_DELAY_AFTER_LULL = 49;
const GUST_DELAY_AFTER_TRIM = 50;
/** The helm's trim loop plays every 4 ticks while trimmed. */
const TRIM_LOOP_TICKS = 4;
/** A hull without stats: the sails' shortest boost, and a fifth faster. */
const DEFAULT_BOOST_TICKS = 20;
const SOUND_GUST = 10839;
const SOUNDS_TRIM = [10842, 10841];
/** A trim that stores a wind mote; a mote's release (rsprox 908 252, 907 11637). */
const SOUNDS_STORE = [10842, 10895];
const SOUND_RELEASE = 10841;
/** A stored trim pays three quarters of a trim's XP (rsprox: 36 for 48, about 94 for 125). */
const STORED_TRIM_XP = 0.75;
/** A crewmate's trim: the second of the player's sounds, and an area sound at the sail cloth (rsprox: range 5). */
const SOUND_CREW_TRIM = 10841;
const SOUND_CREW_TRIM_AREA = 10807;
const CREW_TRIM_AREA_RANGE = 5;
/** A crewmate at the helm trims a gust this many ticks after it comes (rsprox: 253 -> 256). */
const CREW_TRIM_TICKS = 3;

const GUST_MESSAGE = "You feel a gust of wind.";
const TRIM_MESSAGE = "You trim the sails, catching the wind for a burst of speed!";
const LULL_MESSAGE = "The wind dies down and your sails with it.";

/** Per boat: its clock (ticks since it was first set sailing) and the wind's state. */
const winds = new WeakMap();

function sailsUp(boat) {
  return boat.moveMode === BoatMoveMode.Full || boat.moveMode === BoatMoveMode.Half;
}

function sailState(boat) {
  if (boat.moveMode === BoatMoveMode.Full) return "full";
  if (boat.moveMode === BoatMoveMode.Half) return "half";
  return "down";
}

/**
 * Who works the helm: the player at it, or a crewmate holding it for the captain. `player` gets
 * the messages and sends the boat's packets; `actor` plays the helm's animations.
 */
function helmOperator(boat) {
  const player = boat.helmPlayerId === undefined ? undefined : World.getPlayers().get(boat.helmPlayerId);
  if (player && player.isRegistered?.() !== false) return { player, actor: player, crew: false };
  const crew = boat.helmCrew;
  if (!crew || crew.isRegistered?.() === false) return undefined;
  const owner = World.getPlayers().get(boat.ownerPlayerId);
  return owner && owner.isRegistered?.() !== false ? { player: owner, actor: crew, crew: true } : undefined;
}

/** A trim's XP: the built sails' tier (sailing-parts.json `trim_xp`, Wiki), or none on a boat not the player's own. */
function trimXp(player, boat) {
  const owned = Sailing.instanceAboard(player) === boat ? Sailing.activeBoat(player) : undefined;
  if (!owned) return 0;
  return content().parts?.trim_xp?.[partTiers(owned).sail ?? 0] ?? 0;
}

/** A graphic on the sail cloth's tile, for the player and everyone who sees them. */
function windOnSails(player, boat, graphicId) {
  const spec = BoatManager.getSpec(boat);
  const viewers = [player, ...player.getLocalPlayers().filter((other) => other.getLocalPlayers().includes(player))];
  for (const loc of spec?.locs.filter(isSailCloth) ?? []) {
    const tile = new Location(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level);
    for (const viewer of viewers) viewer.getPacketSender().sendGraphic(new Graphic(graphicId), tile);
  }
}

/** Whether a gust is waiting to be caught: Trim shows on the sail cloth. */
function canTrim(boat) {
  const wind = winds.get(boat);
  return !!wind && wind.gustEnds !== undefined && sailsUp(boat);
}

function startGust(player, boat, wind) {
  const trim = boatAnim(boat, "trim");
  wind.gustStarted = wind.clock;
  wind.gustEnds = wind.clock + GUST_TICKS;
  player.sendMessage(GUST_MESSAGE);
  setSailClothOps(player, boat, true, true);
  animateSails(player, boat, sailState(boat), sailState(boat));
  if (trim) windOnSails(player, boat, trim.gust);
  playSound(player, SOUND_GUST);
  PluginManager.emitCustomEvent("sailing:gust", { player, boat });
}

/** The wind dies down: after an untrimmed gust, or at the end of a trim's boost. */
function lull({ player, actor }, boat, wind) {
  const trim = boatAnim(boat, "trim");
  const trimmed = wind.boostEnds !== undefined;
  wind.gustEnds = undefined;
  wind.boostEnds = undefined;
  boat.boostSpeed = undefined;
  if (!trimmed) wind.nextGust = wind.clock + GUST_DELAY_AFTER_LULL;
  player.sendMessage(LULL_MESSAGE);
  PluginManager.emitCustomEvent("sailing:lull", { player, boat, trimmed });
  if (trimmed && trim && !wind.released) {
    actor.performAnimation(new Animation(trim.player.end));
    animateDeckLocs(player, boat, isHelm, trim.helm.end);
  }
  const set = boat.moveMode !== BoatMoveMode.Stopped;
  setSailClothOps(player, boat, set);
  if (set) animateSails(player, boat, sailState(boat), sailState(boat), { settle: false });
}

/**
 * Trim on the sail cloth: catches the waiting gust, for whoever is at the helm (`player`, whose
 * XP it is), animating `actor` at the helm. A crewmate's trim (`crew`) has no message of its own;
 * the crew plugin gives the captain their share ("sailing:crew-trim"). Returns false when there
 * is no gust to catch.
 */
function trimSails(player, boat, { actor = player, crew = false } = {}) {
  const wind = winds.get(boat);
  if (!wind || !canTrim(boat)) return false;
  // A wind or gale catcher switched on, with room, keeps the gust as a wind mote instead.
  if (require("./WindCatcher.Helm").storeFromTrim(player, boat, { actor, crew })) {
    storedTrim(player, boat, wind, { actor, crew });
    return true;
  }
  const trim = boatAnim(boat, "trim");
  const spec = BoatManager.getSpec(boat);
  wind.gustEnds = undefined;
  wind.trimmedAt = wind.clock;
  wind.boostEnds = wind.clock + (spec?.stats?.speedBoostDuration ?? DEFAULT_BOOST_TICKS);
  wind.nextGust = wind.clock + GUST_DELAY_AFTER_TRIM;
  wind.released = false;
  // A trim adds a half-tile step to the sails, never past the cap and a step (rsprox 856, 908).
  boat.boostSpeed = BURST_STEP;
  // rsprox: a spam line in every recording (1,112 times, e.g. 229/00672.txt:17779).
  if (!crew) spam(player, TRIM_MESSAGE);
  PluginManager.emitCustomEvent("sailing:trimmed", { player, boat, crew });
  if (trim) {
    actor.performAnimation(new Animation(trim.player.trim));
    animateDeckLocs(player, boat, isHelm, trim.helm.trim);
  }
  setSailClothOps(player, boat, true);
  animateSails(player, boat, sailState(boat), sailState(boat));
  if (trim) windOnSails(player, boat, trim.boost);
  for (const sound of crew ? [SOUND_CREW_TRIM] : SOUNDS_TRIM) playSound(player, sound);
  if (crew) {
    for (const loc of spec?.locs.filter(isSailCloth) ?? []) {
      player.getPacketSender().sendAreaSound(SOUND_CREW_TRIM_AREA, boat.deckBaseX + loc.x, boat.deckBaseY + loc.y,
        loc.level, 1, 0, CREW_TRIM_AREA_RANGE);
    }
  }
  const xp = trimXp(player, boat);
  if (crew) {
    PluginManager.emitCustomEvent("sailing:crew-trim", { player, boat, npc: actor, xp });
  } else if (xp > 0) {
    player.getSkillManager().addExperiences(Skill.SAILING, xp);
  }
  return true;
}

/**
 * A trim whose gust went into the wind catcher (rsprox 908 252): the trim's animations and the
 * gust's wind on the sails, sounds 10842 and 10895, no burst of speed, the next gust 50 ticks on.
 */
function storedTrim(player, boat, wind, { actor, crew }) {
  const trim = boatAnim(boat, "trim");
  wind.gustEnds = undefined;
  wind.nextGust = wind.clock + GUST_DELAY_AFTER_TRIM;
  if (trim) {
    actor.performAnimation(new Animation(trim.player.trim));
    animateDeckLocs(player, boat, isHelm, trim.helm.trim);
  }
  setSailClothOps(player, boat, true);
  animateSails(player, boat, sailState(boat), sailState(boat));
  if (trim) windOnSails(player, boat, trim.gust);
  for (const sound of SOUNDS_STORE) playSound(player, sound);
  const xp = Math.round(trimXp(player, boat) * STORED_TRIM_XP);
  if (crew) {
    PluginManager.emitCustomEvent("sailing:crew-trim", { player, boat, npc: actor, xp });
  } else if (xp > 0) {
    player.getSkillManager().addExperiences(Skill.SAILING, xp);
  }
}

/**
 * A wind mote released from the catcher (rsprox 907 11637, 908 281): the same burst of speed as
 * a trim for the sails' boost duration, started over if one is up, the gust's place taken, the
 * next gust 49 ticks on; the cloth shows Un-set and the burst's wind.
 */
function releaseBurst(player, boat) {
  const wind = windFor(boat);
  const trim = boatAnim(boat, "trim");
  const spec = BoatManager.getSpec(boat);
  wind.gustEnds = undefined;
  wind.released = true;
  wind.trimmedAt = wind.clock;
  wind.boostEnds = wind.clock + (spec?.stats?.speedBoostDuration ?? DEFAULT_BOOST_TICKS);
  wind.nextGust = wind.clock + GUST_DELAY_AFTER_LULL;
  boat.boostSpeed = BURST_STEP;
  setSailClothOps(player, boat, true);
  animateSails(player, boat, sailState(boat), sailState(boat));
  if (trim) windOnSails(player, boat, trim.boost);
  playSound(player, SOUND_RELEASE);
}

function tickWind(boat, wind) {
  wind.clock++;
  const operator = helmOperator(boat);
  const player = operator?.player;
  const trim = boatAnim(boat, "trim");
  if (!operator) {
    // Nobody at the helm: the sails are down (leaving the helm lowers them); the wind just passes.
    if (wind.gustEnds !== undefined && wind.clock >= wind.gustEnds) {
      wind.gustEnds = undefined;
      wind.nextGust = wind.clock + GUST_DELAY_AFTER_LULL;
    }
    if (wind.boostEnds !== undefined && wind.clock >= wind.boostEnds) {
      wind.boostEnds = undefined;
      boat.boostSpeed = undefined;
    }
    return;
  }
  if (wind.boostEnds !== undefined) {
    if (wind.clock >= wind.boostEnds) return lull(operator, boat, wind);
    if (trim) {
      // The wind shows on set sails only (rsprox: lowering them stops it at once).
      if (sailsUp(boat)) windOnSails(player, boat, trim.boost);
      if (!wind.released && (wind.clock - wind.trimmedAt) % TRIM_LOOP_TICKS === 0) {
        operator.actor.performAnimation(new Animation(trim.player.loop));
        animateDeckLocs(player, boat, isHelm, trim.helm.loop);
      }
    }
    return;
  }
  if (wind.gustEnds !== undefined) {
    if (wind.clock >= wind.gustEnds) return lull(operator, boat, wind);
    if (operator.crew && wind.clock - wind.gustStarted === CREW_TRIM_TICKS) {
      trimSails(player, boat, { actor: operator.actor, crew: true });
      return;
    }
    if (trim && sailsUp(boat)) windOnSails(player, boat, trim.gust);
    return;
  }
  if (sailsUp(boat) && wind.clock >= wind.nextGust) startGust(player, boat, wind);
}

/** Sets the boat's wind going the first time its sails are set; it runs as long as the boat. */
function windFor(boat) {
  let wind = winds.get(boat);
  if (wind) return wind;
  wind = { clock: 0, nextGust: FIRST_GUST_DELAY, gustStarted: 0, gustEnds: undefined, boostEnds: undefined, trimmedAt: 0 };
  winds.set(boat, wind);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, boat, false); }
    execute() {
      if (!BoatManager.getSpec(boat)) {
        winds.delete(boat);
        this.stop();
        return;
      }
      tickWind(boat, wind);
    }
  })());
  return wind;
}

/** Whether the sails are trimmed: the helm plays the trim's loop instead of its own. */
function isTrimmed(boat) {
  return winds.get(boat)?.boostEnds !== undefined;
}

module.exports = {
  releaseBurst,
  windFor,
  canTrim,
  trimSails,
  isTrimmed,
  helmOperator,
  trimXp,
  GUST_TICKS,
  GUST_DELAY_AFTER_TRIM,
  GUST_DELAY_AFTER_LULL,
  FIRST_GUST_DELAY,
  CREW_TRIM_TICKS,
};
