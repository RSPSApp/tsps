/**
 * Prayer experience for killing a reanimated creature (Wiki: Ensouled heads, "Upon killing the monster, Prayer
 * experience will be rewarded."). ArceuusItemSpells spawns the creature owned by its caster; when the caster kills
 * it, they get the head's Prayer experience. The Wiki does not say whether anyone else could earn it: the creature
 * is the caster's own, so only its owner is rewarded (inferred).
 */

/** Reanimated creature npc id -> Prayer experience (Wiki: Ensouled heads table). */
const PRAYER_XP = new Map([
  [7018, 130], // goblin
  [7019, 182], // monkey
  [7020, 286], // imp
  [7021, 364], // minotaur
  [7022, 454], // scorpion
  [7023, 480], // bear
  [7024, 494], // unicorn
  [7025, 520], // dog
  [7026, 584], // chaos druid
  [7027, 650], // giant
  [7028, 716], // ogre
  [7029, 754], // elf
  [7030, 780], // troll
  [7031, 832], // horror
  [7032, 884], // kalphite
  [7033, 936], // dagannoth
  [7034, 1040], // bloodveld
  [7035, 1104], // tzhaar
  [7036, 1170], // demon
  [11463, 1200], // hellhound
  [7037, 1234], // aviansie
  [7038, 1300], // abyssal
  [7039, 1560], // dragon
]);

let core;

function rewardReanimationKill({ npc, npcId, killer }) {
  const xp = PRAYER_XP.get(npcId);
  if (!xp) return;
  const owner = npc?.getOwner?.();
  if (!owner || owner !== killer || !owner.isPlayer?.()) return;
  owner.getSkillManager().addExperiences(core.Skill.PRAYER, xp);
}

module.exports = {
  name: "Reanimation",
  members: true,
  register(api) {
    core = api.core;
    api.onNpcDeath(rewardReanimationKill);
  },
  _test: { PRAYER_XP, rewardReanimationKill },
};
