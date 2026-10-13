"use strict";

/**
 * Commander Zilyana and her bodyguards, as captured (rsprox). Zilyana fights in melee range only:
 * half her attacks are melee, half a magic strike (10-20, Wiki) that lights up the target.
 */
const Common = require("./Common.GodWars");
const Combat = require("./Combat.GodWars");

const REACH = 8;

const STRIKE = { style: "MELEE", anim: 6967, sound: 2503, maxHit: 27 };
const LIGHT = { style: "MAGIC", anim: 6970, sound: 3856, targetGfx: { id: 1221, delay: 30 }, hitDelay: 1, minHit: 10, maxHit: 20 };

const STARLIGHT = { style: "MELEE", anim: 6376, sound: 3888 };
const GROWLER = {
  style: "MAGIC",
  anim: 7037,
  sound: 3890,
  npcGfx: [1182, 30],
  projectile: { id: 1183, start: 35, base: 26, perTile: 10, angle: 5, progress: 100, startHeight: 50, endHeight: 70 },
};
const BREE = {
  style: "RANGED",
  anim: 7026,
  sound: 2693,
  npcGfx: [1185, 0],
  projectile: { id: 1190, start: 30, base: 46, perTile: 5, angle: 15, progress: 150, startHeight: 240, endHeight: 146 },
};

function chooseZilyana() {
  return Common.core.Misc.randomInclusive(0, 1) === 0 ? STRIKE : LIGHT;
}

function attachSaradomin(api) {
  const faction = Common.factionByKey("saradomin");
  const [starlight, growler, bree] = faction.bodyguards;
  api.registerNpcCombatMethodProvider(faction.general, Combat.createMethod({ choose: chooseZilyana }), { singleton: false });
  api.registerNpcCombatMethodProvider(starlight, Combat.single(STARLIGHT, 1), { singleton: false });
  api.registerNpcCombatMethodProvider(growler, Combat.single(GROWLER, REACH), { singleton: false });
  api.registerNpcCombatMethodProvider(bree, Combat.single(BREE, REACH), { singleton: false });
}

module.exports = { attachSaradomin };
