const DIARY = "ardougne";
const TASK = "equip-iban-s-upgraded-staff-or-upgrade-an-iban-s";
const UPGRADE_ACTION_ID = "ALBm9G";
const BROKEN_STAFF_UPGRADE_ACTION_ID = "XcNnsJ";
const UPGRADE_COST = 200000;
const BROKEN_STAFF_UPGRADE_COST = 400000;
const QUEST_KEY = "underground_pass";
const DARK_MAGE_PAGE = "Dark Mage";
const POST_QUEST_VARIANT = "standard-dialogue-post-quest-dialogue";
const NO_STAVES_CONDITION_ID = "Se9Rip";
const RECHARGE_STAFF_CONDITION_ID = "XQwCyF";
const UPGRADE_STAFF_CONDITION_ID = "cu2yI4";
const UPGRADE_COST_CONDITION_ID = "sndc6v";
const BROKEN_STAFF_CONDITION_ID = "MEuVEB";
const BROKEN_STAFF_UPGRADE_COST_CONDITION_ID = "e094cD";

function isDarkMage(npcId, core) {
  return npcId === core.NpcIdentifiers.DARK_MAGE_2 || npcId === core.NpcIdentifiers.DARK_MAGE_3;
}

function isActivePlayer(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.();
}

function hasCompletedUndergroundPass(player, registry) {
  const quest = { player, key: QUEST_KEY, complete: false };
  registry.emitCustomEvent("quest:is-complete", quest);
  return quest.complete === true;
}

function selectVariant({ player, npcId }, registry) {
  if (!isDarkMage(npcId, registry.core) || !isActivePlayer(player)) return null;
  return hasCompletedUndergroundPass(player, registry) ? POST_QUEST_VARIANT : null;
}

function hasIbanStaff(inventory) {
  return inventory.getValidItems().some((item) => {
    const name = item.getDefinition()?.getName?.() ?? "";
    return /iban.*staff/i.test(name);
  });
}

function hasRechargeableIbanStaff(inventory, core) {
  return inventory.contains(core.ItemIdentifiers.IBANS_STAFF)
    || inventory.contains(core.ItemIdentifiers.IBANS_STAFF_U_);
}

function conditionAnswer({ player, npcId, pages, stepId }, registry) {
  if (!isDarkMage(npcId, registry.core) || !isActivePlayer(player)
    || !pages?.some((page) => page.page === DARK_MAGE_PAGE)
    || !hasCompletedUndergroundPass(player, registry)) return null;

  const inventory = player.getInventory();
  if (stepId === NO_STAVES_CONDITION_ID) return !hasIbanStaff(inventory);
  if (stepId === RECHARGE_STAFF_CONDITION_ID) return hasRechargeableIbanStaff(inventory, registry.core);
  if (stepId === UPGRADE_STAFF_CONDITION_ID) return inventory.contains(registry.core.ItemIdentifiers.IBANS_STAFF);
  if (stepId === UPGRADE_COST_CONDITION_ID) {
    return inventory.contains(registry.core.ItemIdentifiers.IBANS_STAFF)
      && coinPaymentPlan(inventory, registry.core.ItemIdentifiers.COINS, UPGRADE_COST) !== null;
  }
  if (stepId === BROKEN_STAFF_CONDITION_ID) return inventory.contains(registry.core.ItemIdentifiers.IBANS_STAFF_2);
  if (stepId === BROKEN_STAFF_UPGRADE_COST_CONDITION_ID) {
    return inventory.contains(registry.core.ItemIdentifiers.IBANS_STAFF_2)
      && coinPaymentPlan(inventory, registry.core.ItemIdentifiers.COINS, BROKEN_STAFF_UPGRADE_COST) !== null;
  }
  return null;
}

function coinPaymentPlan(inventory, coinsId, amount) {
  let remaining = amount;
  const items = inventory.getItems();
  const plan = [];
  for (let slot = 0; slot < items.length && remaining > 0; slot++) {
    const held = items[slot];
    if (held?.getId?.() !== coinsId || held.getAmount() <= 0) continue;
    const consumed = Math.min(remaining, held.getAmount());
    plan.push({ slot, amount: consumed });
    remaining -= consumed;
  }
  return remaining === 0 ? plan : null;
}

