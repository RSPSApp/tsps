"use strict";

const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Wilderness } = require("../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  ATTR_BOT_PVP_PROFILE_ID,
  ATTR_CUSTOM_DEATH_LOOT_DROPPED,
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("./BotRecruitConstants");
const { PvpProfileId } = require("../behaviours/pvp/PvpProfileRegistry");
const LootKeys = require("../../items/LootKeys.plugin");

let World = null;
let ItemOnGroundManager = null;

/** Called once from registerBotEvents.js, before any death-loot event fires. */
function initBotDeathLootCoreAccess(api) {
  World = api.getWorld();
  ItemOnGroundManager = api.getItemOnGroundManager();
}

const PROFILE_LOOT_RULES = Object.freeze({
  [PvpProfileId.NOVICE]: Object.freeze({
    bloodMoney: 75,
  }),
  [PvpProfileId.STANDARD]: Object.freeze({
    bloodMoney: 150,
  }),
  [PvpProfileId.VETERAN]: Object.freeze({
    bloodMoney: 300,
  }),
  [PvpProfileId.ELITE]: Object.freeze({
    bloodMoney: 500,
  }),
});

const deathLootPlans = new WeakMap();

function getProfileLootRules(profileId) {
  return PROFILE_LOOT_RULES[String(profileId ?? "").toLowerCase()] ?? PROFILE_LOOT_RULES.standard;
}

function isRealPlayer(player) {
  return player?.isRegistered?.() === true && player?.isPlayerBot?.() !== true;
}

function isRecruitedBy(victim, player) {
  const ownerUsername = victim?.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
  const username = player?.getUsername?.();
  return typeof ownerUsername === "string" && typeof username === "string" &&
    ownerUsername.toLowerCase() === username.toLowerCase();
}

function isEligibleBotRewardKill(killer, victim) {
  return isRealPlayer(killer) && !isRecruitedBy(victim, killer) &&
    Wilderness.isIn?.(killer) === true && Wilderness.isIn?.(victim) === true;
}

function shouldSuppressDefaultBotDrops(victim) {
  return victim?.isPlayerBot?.() === true;
}

function resolveProfileId(victim, runtime) {
  return (
    victim?.getAttribute?.(ATTR_BOT_PVP_PROFILE_ID) ??
    runtime?.entriesByUsername?.get?.(victim?.getUsername?.())?.state?.pvp?.profileId ??
    PvpProfileId.STANDARD
  );
}

function resolveBloodMoneyRecipient(killer) {
  if (!killer) {
    return null;
  }
  if (isRealPlayer(killer)) {
    return {
      recipient: killer,
      viaBot: null,
    };
  }
  if (killer?.isPlayerBot?.() !== true) {
    return null;
  }

  const ownerUsername = killer.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
  if (!ownerUsername) {
    return null;
  }

  const owner = World.getPlayerByName(ownerUsername);
  if (!isRealPlayer(owner)) {
    return null;
  }

  return {
    recipient: owner,
    viaBot: killer,
  };
}

function rewardBloodMoney(killer, victim, amount) {
  const payout = resolveBloodMoneyRecipient(killer);
  if (!payout?.recipient || amount <= 0) {
    return;
  }

  const recipient = payout.recipient;
  const viaBot = payout.viaBot;
  victim.setAttribute?.(ATTR_CUSTOM_DEATH_LOOT_DROPPED, true);
  if (
    recipient.getInventory?.().contains?.(ItemIdentifiers.BLOOD_MONEY) ||
    (recipient.getInventory?.().getFreeSlots?.() ?? 0) > 0
  ) {
    recipient.getInventory().adds(ItemIdentifiers.BLOOD_MONEY, amount);
  } else {
    ItemOnGroundManager.registerNonGlobals(
      recipient,
      new Item(ItemIdentifiers.BLOOD_MONEY, amount),
      victim.getLocation?.()?.clone?.() ?? victim.getLocation?.()
    );
  }
  if (viaBot) {
    recipient.getPacketSender?.().sendMessage?.(
      `${viaBot.getUsername?.() ?? "Your bot"} has given you ${amount} blood money from his kill.`
    );
    return;
  }
  recipient
    .getPacketSender?.()
    .sendMessage?.(`You've received ${amount} blood money for that kill!`);
}

function getOrCreateDeathLootPlan(victim, killer, runtime) {
  let plan = deathLootPlans.get(victim);
  if (plan) {
    return plan;
  }

  const canRewardKiller = isEligibleBotRewardKill(killer, victim);
  const profileId = resolveProfileId(victim, runtime);
  const rules = getProfileLootRules(profileId);
  if (canRewardKiller) {
    rewardBloodMoney(killer, victim, rules.bloodMoney);
  }

  plan = {
    killer: canRewardKiller ? killer : null,
  };
  deathLootPlans.set(victim, plan);
  return plan;
}

function handleBotDeathItemDrop(event, runtime) {
  const victim = event?.player;
  if (!shouldSuppressDefaultBotDrops(victim)) {
    return;
  }

  const plan = getOrCreateDeathLootPlan(
    victim,
    event?.killer,
    runtime
  );
  const selectedDrop = plan?.killer && event.dropEligible;

  // Use the same skull/protection eligibility for equipped and carried items as players.
  if (selectedDrop && LootKeys.isEligibleKill(event.killer, victim)) {
    return;
  }

  event.handled = true;
  if (!selectedDrop) {
    return;
  }
  victim.setAttribute?.(ATTR_CUSTOM_DEATH_LOOT_DROPPED, true);

  const location = event?.location ?? victim?.getLocation?.()?.clone?.();
  if (!location) {
    return;
  }

  ItemOnGroundManager.registerNonGlobals(
    plan.killer,
    event.item?.clone?.() ?? new Item(event.item.getId(), event.item.getAmount?.() ?? 1),
    location
  );
}

function clearBotDeathLootPlan(victim) {
  if (victim) {
    victim.setAttribute?.(ATTR_CUSTOM_DEATH_LOOT_DROPPED, false);
    deathLootPlans.delete(victim);
  }
}

module.exports = {
  initBotDeathLootCoreAccess,
  clearBotDeathLootPlan,
  handleBotDeathItemDrop,
};
