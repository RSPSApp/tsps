"use strict";

/**
 * Contact!'s dungeon traps under Sophanem (plane 2): four floor-spike traps ("Trap", Evade,
 * contact_spiketrap_floor 20271) and seven spear traps ("Trap", Disable, contact_speartrap 20272).
 * Every trap is four locs (yarn dump:loc 20271,20272). The spike locs are the 2x2 of floor a
 * player sets off; the spear locs line both walls, and the 2x2 between them is the floor.
 *
 * Recorded (rsprox rec 3015, rev 231; rec 101 one more evade):
 * - Stepping onto a trap's floor, the tick after: "You accidentally set off a trap!", the player
 *   says "Ouch!", all four locs play their release (spikes agilityarena_floorspikes_activate 1111,
 *   synth 1383; spears speartrap_release 459, synth 1394), and a tick later a hit with the
 *   player's hurt sound (ticks 1253, 2128, 2137, 4714). It went off every time it was stepped on.
 * - The hits were 19, 16, 18 and 15 at 97, 69, 80 and 55 hitpoints: the Wiki's (Contact!/Quick
 *   guide) "10% of current hitpoints, rounded down, plus 10 damage".
 * - Evade/Disable: "You successfully evade the trap." / "You successfully disable the trap." with
 *   synth 2387 on the arrival tick, and the player walks (walk pace) across the trap to the tile
 *   beyond it, without setting it off (ticks 2252, 3027, 3347, 4993, 5924, 5985). Eight attempts,
 *   none failed. From on the floor (after setting it off) the walk leaves it towards the clicked
 *   loc (tick 2339), or, level with it, by the nearer edge (tick 4815).
 *
 * Ours (not captured): no failure roll; the hit always a tick after the set-off (at tick 2338 the
 * crossing that followed put it 3 ticks later); the spike trap at 2138,4408 crossed east-west like
 * the three recorded ones.
 */

const PLANE = 2;
const SPIKE = "spike";
const SPEAR = "spear";
/** axis: the direction a player crosses the trap in. locs: where its four locs stand. */
const TRAPS = [
  spikes(2138, 4408),
  spikes(2148, 4403),
  spikes(2158, 4403),
  spikes(2169, 4356),
  spears({ minX: 2120, maxX: 2121, minY: 4401, maxY: 4402 }, "y", [[2119, 4401], [2119, 4402], [2121, 4401], [2121, 4402]]),
  spears({ minX: 2128, maxX: 2129, minY: 4377, maxY: 4378 }, "y", [[2127, 4377], [2127, 4378], [2129, 4377], [2129, 4378]]),
  spears({ minX: 2152, maxX: 2153, minY: 4373, maxY: 4374 }, "x", [[2152, 4372], [2153, 4372], [2152, 4374], [2153, 4374]]),
  spears({ minX: 2155, maxX: 2156, minY: 4377, maxY: 4378 }, "x", [[2155, 4376], [2156, 4376], [2155, 4378], [2156, 4378]]),
  spears({ minX: 2165, maxX: 2166, minY: 4378, maxY: 4379 }, "y", [[2164, 4378], [2164, 4379], [2166, 4378], [2166, 4379]]),
  spears({ minX: 2169, maxX: 2170, minY: 4388, maxY: 4389 }, "y", [[2168, 4388], [2168, 4389], [2170, 4388], [2170, 4389]]),
];

function spikes(x, y) {
  return {
    name: `spikes-${x}-${y}`, kind: SPIKE, gameval: "contact_spiketrap_floor", axis: "x",
    minX: x, maxX: x + 1, minY: y, maxY: y + 1,
    locs: [[x, y], [x, y + 1], [x + 1, y], [x + 1, y + 1]],
  };
}

function spears(floor, axis, locs) {
  return { name: `spears-${floor.minX}-${floor.minY}`, kind: SPEAR, gameval: "contact_speartrap", axis, ...floor, locs };
}

const MESSAGES = {
  setOff: "You accidentally set off a trap!",
  [SPIKE]: "You successfully evade the trap.",
  [SPEAR]: "You successfully disable the trap.",
};
const SAY = "Ouch!";
const PASS_SOUND = 2387;
const RELEASE = {
  [SPIKE]: { animation: 1111, sound: 1383 }, // agilityarena_floorspikes_activate
  [SPEAR]: { animation: 459, sound: 1394 }, // speartrap_release
};
/** Ticks after the step onto the floor: the message and release, then the hit. */
const SET_OFF_AT = 1;
const HIT_AT = 2;
/** Set by Evade/Disable: { trap, cycle, on }. The walk must step on within CROSSING_START_TICKS. */
const CROSSING_ATTRIBUTE = "contact:trap-crossing";
const CROSSING_START_TICKS = 2;

const PlayerHitSounds = require("../../combat/PlayerHitSounds.plugin");

let core;
/**
 * Players whose set-off is still to come: { queued }. An Evade/Disable clicked meanwhile runs the
 * tick after the set-off (rec 3015: set off at tick 2338, the evade at 2339).
 */
const pendingSetOff = new WeakMap();
/** The cycle each player's last set-off fired on: an Evade the same tick waits one too. */
const setOffCycle = new WeakMap();

function trapAt(x, y, z) {
  if (z !== PLANE) return null;
  return TRAPS.find((t) => x >= t.minX && x <= t.maxX && y >= t.minY && y <= t.maxY) ?? null;
}

function trapOf(kind, x, y, z) {
  if (z !== PLANE) return null;
  return TRAPS.find((t) => t.kind === kind && t.locs.some(([lx, ly]) => lx === x && ly === y)) ?? null;
}