function performUpgrade(event, registry, { actionId, staffId, cost }) {
  const { player, npcId, stepId } = event ?? {};
  if (event?.handled || !isDarkMage(npcId, registry.core) || stepId !== actionId || !isActivePlayer(player)) return;
  event.handled = true;

  const inventory = player.getInventory();
  if (!hasCompletedUndergroundPass(player, registry)) {
    player.sendMessage("You must complete Underground Pass before the Dark Mage can upgrade your staff.");
    return;
  }
  if (!inventory.contains(staffId)) {
    player.sendMessage(staffId === registry.core.ItemIdentifiers.IBANS_STAFF_2
      ? "You need to have the broken Iban's staff in your inventory."
      : "You need to have Iban's staff in your inventory.");
    return;
  }
  const payment = coinPaymentPlan(inventory, registry.core.ItemIdentifiers.COINS, cost);
  if (!payment) {
    player.sendMessage(`You need ${cost.toLocaleString("en-US")} coins to upgrade Iban's staff.`);
    return;
  }

  inventory.deleted(staffId, 1, false);
  for (const { slot, amount } of payment) {
    inventory.deletedItem(new registry.core.Item(registry.core.ItemIdentifiers.COINS, amount), slot, false);
  }
  inventory.add(new registry.core.Item(registry.core.ItemIdentifiers.IBANS_STAFF_U_), false);
  inventory.refreshItems();
  registry.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
  player.sendMessage("The mage summons the power of Zamorak and upgrades your Staff of Iban.");
}

function upgradeStaff(event, registry) {
  if (event?.stepId === UPGRADE_ACTION_ID) {
    performUpgrade(event, registry, {
      actionId: UPGRADE_ACTION_ID,
      staffId: registry.core.ItemIdentifiers.IBANS_STAFF,
      cost: UPGRADE_COST,
    });
  } else if (event?.stepId === BROKEN_STAFF_UPGRADE_ACTION_ID) {
    performUpgrade(event, registry, {
      actionId: BROKEN_STAFF_UPGRADE_ACTION_ID,
      staffId: registry.core.ItemIdentifiers.IBANS_STAFF_2,
      cost: BROKEN_STAFF_UPGRADE_COST,
    });
  }
}

function equippedUpgradedStaff({ player } = {}, registry) {
  if (!isActivePlayer(player)) return;
  const weapon = player?.getEquipment?.()?.getItems?.()[registry.core.Equipment.WEAPON_SLOT];
  if (weapon?.getId?.() !== registry.core.ItemIdentifiers.IBANS_STAFF_U_) return;
  registry.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function onNpcDialogueVariant(registry, event) {
  return selectVariant(event, registry);
}

function onNpcDialogueCondition(registry, event) {
  return conditionAnswer(event, registry);
}

function onDialogueAction(registry, event) {
  return upgradeStaff(event, registry);
}

function onEquipmentChanged(registry, event) {
  return equippedUpgradedStaff(event, registry);
}

module.exports = {
  name: "ArdougneIbanStaffDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests"],
  register(registry) {
    registry.onNpcDialogueVariant(onNpcDialogueVariant.bind(null, registry));
    registry.onNpcDialogueCondition(onNpcDialogueCondition.bind(null, registry));
    registry.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, registry));
    registry.onCustomEvent("equipment:changed", onEquipmentChanged.bind(null, registry));
  },
  _test: {
    isDarkMage, isActivePlayer, hasCompletedUndergroundPass, selectVariant, hasIbanStaff,
    conditionAnswer, coinPaymentPlan, performUpgrade, upgradeStaff, equippedUpgradedStaff,
    UPGRADE_ACTION_ID, BROKEN_STAFF_UPGRADE_ACTION_ID, TASK, UPGRADE_COST, BROKEN_STAFF_UPGRADE_COST,
    POST_QUEST_VARIANT, NO_STAVES_CONDITION_ID, RECHARGE_STAFF_CONDITION_ID,
    UPGRADE_STAFF_CONDITION_ID, UPGRADE_COST_CONDITION_ID, BROKEN_STAFF_CONDITION_ID,
    BROKEN_STAFF_UPGRADE_COST_CONDITION_ID,
  },
};
