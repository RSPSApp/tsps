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

/** The Zealot's robes chance and pieces are shared with the bone altars (Wiki: Zealot's robes, 1.25% per piece). */
const ZEALOT = require("./data/bone-altars.json").zealot;
const HEAD_SAVED_MESSAGE = "Your Zealot's robes save the ensouled head but still grant you experience.";
let zealotIds = null;

function zealotPieces(player) {
  zealotIds ??= new Set(ZEALOT.pieces.map((name) => core.CacheDefinitions.getObjId(name)));
  return player.getEquipment().getItems().filter((item) => zealotIds.has(item?.getId?.())).length;
}

/** "reanimation:head-consumed" { player, saved }: a cast is about to use up its head; the robes may spare it. */
function maybeSaveHead(request) {
  const chance = zealotPieces(request.player) * ZEALOT.chancePerPiece;
  if (chance <= 0 || Math.random() >= chance) return;
  request.saved = true;
  request.player.sendMessage(HEAD_SAVED_MESSAGE);
}

function rewardReanimationKill({ npc, npcId, killer }) {
  const xp = prayerXp(npcId);
  if (!xp) return;
  const owner = npc?.getOwner?.();
  if (!owner || owner !== killer || !owner.isPlayer?.()) return;
  owner.getSkillManager().addExperiences(core.Skill.PRAYER, xp);
}

module.exports = {
  name: "Reanimation",
  description: "Gives Prayer XP to the caster who kills a creature reanimated by an Arceuus ensouled-head spell.",
  members: true,
  register(api) {
    core = api.core;
    api.onNpcDeath(rewardReanimationKill);
    api.onCustomEvent("reanimation:head-consumed", maybeSaveHead);
  },
  _test: { zealotPieces, maybeSaveHead, PRAYER_XP_BY_NAME, prayerXp, rewardReanimationKill },
};
