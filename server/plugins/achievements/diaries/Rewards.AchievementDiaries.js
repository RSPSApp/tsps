/**
 * Claiming diary rewards from each diary's NPC, as captured with Two-pints: Talk-to while a
 * finished tier is unclaimed plays that tier's claim conversation (from the Wiki transcript,
 * stored in the data file), and the items and the reward varbit come where it says "reward" -
 * right after "Yes please!". With nothing to claim, Talk-to falls through to the NPC's transcript,
 * whose "<NPC> gives you another ..." line hands back a lost reward item.
 */
const QuestRuntime = require("../../quests/QuestRuntime");
const { TIERS, BY_NPC } = require("./Data.AchievementDiaries");
const Progress = require("./Progress.AchievementDiaries");

const REWARD_NPCS = [...BY_NPC.keys()];

let pluginApi;

/** The tier to claim: the lowest finished, unclaimed one whose lower tiers are all finished. */
function claimableTier(player, diary) {
  const claimed = Progress.claimedTiers(player, diary);
  for (const tier of TIERS) {
    if (!Progress.isTierComplete(player, diary, tier)) return null;
    if (!claimed.has(tier)) return tier;
  }
  return null;
}

function meetsRequirement(player, requirement) {
  if (!requirement) return true;
  const skill = pluginApi.core.Skill.values().find((entry) => entry.getName().toLowerCase() === requirement.skill.toLowerCase());
  return !skill || player.getSkillManager().getCurrentLevel(skill) >= requirement.level;
}

function grant(player, diary, tier, generation) {
  const inventory = player.getInventory();
  const items = diary.tiers[tier].rewardItems;
  if (Progress.tierGeneration(player, diary, tier) !== generation || claimableTier(player, diary) !== tier
    || !meetsRequirement(player, diary.tiers[tier].requirement)
    || inventory.getFreeSlots() < items.length
    || (typeof inventory.getAddableAmount === "function"
      && items.some((id) => inventory.getAddableAmount(new pluginApi.core.Item(id, 1)) < 1))) {
    player.sendMessage(inventory.getFreeSlots() < items.length
      ? `You need ${items.length} free inventory spaces to claim your reward.`
      : "You can no longer claim this reward.");
    return false;
  }
  for (const id of items) inventory.adds(id, 1);
  Progress.claimTier(player, diary, tier);
  return true;
}

function claimedHighestTier(player, diary) {
  const claimed = Progress.claimedTiers(player, diary);
  return [...TIERS].reverse().find((tier) => claimed.has(tier)) ?? null;
}

/** Another copy is handed back only while the player owns none in the inventory, worn or bank. */
function owns(player, itemId) {
  const searchTab = pluginApi?.core?.Bank?.BANK_SEARCH_TAB_INDEX;
  return player.getInventory().contains(itemId)
    || (player.getEquipment?.().contains?.(itemId) ?? false)
    || (player.getBanks?.() ?? []).some((bank, tab) => tab !== searchTab && bank?.contains?.(itemId));
}

function giveAnotherCloak(player, diary) {
  const tier = claimedHighestTier(player, diary);
  if (!tier || owns(player, diary.tiers[tier].rewardItems[0])) {
    player.sendMessage(`You don't need another ${diary.itemNoun} right now.`);
    return false;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.adds(diary.tiers[tier].rewardItems[0], 1);
  return true;
}

function toSteps(claim, onReward) {
  return claim.map((step) => step.reward ? { exec: onReward, stopOnFalse: true }
    : step.npc !== undefined ? { npc: [step.npc] } : { player: [step.player] });
}

function talkTo(event) {
  const { player, definition } = event;
  const diary = BY_NPC.get(definition.getName());
  const tier = diary && claimableTier(player, diary);
  if (!tier) return false;
  const data = diary.tiers[tier];
  const context = { npcId: definition.getId() };
  const opening = data.claim.find((step) => step.player !== undefined);
  const generation = Progress.tierGeneration(player, diary, tier);
  if (!meetsRequirement(player, data.requirement)) {
    QuestRuntime.startDialogue(pluginApi, player, context, [
      { player: [opening.player] },
      ...data.requirement.refusal.map((line) => ({ npc: [line] })),
      { exec: () => QuestRuntime.startTranscript(pluginApi, player, definition.getId(), "Two-pints", "standard-dialogue", (steps) => steps.slice(1)) },
    ]);
    return true;
  }
  if (player.getInventory().getFreeSlots() < data.rewardItems.length) {
    player.sendMessage(`You need ${data.rewardItems.length} free inventory spaces to claim your reward.`);
    return true;
  }
  QuestRuntime.startDialogue(pluginApi, player, context, toSteps(data.claim, () => grant(player, diary, tier, generation)));
  return true;
}

/** "<NPC> gives you another ...": the highest claimed tier's item, when none is owned. */
function reclaim(action) {
  if (action.kind !== "message" || !/gives you (another|some more)/i.test(String(action.text ?? ""))) return;
  const diary = BY_NPC.get(action.definition?.getName?.());
  if (!diary) return;
  const { player } = action;
  action.handled = true;
  if (!giveAnotherCloak(player, diary)) {
    return;
  }
  player.sendMessage(String(action.text));
}

module.exports = function attachRewards(api) {
  pluginApi = api;
  api.onNpcsInteraction(REWARD_NPCS, { "Talk-to": talkTo });
  api.onCustomEvent("npc-dialogue:action", reclaim);
};

Object.assign(module.exports, { claimableTier, talkTo, reclaim, owns });
