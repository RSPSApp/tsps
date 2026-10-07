"use strict";

/**
 * What each wave sends in, and where.
 *
 * The composition is the LlemonDuck "fortis-colosseum" RuneLite plugin's (BSD-2-Clause), as
 * Offline_Scape ports it; the 12 fixed spawn points are Supalosa's colosseum line-of-sight tool's.
 * Both match the Wiki's wave breakdown, and the capture's wave 1 (the trio around 1826, 3111 and
 * a shaman on point 1) fits them.
 */

const Shared = require("./ColosseumShared");

/** South-west corners, in the arena's world tiles. */
const SPAWN_POINTS = [
  { x: 1811, y: 3104 }, { x: 1817, y: 3106 }, { x: 1811, y: 3109 }, { x: 1821, y: 3109 },
  { x: 1827, y: 3109 }, { x: 1825, y: 3114 }, { x: 1821, y: 3103 }, { x: 1827, y: 3103 },
  { x: 1824, y: 3099 }, { x: 1832, y: 3107 }, { x: 1836, y: 3109 }, { x: 1836, y: 3104 },
];
/** No spawn point within this many tiles of the player is used (Offline_Scape, from captures). */
const SPAWN_EXCLUSION = 4;
/** The Fremennik trio forms around a random tile in the middle (Offline_Scape, from captures). */
const FREMENNIK_ZONE = { minX: 1821, maxX: 1827, minY: 3105, maxY: 3111 };
/**
 * Where each of the trio stands, from the player and from the middle of their formation:
 * berserker north, seer east, archer west, Quartet's extra warbander south (Wiki; Offline_Scape's
 * captures).
 */
const TRIO_OFFSETS = { berserker: [0, 1], seer: [1, 0], archer: [-1, 0], quartet: [0, -1] };
/** Reinforcements arrive 40 seconds into a wave, through the gate on the player's side. */
const REINFORCEMENT_TICKS = 67;
const GATES = { north: 3122, south: 3091 };
const GATE_X = 1824;

function ids() {
  const N = Shared.core().NpcIdentifiers;
  return {
    berserker: N.FREMENNIK_WARBAND_BERSERKER,
    archer: N.FREMENNIK_WARBAND_ARCHER,
    seer: N.FREMENNIK_WARBAND_SEER,
    shaman: N.SERPENT_SHAMAN,
    jaguar: N.JAGUAR_WARRIOR,
    javelin: N.JAVELIN_COLOSSUS,
    manticore: N.MANTICORE,
    shockwave: N.SHOCKWAVE_COLOSSUS,
    minotaur: N.MINOTAUR_4,
    minotaurRouting: N.MINOTAUR_5,
    sol: N.SOL_HEREDIT,
  };
}

/**
 * The NPCs a wave starts with. `active` is the run's modifiers (by key). Quartet adds a
 * random warbander (Wiki).
 */
function startingNpcs(wave, active, random = Math.random) {
  const I = ids();
  const npcs = [I.berserker, I.archer, I.seer];
  if (active.has("quartet")) npcs.push(pick([I.berserker, I.archer, I.seer], random));
  if (wave <= 6) npcs.push(I.shaman);
  const javelins = wave === 2 || wave === 3 ? wave - 1 : wave >= 5 ? 2 - (wave % 2) : 0;
  for (let i = 0; i < javelins; i++) npcs.push(I.javelin);
  if (wave >= 4) for (let i = 0; i < (wave <= 8 ? 1 : 2); i++) npcs.push(I.manticore);
  if (wave === 7 || wave === 8 || wave === 11) {
    for (let i = 0; i < (active.has("dynamic-duo") ? 2 : 1); i++) npcs.push(I.shockwave);
  }
  return npcs;
}

/**
 * The NPCs that join 40 seconds in (Wiki): the jaguar on waves 1-6, a shaman on 4-6 and 10-11,
 * the Minotaur on 7-11. Sol Heredit's wave has none.
 */
function reinforcements(wave, active) {
  const I = ids();
  const npcs = [];
  if (wave <= 6) npcs.push(I.jaguar);
  if ((wave >= 4 && wave <= 6) || wave === 10 || wave === 11) npcs.push(I.shaman);
  if (wave >= 7 && wave <= 11) npcs.push(active.has("red-flag") ? I.minotaurRouting : I.minotaur);
  return npcs;
}

function isFremennik(id) {
  const I = ids();
  return id === I.berserker || id === I.archer || id === I.seer;
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

/**
 * Where each NPC of a wave stands. The trio stands berserker north, archer west and seer east of
 * a random middle tile (Quartet's extra one to the south); the rest take distinct spawn points away
 * from the player, falling back to any free point when every one is close.
 */
function placeWave(npcs, player, random = Math.random) {
  const at = player.getLocation();
  const base = {
    x: FREMENNIK_ZONE.minX + Math.floor(random() * (FREMENNIK_ZONE.maxX - FREMENNIK_ZONE.minX + 1)),
    y: FREMENNIK_ZONE.minY + Math.floor(random() * (FREMENNIK_ZONE.maxY - FREMENNIK_ZONE.minY + 1)),
  };
  const I = ids();
  const offsets = new Map([[I.berserker, TRIO_OFFSETS.berserker], [I.archer, TRIO_OFFSETS.archer], [I.seer, TRIO_OFFSETS.seer]]);
  const used = new Set();
  const far = (point) => Math.max(Math.abs(point.x - at.getX()), Math.abs(point.y - at.getY())) > SPAWN_EXCLUSION;
  return npcs.map((id) => {
    if (isFremennik(id)) {
      const offset = offsets.get(id) ?? TRIO_OFFSETS.quartet;
      offsets.delete(id);
      return { id, x: base.x + offset[0], y: base.y + offset[1], offset };
    }
    const free = SPAWN_POINTS.map((_, index) => index).filter((index) => !used.has(index));
    const preferred = free.filter((index) => far(SPAWN_POINTS[index]));
    const index = pick(preferred.length ? preferred : free.length ? free : SPAWN_POINTS.map((_, i) => i), random);
    used.add(index);
    return { id, ...SPAWN_POINTS[index] };
  });
}

/** Reinforcements come through the gate on the player's half of the arena. */
function placeReinforcements(npcs, player, random = Math.random) {
  const gateY = player.getLocation().getY() > 3107 ? GATES.north : GATES.south;
  return npcs.map((id) => ({ id, x: GATE_X - 1 + Math.floor(random() * 4), y: gateY }));
}

module.exports = {
  SPAWN_POINTS, FREMENNIK_ZONE, REINFORCEMENT_TICKS, TRIO_OFFSETS,
  ids, startingNpcs, reinforcements, isFremennik, placeWave, placeReinforcements,
};
