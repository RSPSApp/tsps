// Void Knights' Reward Options (cache interface 243). Client scripts 2771/2776 draw every row
// from the cache: enum 2285 names the 32 options, enum 2286 their point costs, varp 261 the
// points. Picking a row then Confirm creates a dynamic child of 243:6 whose slot is the option,
// so the server gets that click and grants the reward. Costs, requirements, XP and pack contents
// match https://oldschool.runescape.wiki/w/Void_Knights%27_Reward_Options.

const POINTS_ATTRIBUTE = "pest-control:points";
const XP_LOCKED_ATTRIBUTE = "skills:xp-locked";
const MAX_COMMENDATIONS = 4000;
const REWARD_INTERFACE = 243;
const CONFIRM_UID = (REWARD_INTERFACE << 16) | 6;
const POINTS_VARP = 261;
const OP1_TRANSMIT = 1 << 1;
const SKILL_LEVEL = 25;
const VOID_COMBAT_LEVEL = 42;
const VOID_PRAYER_LEVEL = 22;

let core = null;
let pluginApi = null;

function getPoints(player) {
  const points = Number(player?.getAttribute?.(POINTS_ATTRIBUTE));
  return Number.isFinite(points) ? points : 0;
}

function setPoints(player, points) {
  player.setAttribute(POINTS_ATTRIBUTE, Math.max(0, Math.min(MAX_COMMENDATIONS, Math.trunc(points))));
  player.getPacketSender?.()?.sendConfig?.(POINTS_VARP, getPoints(player));
}

// Option -> reward, in enum 2285's order. Skills are cache stat ids, as script 2776 passes them.
function buildRewards() {
  const I = core.ItemIdentifiers;
  const rewards = [];
  for (const stat of [0, 2, 1, 4, 6, 3, 5]) {
    for (const [points, bonus] of [[1, 1], [10, 1.01], [100, 1.1]]) rewards.push({ stat, points, bonus });
  }
  rewards.push(
    { points: 30, skill: "HERBLORE", pack: () => [
      [I.GRIMY_HARRALANDER, roll(2, 4)], [I.GRIMY_RANARR_WEED, roll(2, 3)], [I.GRIMY_TOADFLAX, roll(1, 4)],
      [I.GRIMY_IRIT_LEAF, roll(2, 4)], [I.GRIMY_AVANTOE, roll(1, 4)], [I.GRIMY_KWUARM, roll(1, 5)],
    ].map(([id, amount]) => [core.ItemDefinition.forId(id).getNoteId(), amount]) },
    { points: 15, skill: "MINING", pack: () => [[I.COAL, 25], [I.IRON_ORE, 18]]
      .map(([id, amount]) => [core.ItemDefinition.forId(id).getNoteId(), amount]) },
    { points: 15, skill: "FARMING", pack: () => [rollSeed(), rollSeed(), rollSeed()] },
  );
  for (const [item, points] of [
    [I.VOID_KNIGHT_MACE, 250], [I.VOID_KNIGHT_TOP, 250], [I.VOID_KNIGHT_ROBE, 250], [I.VOID_KNIGHT_GLOVES, 150],
    [I.VOID_MAGE_HELM, 200], [I.VOID_RANGER_HELM, 200], [I.VOID_MELEE_HELM, 200],
  ]) rewards.push({ points, voidItem: true, pack: () => [[item, 1]] });
  rewards.push({ points: 10, pack: () => [[I.VOID_SEAL_8_, 1]] });
  return rewards;
}

