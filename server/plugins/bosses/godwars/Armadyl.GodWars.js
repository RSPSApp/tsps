"use strict";

/**
 * Kree'arra and his flock, as captured (rsprox). Kree'arra's one attack animation throws either
 * a ranged tornado or a magic blast (equally often in the captures) at every player in the
 * chamber; the magic one rolls against Ranged defence (Wiki). Melee only reaches them with a
 * halberd or salamander (Combat.GodWars deniesMelee).
 */
const Common = require("./Common.GodWars");
const Combat = require("./Combat.GodWars");

const REACH = 8;
const WIND = { start: 51, base: 60, perTile: 8, angle: 15, progress: 64, startHeight: 172, endHeight: 124 };

const TORNADO = { style: "RANGED", anim: 6980, sound: 3870, projectile: { id: 1199, ...WIND }, room: true, maxHit: 69 };
const BLAST = { style: "MAGIC", anim: 6980, sound: 3870, projectile: { id: 1200, ...WIND }, room: true, maxHit: 21, accuracyAs: "RANGED" };

const SKREE = {
  style: "MAGIC",
  anim: 6955,
  sound: 3851,
  npcGfx: [1194, 0],
  projectile: { id: 1201, start: 31, base: 46, perTile: 10, angle: 16, progress: 64, startHeight: 400, endHeight: 124 },
  targetGfx: { id: 1195, delay: "impact" },
};
const GEERIN = {
  style: "RANGED",
  anim: 6956,
  sound: 2699,
  projectile: { id: 1192, start: 41, base: 46, perTile: 5, angle: 15, progress: 11, startHeight: 250, endHeight: 146 },
};
const KILISA = { style: "MELEE", anim: 6957 };

function chooseKreeArra() {
  return Common.core.Misc.randomInclusive(0, 1) === 0 ? TORNADO : BLAST;
}

function attachArmadyl(api) {
  const faction = Common.factionByKey("armadyl");
  const [skree, geerin, kilisa] = faction.bodyguards;
  api.registerNpcCombatMethodProvider(faction.general, Combat.createMethod({ choose: chooseKreeArra, reach: REACH }), { singleton: false });
  api.registerNpcCombatMethodProvider(skree, Combat.single(SKREE, REACH), { singleton: false });
  api.registerNpcCombatMethodProvider(geerin, Combat.single(GEERIN, REACH), { singleton: false });
  api.registerNpcCombatMethodProvider(kilisa, Combat.single(KILISA, 1), { singleton: false });
}

module.exports = { attachArmadyl };
