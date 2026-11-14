"use strict";

/**
 * The Uzer Mastaba's spear traps (The Curse of Arrav): two 2x2 corridors into the alcoves
 * before the levers, one south (x 3891-3892, y 4552-4553) and one north (y 4598-4599). Each
 * corridor is flanked by four "Odd markings" locs (coa_mastaba_spear_trap_1..4).
 *
 * Wiki (Odd markings (Uzer Mastaba)): searching them needs 62 Thieving and gives no XP; an
 * undisabled trap deals "up to 19 damage" to a player walking past. Messages as below.
 *
 * Recorded (rsprox rec 3168, rev 232, ticks 6658-6984, south corridor):
 * - Search that works: "You find a trap, but you successfully manage to disable it." with
 *   synth 2387, and the player walks (walk pace, run on) straight across the corridor to the
 *   tile beyond it on the same row (3890 <-> 3893), without setting it off.
 * - Search that fails: "You find a trap! You try to disable it, but fail to do so." with
 *   synth 4978. No damage, the player stays put.
 * - Disabling lasts only for that crossing: a later plain walk onto the corridor set it off.
 *   The tick after the player stepped on: "You accidentally set off a trap!", the player says
 *   "Ouch!", all four markings play speartrap_release (459), synth 1394; a tick later a 19 hit.
 *
 * The disable chance is the Wiki's Skilling success chart (low 10, high 300, from 62).
 * Recorded hit sound: human_hit (520, delay 20) with the hit, the player's own hurt sound.
 *
 * Ours (no capture or Wiki value): a search below 62 Thieving always failing with the recorded
 * failure line; the hit rolled 1-19; a search of the far marking, whose route steps onto the
 * corridor (setting it off), disabling and crossing on to the side opposite the one stepped on from.
 */

const CORRIDORS = [
  { name: "south", minX: 3891, maxX: 3892, minY: 4552, maxY: 4553 },
  { name: "north", minX: 3891, maxX: 3892, minY: 4598, maxY: 4599 },
];
const PLANE = 0;
/** Where the markings sit around a corridor, for the release animation (yarn dump:loc). */
const MARKINGS = {
  south: [["coa_mastaba_spear_trap_1", 3891, 4553], ["coa_mastaba_spear_trap_2", 3892, 4553],
    ["coa_mastaba_spear_trap_4", 3891, 4551], ["coa_mastaba_spear_trap_4", 3892, 4551]],
  north: [["coa_mastaba_spear_trap_1", 3892, 4597], ["coa_mastaba_spear_trap_2", 3891, 4597],
    ["coa_mastaba_spear_trap_3", 3891, 4599], ["coa_mastaba_spear_trap_3", 3892, 4599]],
};
const THIEVING_LEVEL = 62;
const DISABLE_CHANCE = { low: 10, high: 300 };
const MAX_HIT = 19;
const MESSAGES = {
  disabled: "You find a trap, but you successfully manage to disable it.",
  failed: "You find a trap! You try to disable it, but fail to do so.",
  setOff: "You accidentally set off a trap!",
};
const SAY = "Ouch!";
const SOUNDS = { disabled: 2387, failed: 4978, release: 1394 };
const RELEASE_ANIMATION = 459; // speartrap_release
/** Ticks after the step onto the corridor: the message and release, then the hit. */
const SET_OFF_AT = 1;
const HIT_AT = 2;
/**
 * Set by a disabling search: { corridor, cycle }. The crossing must step on within
 * CROSSING_START_TICKS, and the flag ends when the player leaves the corridor.
 */
const CROSSING_ATTRIBUTE = "curse-of-arrav:spear-trap-crossing";
const CROSSING_START_TICKS = 2;
/** "west" or "east": the side the player stepped onto the corridor from, while on it. */
const ENTERED_FROM_ATTRIBUTE = "curse-of-arrav:spear-trap-entered-from";

const PlayerHitSounds = require("../../combat/PlayerHitSounds.plugin");

const CORRIDOR_ZONES = CORRIDORS.map(({ minX, maxX, minY, maxY }) => ({ minX, maxX, minY, maxY, levels: [PLANE] }));

let core;

function corridorAt(x, y, z) {
  if (z !== PLANE) return null;
  return CORRIDORS.find((c) => x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY) ?? null;
}

/** The corridor a marking guards: the one it borders. */
function corridorOf(location) {
  const x = location.getX();
  const y = location.getY();
  return CORRIDORS.find((c) => x >= c.minX && x <= c.maxX && y >= c.minY - 1 && y <= c.maxY + 1) ?? null;
}

/**
 * The Wiki's Skilling success chart (Jagex-provided): low 10, high 300 out of 256, from 62.
 * 75% at 62, sure from 84. Below 62 there is no chart: Ours, it always fails.
 */
