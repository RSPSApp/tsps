"use strict";

/**
 * General Graardor and his sergeants, as captured (rsprox). Graardor: 2/3 melee, 1/3 a ground
 * slam (ranged) that hits every player in the chamber for 15-35, used only in melee range (Wiki).
 */
const Common = require("./Common.GodWars");
const Combat = require("./Combat.GodWars");

const RANGED_REACH = 8;

const SLAM = {
  style: "RANGED",
  anim: 7021,
  npcGfx: [1203, 30],
  projectile: { id: 1202, start: 31, base: 60, perTile: 5, angle: 9, progress: 200, startHeight: 0, endHeight: 0 },
  room: true,
  minHit: 15,
  maxHit: 35,
};
const SMASH = { style: "MELEE", anim: 7018, sound: 3871, maxHit: 60 };

const STRONGSTACK = { style: "MELEE", anim: 6154, sound: 469 };
const STEELWILL = {
  style: "MAGIC",
  anim: 7071,
  sound: 3868,
  npcGfx: [1216, 30],
  projectile: { id: 1217, start: 30, base: 46, perTile: 10, angle: 16, progress: 64, startHeight: 90, endHeight: 124 },
};
const GRIMSPIKE = {
  style: "RANGED",
  anim: 7073,
  sound: 3841,
  npcGfx: [1219, 0],
  projectile: { id: 1220, start: 30, base: 46, perTile: 5, angle: 15, progress: 11, startHeight: 120, endHeight: 146 },
};

function chooseGraardor() {
  return Common.core.Misc.randomInclusive(0, 2) === 0 ? SLAM : SMASH;
}

function attachBandos(api) {
  const [strongstack, steelwill, grimspike] = Common.factionByKey("bandos").bodyguards;
  api.registerNpcCombatMethodProvider(Common.factionByKey("bandos").general, Combat.createMethod({ choose: chooseGraardor }), { singleton: false });
  api.registerNpcCombatMethodProvider(strongstack, Combat.single(STRONGSTACK, 1), { singleton: false });
  api.registerNpcCombatMethodProvider(steelwill, Combat.single(STEELWILL, RANGED_REACH), { singleton: false });
  api.registerNpcCombatMethodProvider(grimspike, Combat.single(GRIMSPIKE, RANGED_REACH), { singleton: false });
}

module.exports = { attachBandos };
