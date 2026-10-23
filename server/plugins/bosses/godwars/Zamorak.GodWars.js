"use strict";

/**
 * K'ril Tsutsaroth and his demons, as captured (rsprox). K'ril walks up to his target and
 * attacks 2/3 melee (46), 1/3 magic (10-30). Against Protect from Melee, one melee attack in
 * nine is his special: "YARRRRRRR!", 35-49 through the prayer, and half the target's Prayer
 * points drained (Wiki).
 */
const Common = require("./Common.GodWars");
const Combat = require("./Combat.GodWars");

const REACH = 8;

const SWIPE = { style: "MELEE", anim: 6948, sound: 3866, maxHit: 46 };
const SLAM = { ...SWIPE, say: "YARRRRRRR!", minHit: 35, maxHit: 49, throughPrayer: true, special: true };
const FLAMES = {
  style: "MAGIC",
  anim: 6950,
  sound: 3861,
  npcGfx: [1224, 30],
  projectile: { id: 1225, start: 50, base: 56, perTile: 0, angle: 16, progress: 155, startHeight: 0, endHeight: 0 },
  minHit: 10,
  maxHit: 30,
};

const TSTANON = { style: "MELEE", anim: 64, sound: 397 };
const ZAKLN = {
  style: "RANGED",
  anim: 7077,
  sound: 3861,
  npcGfx: [1222, 0],
  projectile: { id: 1223, start: 30, base: 46, perTile: 5, angle: 15, progress: 11, startHeight: 120, endHeight: 146 },
};
const BALFRUG = {
  style: "MAGIC",
  anim: 4630,
  sound: 3861,
  npcGfx: [1226, 30],
  projectile: { id: 1227, start: 30, base: 26, perTile: 10, angle: 16, progress: 64, startHeight: 90, endHeight: 124 },
};

function chooseKril(npc, target) {
  const { Misc, PrayerHandler } = Common.core;
  if (Misc.randomInclusive(0, 2) === 0) return FLAMES;
  const protecting = target.isPlayer?.() && PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MELEE);
  return protecting && Misc.randomInclusive(0, 8) === 0 ? SLAM : SWIPE;
}

function drainOnSlam(attack, hit) {
  const target = hit.getTarget();
  if (!attack?.special || !target?.isPlayer?.()) return;
  const { Skill } = Common.core;
  const skills = target.getSkillManager();
  const amount = Math.floor(skills.getCurrentLevel(Skill.PRAYER) / 2);
  const apply = Common.core.applyPrayerDrainModifiers;
  const drain = typeof apply === "function" ? apply(target, amount) : amount;
  skills.setCurrentLevels(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - drain));
  skills.updateSkill(Skill.PRAYER);
  target.sendMessage("K'ril Tsutsaroth slams through your protection prayer, leaving you feeling drained.");
}

function attachZamorak(api) {
  const faction = Common.factionByKey("zamorak");
  const [tstanon, zakln, balfrug] = faction.bodyguards;
  api.registerNpcCombatMethodProvider(faction.general, Combat.createMethod({ choose: chooseKril, onHit: drainOnSlam }), { singleton: false });
  api.registerNpcCombatMethodProvider(tstanon, Combat.single(TSTANON, 1), { singleton: false });
  api.registerNpcCombatMethodProvider(zakln, Combat.single(ZAKLN, REACH), { singleton: false });
  api.registerNpcCombatMethodProvider(balfrug, Combat.single(BALFRUG, REACH), { singleton: false });
}

module.exports = { attachZamorak };