/** Wiki (Contact!/Quick guide), matching every recorded hit: 10% of current hitpoints + 10. */
function trapDamage(hitpoints) {
  return Math.floor(Math.max(0, hitpoints) / 10) + 10;
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

/**
 * The tile beyond the trap, along its axis, level with the player. From off the floor, the far
 * side; from on it, towards the clicked loc, or (level with it) out by the nearer edge.
 */
function farSide(trap, at, loc) {
  const horizontal = trap.axis === "x";
  const p = horizontal ? at.getX() : at.getY();
  const min = horizontal ? trap.minX : trap.minY;
  const max = horizontal ? trap.maxX : trap.maxY;
  let dir;
  if (p < min) dir = 1;
  else if (p > max) dir = -1;
  else {
    const l = horizontal ? loc[0] : loc[1];
    dir = l !== p ? Math.sign(l - p) : (p - min <= max - p ? -1 : 1);
  }
  const along = dir > 0 ? max + 1 : min - 1;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return horizontal
    ? new core.Location(along, clamp(at.getY(), trap.minY, trap.maxY), at.getZ())
    : new core.Location(clamp(at.getX(), trap.minX, trap.maxX), along, at.getZ());
}

function crossing(player) {
  const state = player.getAttribute(CROSSING_ATTRIBUTE);
  if (!state) return null;
  if (state.on || core.World.getProcessCycle() - state.cycle <= CROSSING_START_TICKS) return state;
  player.setAttribute(CROSSING_ATTRIBUTE, null);
  return null;
}

function pass(player, trap, loc) {
  if (!player.isRegistered() || player.getHitpoints() <= 0 || crossing(player)) return;
  player.sendMessage(MESSAGES[trap.kind]);
  player.getPacketSender().sendSound(PASS_SOUND, 255, 0);
  const at = player.getLocation();
  const on = trapAt(at.getX(), at.getY(), at.getZ()) === trap;
  player.setAttribute(CROSSING_ATTRIBUTE, { trap: trap.name, cycle: core.World.getProcessCycle(), on });
  player.getMovementQueue().requestWalk(farSide(trap, at, loc), false);
}

function clickTrap(kind, event) {
  const { player, object } = event;
  const location = object?.getLocation?.() ?? event.location;
  if (!player || !location) return false;
  const x = location.getX();
  const y = location.getY();
  const trap = trapOf(kind, x, y, location.getZ());
  if (!trap) return false;
  const pending = pendingSetOff.get(player);
  if (pending) pending.queued.push(() => pass(player, trap, [x, y]));
  else if (setOffCycle.get(player) === core.World.getProcessCycle()) later(1, () => pass(player, trap, [x, y]));
  else pass(player, trap, [x, y]);
  return true;
}

function release(player, trap) {
  const { Animation, CacheDefinitions, Location, MapObjects } = core;
  const id = CacheDefinitions.getLocId(trap.gameval);
  const { animation, sound } = RELEASE[trap.kind];
  const viewers = [player, ...player.getLocalPlayers()];
  for (const [x, y] of trap.locs) {
    const loc = MapObjects.get(id, new Location(x, y, PLANE), null);
    if (!loc) continue;
    for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(loc, new Animation(animation));
  }
  player.getPacketSender().sendSound(sound, 255, 0);
}

function stillOn(player, trap) {
  const at = player.getLocation();
  return player.isRegistered() && player.getHitpoints() > 0 && trapAt(at.getX(), at.getY(), at.getZ()) === trap;
}

function setOff(player, trap) {
  const pending = pendingSetOff.get(player) ?? { queued: [] };
  pendingSetOff.set(player, pending);
  later(SET_OFF_AT, () => {
    if (pendingSetOff.get(player) === pending) pendingSetOff.delete(player);
    if (pending.queued.length) later(1, () => pending.queued.forEach((run) => run()));
    if (!stillOn(player, trap)) return;
    setOffCycle.set(player, core.World.getProcessCycle());
    player.sendMessage(MESSAGES.setOff);
    player.forceChat(SAY);
    release(player, trap);
    later(HIT_AT - SET_OFF_AT, () => {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return;
      const hit = new core.HitDamage(trapDamage(player.getHitpoints()), core.HitMask.RED).onApplied((taken) => {
        if (taken > 0) PlayerHitSounds.playOwnHurtSound(player);
      });
      player.getCombat().getHitQueue().addPendingDamage([hit]);
    });
  });
}

function enterTrap({ player }) {
  const at = player.getLocation();
  const trap = trapAt(at.getX(), at.getY(), at.getZ());
  if (!trap) return;
  const state = crossing(player);
  if (state?.trap === trap.name) {
    state.on = true;
    return;
  }
  setOff(player, trap);
}

function leaveTrap({ player }) {
  player.setAttribute(CROSSING_ATTRIBUTE, null);
}

module.exports = function registerContactTraps(api) {
  core = api.core;
  api.onObjectInteraction("Trap", {
    Evade: (event) => clickTrap(SPIKE, event),
    Disable: (event) => clickTrap(SPEAR, event),
  });
  for (const t of TRAPS) {
    const zone = { minX: t.minX, maxX: t.maxX, minY: t.minY, maxY: t.maxY, levels: [PLANE] };
    api.onZoneEnter(zone, enterTrap);
    api.onZoneExit(zone, leaveTrap);
  }
};

module.exports._test = { TRAPS, trapAt, trapOf, trapDamage, farSide };
