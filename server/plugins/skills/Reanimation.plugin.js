/**
 * Prayer experience for killing a reanimated creature (Wiki: Ensouled heads, "Upon killing the monster, Prayer
 * experience will be rewarded."). ArceuusItemSpells spawns the creature owned by its caster; when the caster kills
 * it, they get the head's Prayer experience. The Wiki does not say whether anyone else could earn it: the creature
 * is the caster's own, so only its owner is rewarded (inferred).
 */

/** Reanimated creature -> Prayer experience (Wiki: Ensouled heads table), by its NpcIdentifiers name. */
const PRAYER_XP_BY_NAME = [
  ["REANIMATED_GOBLIN", 130], ["REANIMATED_MONKEY", 182], ["REANIMATED_IMP", 286], ["REANIMATED_MINOTAUR", 364],
  ["REANIMATED_SCORPION", 454], ["REANIMATED_BEAR", 480], ["REANIMATED_UNICORN", 494], ["REANIMATED_DOG", 520],
  ["REANIMATED_CHAOS_DRUID", 584], ["REANIMATED_GIANT", 650], ["REANIMATED_OGRE", 716], ["REANIMATED_ELF", 754],
  ["REANIMATED_TROLL", 780], ["REANIMATED_HORROR", 832], ["REANIMATED_KALPHITE", 884], ["REANIMATED_DAGANNOTH", 936],
  ["REANIMATED_BLOODVELD", 1040], ["REANIMATED_TZHAAR", 1104], ["REANIMATED_DEMON", 1170], ["REANIMATED_HELLHOUND", 1200],
  ["REANIMATED_AVIANSIE", 1234], ["REANIMATED_ABYSSAL", 1300], ["REANIMATED_DRAGON", 1560],
];
/** npc id -> Prayer experience, built from the names on first use. */
let prayerXpById = null;

function prayerXp(npcId) {
  prayerXpById ??= new Map(PRAYER_XP_BY_NAME.map(([name, xp]) => [core.NpcIdentifiers[name], xp]));
  return prayerXpById.get(npcId);
}

let core;

function rewardReanimationKill({ npc, npcId, killer }) {
  const xp = prayerXp(npcId);
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
  _test: { PRAYER_XP_BY_NAME, prayerXp, rewardReanimationKill },
};
