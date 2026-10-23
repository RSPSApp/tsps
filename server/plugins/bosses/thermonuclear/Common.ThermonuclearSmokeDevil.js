"use strict";

/**
 * What every Thermonuclear smoke devil unit shares: ids, tiles and small helpers.
 * Facts and their sources are in docs/thermonuclear-smoke-devil.md.
 *
 * Engine-owned values live where the engine reads them and are only mirrored in
 * data/thermonuclear-smoke-devil.json as a record: the spawn comes from
 * npc-spawns.json, the animations, projectile, death ticks and respawn from
 * npc-combat-defs.json, and the max hit from monsters-complete.json (the engine's
 * PendingHit max - asserted in tests/thermonuclear-smoke-devil.test.cjs).
 */
const DATA = require("../data/thermonuclear-smoke-devil.json");

/** Cache: thermonuclear_smoke_devil (boss, 240 hp). Regular smoke devils share the room. */
const BOSS_ID = DATA.npcs.boss;
const SMOKE_DEVIL_ID = DATA.npcs.smokeDevil;

/** Cache: the crevice in and out of the boss room (NR: 535 outside, 536 inside). */
const CREVICE_OUTSIDE_ID = DATA.locs.creviceOutside;
const CREVICE_INSIDE_ID = DATA.locs.creviceInside;

/** The boss room south-west of the Smoke Devil Dungeon (NR polygon extremes). */
const LAIR = Object.freeze({ ...DATA.lair });
/** The room's door tiles: outside east of the crevice, inside west of it. */
const OUTSIDE_TILE = Object.freeze([...DATA.outsideTile]);
const INSIDE_TILE = Object.freeze([...DATA.insideTile]);

/** Cache sequence for the smoke shot (lore_dust_devil_attack), as captured. */
const ANIM_ATTACK = DATA.anims.attack;
/** Captured spotanims: 644 the smoke shot, 643 the impact on the player. */
const PROJECTILE_ID = DATA.projectiles.attack;
const IMPACT_ID = DATA.projectiles.impact;
/** Captured synth on every attack. */
const ATTACK_SOUND = DATA.sounds.attack;

/** Wiki: typeless magical ranged, speed 2, range 8. */
const ATTACK_SPEED = DATA.combat.attackSpeed;
const ATTACK_DISTANCE = DATA.combat.attackDistance;
/** Fitted estimate: the captured projectile flies 32-56 cycles; the hit lands ~2 ticks on. */
const HIT_DELAY_TICKS = DATA.combat.hitDelayTicks;

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const location = ([x, y, z]) => new core.Location(x, y, z ?? 0);

function within(bounds, at) {
  if (!at || (at.getZ?.() ?? 0) !== 0) return false;
  const x = at.getX();
  const y = at.getY();
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

const inLair = (at) => within(LAIR, at);

function isBoss(npc) {
  return npc?.getId?.() === BOSS_ID;
}

/** Players fighting in the same room as `npc`: in the lair and alive. */
function playersInRoom(npc) {
  const area = npc.getPrivateArea?.() ?? null;
  return npc.getPlayersWithinDistance(24).filter((player) =>
    player.getPrivateArea?.() === area && inLair(player.getLocation()) && player.getHitpoints() > 0);
}

module.exports = {
  DATA, BOSS_ID, SMOKE_DEVIL_ID, CREVICE_OUTSIDE_ID, CREVICE_INSIDE_ID,
  LAIR, OUTSIDE_TILE, INSIDE_TILE,
  ANIM_ATTACK, PROJECTILE_ID, IMPACT_ID, ATTACK_SOUND,
  ATTACK_SPEED, ATTACK_DISTANCE, HIT_DELAY_TICKS,
  init, location, within, inLair, isBoss, playersInRoom,
  get api() { return api; },
  get core() { return core; },
};
