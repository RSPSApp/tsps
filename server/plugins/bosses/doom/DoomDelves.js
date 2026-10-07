"use strict";

/**
 * What changes with the delve level (Wiki, "Doom of Mokhaiotl" and its strategy guide's
 * "Table of attacks by delve level"). Delves past 8 ("deep delves") are delve 8 with 625
 * hitpoints.
 *
 * - hp: the Doom's hitpoints. speed: ticks between its attacks. maxHit: its orbs, unprotected.
 * - rockOrbs: orbs a rock throw sends after it bursts (two sets from delve 8, as two throws).
 * - shockwaves: slams per shockwave, two ticks apart from delve 3.
 * - larvae: none (delve 1, no prayer), random (one protection prayer), coloured (two).
 * - beam: the Special Beam's damage. punishDelay: ticks a melee punish holds back its next attack.
 * - acid, shield, burrow: the mechanics phases 3 and 4 add.
 * - shieldWalk: ticks per step of the earthen shield ("half" walking speed at delve 1; the
 *   capture shows delve 2 the same).
 */
const DELVES = [
  null,
  { hp: 525, speed: 6, maxHit: 47, rockOrbs: 1, rockThrows: 1, shockwaves: 1, larvae: "none", pairs: false, beam: 60, punishDelay: 8, acid: false, shield: false, burrow: false, shieldWalk: 2 },
  { hp: 550, speed: 6, maxHit: 50, rockOrbs: 2, rockThrows: 1, shockwaves: 1, larvae: "random", pairs: false, beam: 60, punishDelay: 8, acid: false, shield: false, burrow: false, shieldWalk: 2 },
  { hp: 575, speed: 5, maxHit: 50, rockOrbs: 2, rockThrows: 1, shockwaves: 2, larvae: "random", pairs: false, beam: 60, punishDelay: 7, acid: true, shield: true, burrow: false, shieldWalk: 1 },
  { hp: 600, speed: 5, maxHit: 50, rockOrbs: 3, rockThrows: 1, shockwaves: 2, larvae: "coloured", pairs: false, beam: 80, punishDelay: 7, acid: true, shield: true, burrow: false, shieldWalk: 1 },
  { hp: 625, speed: 5, maxHit: 53, rockOrbs: 3, rockThrows: 1, shockwaves: 3, larvae: "coloured", pairs: true, beam: 80, punishDelay: 7, acid: true, shield: true, burrow: true, shieldWalk: 1 },
  { hp: 650, speed: 5, maxHit: 53, rockOrbs: 3, rockThrows: 1, shockwaves: 3, larvae: "coloured", pairs: true, beam: 99, punishDelay: 7, acid: true, shield: true, burrow: true, shieldWalk: 1 },
  { hp: 650, speed: 4, maxHit: 57, rockOrbs: 3, rockThrows: 1, shockwaves: 4, larvae: "coloured", pairs: true, beam: 99, punishDelay: 6, acid: true, shield: true, burrow: true, shieldWalk: 1 },
  { hp: 675, speed: 4, maxHit: 65, rockOrbs: 3, rockThrows: 2, shockwaves: 5, larvae: "giant", pairs: false, beam: 99, punishDelay: 6, acid: true, shield: true, burrow: true, shieldWalk: 1 },
];
const DEEP = { ...DELVES[8], hp: 625 };

function delve(level) {
  return level > 8 ? DEEP : DELVES[Math.max(1, level)];
}

/** The tongue's lash when standing next to the Doom (Wiki); Protect from Melee halves it. */
const MELEE_MAX_HIT = 40;

module.exports = { delve, MELEE_MAX_HIT };