function roll(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Seed pack: three rolls on this table, weights out of 1,061 (doubled for the two 0.5s).
function seedTable() {
  const I = core.ItemIdentifiers;
  return [
    [I.SPIRIT_SEED, 1, 2], [I.MAGIC_SEED, 1, 2], [I.YEW_SEED, 1, 16], [I.MAPLE_SEED, 1, 20],
    [I.WILLOW_SEED, 1, 40], [I.ACORN, 1, 60], [I.RANARR_SEED, 1, 40], [I.SWEETCORN_SEED, 3, 240],
    [I.STRAWBERRY_SEED, 2, 180], [I.LIMPWURT_SEED, 2, 200], [I.WATERMELON_SEED, 2, 180],
    [I.TOMATO_SEED, 6, 220], [I.CABBAGE_SEED, 9, 200], [I.ONION_SEED, 11, 200], [I.POTATO_SEED, 14, 400],
    [I.SNAPE_GRASS_SEED, 2, 120], [I.CELASTRUS_SEED, 1, 1], [I.REDWOOD_TREE_SEED, 1, 1],
  ];
}

function rollSeed() {
  const table = seedTable();
  let pick = Math.random() * table.reduce((sum, [, , weight]) => sum + weight, 0);
  for (const [id, amount, weight] of table) if ((pick -= weight) < 0) return [id, amount];
  return table[table.length - 1].slice(0, 2);
}

// Script 2786: floor(level^2 / 600) x 35 (Attack, Strength, Defence, Hitpoints), x 32 (Ranged,
// Magic), x 18 (Prayer) per point.
function xpPerPoint(stat, level) {
  const factor = stat === 4 || stat === 6 ? 32 : stat === 5 ? 18 : 35;
  return Math.floor((level * level) / 600) * factor;
}

function statSkill(stat) {
  return core.Skill.values().find((skill) => skill.getClientId() === stat);
}

function sendExperienceRewards(player) {
  const experience = Object.fromEntries([0, 2, 1, 4, 6, 3, 5].map((stat) => {
    const skill = statSkill(stat);
    const base = xpPerPoint(stat, player.getSkillManager().getMaxLevel(skill));
    const { multiplier } = core.PluginManager.emitCanGainExperience(player, skill, base);
    const xp = base * core.GameConstants.EXPERIENCE_MULTIPLIER * multiplier;
    return [skill.getName(), Math.floor(xp * 10 + 1e-6) / 10];
  }));
  player.getSession().sendClientPacket(core.encodePluginMessage("pest-control", { xpPerPoint: experience }));
}

function openRewards(player) {
  const sender = player.getPacketSender();
  sendExperienceRewards(player);
  sender.sendConfig(POINTS_VARP, getPoints(player));
  sender.sendInterface(REWARD_INTERFACE);
  sender.sendInterfaceFlagsRange(CONFIRM_UID, 0, 31, OP1_TRANSMIT);
}

// The client only offers Confirm on a reward it lets you claim; these checks repeat its own
// (scripts 2779/2781) with the cache's messages.
function refusal(player, reward) {
  const skills = player.getSkillManager();
  const { Skill } = core;
  if (reward.stat !== undefined) {
    if (player.getAttribute(XP_LOCKED_ATTRIBUTE) === true)
      return "Unlock experience with ::lockxp before claiming an XP reward.";
    if (skills.getMaxLevel(statSkill(reward.stat)) < SKILL_LEVEL)
      return `The Void Knights will not offer training in skills for which you have a level under ${SKILL_LEVEL}.`;
  } else if (reward.skill && skills.getCurrentLevel(Skill[reward.skill]) < SKILL_LEVEL) {
    return `You need level ${SKILL_LEVEL} ${Skill[reward.skill].getName()} to purchase that item.`;
  } else if (reward.voidItem && (skills.getMaxLevel(Skill.PRAYER) < VOID_PRAYER_LEVEL ||
      [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS]
        .some((skill) => skills.getMaxLevel(skill) < VOID_COMBAT_LEVEL))) {
    return "You need level 42 in Attack, Strength, Defence, Ranged, Magic and Hitpoints, and level 22 Prayer, to purchase that item.";
  }
  if (getPoints(player) < reward.points) return `You need ${reward.points} points to claim that reward.`;
  return null;
}

function claimReward(player, option) {
  const reward = buildRewards()[option];
  if (!reward) return false;
  const problem = refusal(player, reward);
  if (problem) {
    player.sendMessage(problem);
    return false;
  }
  if (reward.stat !== undefined) {
    // Exact, as the wiki's tables (353.5 for 10 points at level 25); addExperience keeps the tenths.
    const skill = statSkill(reward.stat);
    const xp = xpPerPoint(reward.stat, player.getSkillManager().getMaxLevel(skill)) * reward.points * reward.bonus;
    setPoints(player, getPoints(player) - reward.points);
    player.getSkillManager().addExperience(skill, xp, true);
    sendExperienceRewards(player);
    return true;
  }
  const items = reward.pack();
  const inventory = player.getInventory();
  const stacks = (id) => core.ItemDefinition.forId(id).isStackable() && inventory.containsNumber(id);
  const newSlots = new Set(items.map(([id]) => id).filter((id) => !stacks(id))).size;
  if (inventory.getFreeSlots() < newSlots) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  setPoints(player, getPoints(player) - reward.points);
  for (const [id, amount] of items) {
    const before = inventory.getAmount(id);
    inventory.adds(id, amount);
    const credited = Math.max(0, inventory.getAmount(id) - before);
    if (credited > 0) pluginApi.emitCustomEvent("collection-log:obtain", { player, itemId: id, amount: credited });
  }
  return true;
}

function confirmReward({ player, slot }) {
  if (player.getInterfaceId?.() !== REWARD_INTERFACE) return;
  claimReward(player, slot);
}

function initRewards(api) {
  pluginApi = api;
  core = api.core;
}

module.exports = {
  POINTS_ATTRIBUTE,
  CONFIRM_UID,
  getPoints,
  setPoints,
  initRewards,
  openRewards,
  confirmReward,
  _test: { claimReward, xpPerPoint, buildRewards, seedTable },
};