function disableChance(level) {
  if (level < THIEVING_LEVEL) return 0;
  const { low, high } = DISABLE_CHANCE;
  const capped = Math.min(99, level);
  return Math.min(1, (1 + Math.floor((low * (99 - capped)) / 98 + (high * (capped - 1)) / 98 + 0.5)) / 256);
}

function rollHit(random = Math.random) {
  return 1 + Math.min(MAX_HIT - 1, Math.floor(random() * MAX_HIT));
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

/**
 * The tile on the far side of the corridor, on the player's row. From inside it (a search of
 * the far marking routes onto the corridor), the side opposite the one they stepped on from.
 */
function farSide(corridor, at, enteredFrom) {
  const west = at.getX() < corridor.minX || (at.getX() <= corridor.maxX && enteredFrom === "west");
  const x = west ? corridor.maxX + 1 : corridor.minX - 1;
  const y = Math.max(corridor.minY, Math.min(corridor.maxY, at.getY()));
  return new core.Location(x, y, at.getZ());
}

/** The disabled crossing in progress: walking over, or about to step on. */
function crossing(player) {
  const state = player.getAttribute(CROSSING_ATTRIBUTE);
  if (!state) return null;
  if (state.on || core.World.getProcessCycle() - state.cycle <= CROSSING_START_TICKS) return state;
  player.setAttribute(CROSSING_ATTRIBUTE, null);
  return null;
}

function searchMarkings(event, random = Math.random) {
  const { player, object } = event;
  const corridor = corridorOf(object?.getLocation?.() ?? event.location);
  if (!player || !corridor) return false;
  if (crossing(player)) return true;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  const sender = player.getPacketSender();
  if (random() >= disableChance(level)) {
    player.sendMessage(MESSAGES.failed);
    sender.sendSound(SOUNDS.failed, 255, 0);
    return true;
  }
  player.sendMessage(MESSAGES.disabled);
  sender.sendSound(SOUNDS.disabled, 255, 0);
  player.setAttribute(CROSSING_ATTRIBUTE, { corridor: corridor.name, cycle: core.World.getProcessCycle(), on: false });
  player.getMovementQueue().requestWalk(farSide(corridor, player.getLocation(), player.getAttribute(ENTERED_FROM_ATTRIBUTE)), false);
  return true;
}

function releaseSpears(player, corridor) {
  const { Animation, CacheDefinitions, Location, MapObjects } = core;
  const viewers = [player, ...player.getLocalPlayers()];
  for (const [gameval, x, y] of MARKINGS[corridor.name]) {
    const marking = MapObjects.get(CacheDefinitions.getLocId(gameval), new Location(x, y, PLANE), null);
    if (!marking) continue;
    for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(marking, new Animation(RELEASE_ANIMATION));
  }
  player.getPacketSender().sendSound(SOUNDS.release, 255, 0);
}

/** Still standing on the corridor, alive and in the world. */
function stillOn(player, corridor) {
  const at = player.getLocation();
  return player.isRegistered() && player.getHitpoints() > 0 && corridorAt(at.getX(), at.getY(), at.getZ()) === corridor;
}

function setOff(player, corridor, random = Math.random) {
  later(SET_OFF_AT, () => {
    if (!stillOn(player, corridor)) return;
    player.sendMessage(MESSAGES.setOff);
    player.forceChat(SAY);
    releaseSpears(player, corridor);
    later(HIT_AT - SET_OFF_AT, () => {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return;
      const hit = new core.HitDamage(rollHit(random), core.HitMask.RED).onApplied((taken) => {
        if (taken > 0) PlayerHitSounds.playOwnHurtSound(player);
      });
      player.getCombat().getHitQueue().addPendingDamage([hit]);
    });
  });
}

function enterCorridor({ player }) {
  const at = player.getLocation();
  const corridor = corridorAt(at.getX(), at.getY(), at.getZ());
  if (!corridor) return;
  player.setAttribute(ENTERED_FROM_ATTRIBUTE, at.getX() === corridor.minX ? "west" : "east");
  const state = crossing(player);
  if (state?.corridor === corridor.name) {
    state.on = true;
    return;
  }
  setOff(player, corridor);
}

function leaveCorridor({ player }) {
  player.setAttribute(CROSSING_ATTRIBUTE, null);
  player.setAttribute(ENTERED_FROM_ATTRIBUTE, null);
}

module.exports = function registerSpearTraps(api) {
  core = api.core;
  api.onObjectInteraction("Odd markings", { Search: searchMarkings });
  for (const zone of CORRIDOR_ZONES) api.onZoneEnter(zone, enterCorridor);
  for (const zone of CORRIDOR_ZONES) api.onZoneExit(zone, leaveCorridor);
};

module.exports._test = { CORRIDORS, corridorAt, corridorOf, disableChance, rollHit, searchMarkings };
