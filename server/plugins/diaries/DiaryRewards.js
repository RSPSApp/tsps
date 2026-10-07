/**
 * Claiming diary rewards from each diary's NPC, as captured with Two-pints: Talk-to while a
 * finished tier is unclaimed plays that tier's claim conversation (from the Wiki transcript,
 * stored in the data file), and the items and the reward varbit come where it says "reward" -
 * right after "Yes please!". With nothing to claim, Talk-to falls through to the NPC's transcript,
 * whose "<NPC> gives you another ..." line hands back a lost reward item.
 */
const QuestRuntime = require("../quests/QuestRuntime");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { TIERS, BY_NPC } = require("./DiaryData");
const Progress = require("./DiaryProgress");

let pluginApi;

function bind(api) {
  pluginApi = api;
}

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

function grant(player, diary, tier) {
  const inventory = player.getInventory();
  for (const id of diary.tiers[tier].rewardItems) inventory.adds(id, 1);
  Progress.claimTier(player, diary, tier);
}

function toSteps(claim, onReward) {
  return claim.map((step) => step.reward ? { exec: onReward }
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
  if (!meetsRequirement(player, data.requirement)) {
    QuestRuntime.startDialogue(pluginApi, player, context, [
      { player: [opening.player] },
      ...data.requirement.refusal.map((line) => ({ npc: [line] })),
    ]);
    return true;
  }
  if (player.getInventory().getFreeSlots() < data.rewardItems.length) {
    player.sendMessage(`You need ${data.rewardItems.length} free inventory spaces to claim your reward.`);
    return true;
  }
  QuestRuntime.startDialogue(pluginApi, player, context, toSteps(data.claim, () => grant(player, diary, tier)));
  return true;
}

function owns(player, itemId) {
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId) ||
    player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.contains?.(itemId));
}

/** "<NPC> gives you another ...": the highest claimed tier's item, when none is owned. */
function reclaim(action) {
  if (action.kind !== "message" || !/gives you (another|some more)/i.test(String(action.text ?? ""))) return;
  const diary = BY_NPC.get(action.definition?.getName?.());
  if (!diary) return;
  const { player } = action;
  const claimed = Progress.claimedTiers(player, diary);
  const items = TIERS.filter((tier) => claimed.has(tier)).map((tier) => diary.tiers[tier].rewardItems[0]);
  action.handled = true;
  if (items.length === 0 || items.some((id) => owns(player, id))) {
    player.sendMessage(`You don't need another ${diary.itemNoun} right now.`);
    return;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getInventory().adds(items.at(-1), 1);
  player.sendMessage(String(action.text));
}

module.exports = { bind, claimableTier, talkTo, reclaim, owns };
