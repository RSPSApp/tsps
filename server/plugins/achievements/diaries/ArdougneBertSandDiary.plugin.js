const DIARY = "ardougne";
const TASK = "claim-buckets-of-sand-from-bert-in-yanille";
const QUEST_STAGE_ATTRIBUTE = "quest.hand_in_the_sand.stage";
const INTRO_SEEN_ATTRIBUTE = "ardougne-bert-sand:intro-seen";
const LAST_DELIVERY_ATTRIBUTE = "ardougne-bert-sand:last-delivery";
const QUEST_COMPLETE_STAGE = 160;
const SAND_AMOUNT = 84;
const BANK_SPACE_CONDITION_ID = "C_Ed6h";
const INTRO_MESSAGE_ID = "Z7jI9d";
const INTRO_VARIANT = "after-the-hand-in-the-sand";
const DAILY_VARIANT = "subsequent-times-following-completion-of-the-hand-in-the-sand";

function isComplete(player) {
  return Number(player?.getAttribute?.(QUEST_STAGE_ATTRIBUTE)) >= QUEST_COMPLETE_STAGE;
}

function isUltimateIronman(api, player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode === "ultimate" || player.getAttribute?.("ironman:mode") === "ultimate";
}

function bankTabs(api, player) {
  const excluded = api.core.Bank.BANK_SEARCH_TAB_INDEX;
  return (player.getBanks?.() ?? []).filter((bank, tab) => bank && tab !== excluded);
}

function deliveryBank(api, player) {
  const item = new api.core.Item(api.core.ItemIdentifiers.BUCKET_OF_SAND, SAND_AMOUNT);
  const banks = bankTabs(api, player);
  return banks.find((bank) => bank.getAddableAmount?.(item) >= SAND_AMOUNT) ?? null;
}

function hasDeliverySpace(api, player) {
  return !isUltimateIronman(api, player) && deliveryBank(api, player) !== null;
}

function today(now = () => new Date()) {
  return now().toISOString().slice(0, 10);
}

function selectVariant({ player, npcId }, api) {
  if (npcId !== api.core.NpcIdentifiers.BERT && npcId !== api.core.NpcIdentifiers.BERT_2) return null;
  if (!isComplete(player)) return null;
  return player.getAttribute(INTRO_SEEN_ATTRIBUTE) === true ? DAILY_VARIANT : INTRO_VARIANT;
}

function onDialogueVariant(api, event) {
  return selectVariant(event, api);
}

function onDialogueCondition(api, now, { player, text }) {
  if (!isComplete(player) || typeof text !== "string") return null;
  if (text.includes("no space for the sand in their bank, or is an Ultimate Ironman")) {
    return !hasDeliverySpace(api, player);
  }
  if (text.includes("space for the sand in their bank")) return hasDeliverySpace(api, player);
  if (text.includes("already claimed their sand for the day")) {
    return player.getAttribute(LAST_DELIVERY_ATTRIBUTE) === today(now);
  }
  return null;
}

function onDialogueConditionEvent(api, now, { player, npcId, stepId }) {
  if (!player || (npcId !== api.core.NpcIdentifiers.BERT && npcId !== api.core.NpcIdentifiers.BERT_2)) return;
  if (!isComplete(player) || stepId !== BANK_SPACE_CONDITION_ID) return;
  payClaim(api, player, now);
}

function onDialogueAction(event) {
  const { player, stepId } = event;
  if (!player || !isComplete(player)) return;
  if (stepId === INTRO_MESSAGE_ID) player.setAttribute(INTRO_SEEN_ATTRIBUTE, true);
}

function onItemOnObject(api, event) {
  fillUimSandPit(api, event);
}

function sandOption(api, now, { player, npcId }) {
  if (npcId !== api.core.NpcIdentifiers.BERT_2 || !isComplete(player)) return false;
  if (payClaim(api, player, now)) {
    player.sendMessage("Bert delivers the sand to your bank.");
  } else if (player.getAttribute(LAST_DELIVERY_ATTRIBUTE) === today(now)) {
    player.sendMessage("Bert has already delivered your sand today.");
  } else if (isUltimateIronman(api, player)) {
    player.sendMessage("As an Ultimate Ironman, use a bucket on Bert's sandpit.");
  } else if (!hasDeliverySpace(api, player)) {
    player.sendMessage("Your bank has no room for the sand.");
  }
  return true;
}

function register(api, options = {}) {
  api.persistAttribute(INTRO_SEEN_ATTRIBUTE, false);
  api.persistAttribute(LAST_DELIVERY_ATTRIBUTE);

  api.onNpcDialogueVariant(onDialogueVariant.bind(null, api));
  api.onNpcDialogueCondition(onDialogueCondition.bind(null, api, options.now));
  api.onCustomEvent("npc-dialogue:condition", onDialogueConditionEvent.bind(null, api, options.now));
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onItemOnObject(onItemOnObject.bind(null, api), { noted: false });
  api.onNpcInteraction("Bert", { Sand: sandOption.bind(null, api, options.now) });
}

function fillUimSandPit(api, event) {
  const { ItemIdentifiers, ObjectIdentifiers } = api.core;
  if (!event?.player || event.objectId !== ObjectIdentifiers.SANDPIT ||
      event.itemId !== ItemIdentifiers.BUCKET || !isUltimateIronman(api, event.player)) return false;
  const { x, y, z } = event.location ?? {};
  if (x !== 2542 || y !== 3103 || z !== 0) return false;

  const inventory = event.player.getInventory();
  const held = inventory.getItems?.()[event.itemSlot];
  if (held?.getId?.() !== ItemIdentifiers.BUCKET) return false;

  const sandBefore = inventory.getAmount(ItemIdentifiers.BUCKET_OF_SAND);
  inventory.deleteNumber(ItemIdentifiers.BUCKET, 1);
  inventory.add(new api.core.Item(ItemIdentifiers.BUCKET_OF_SAND, 1), true);
  const converted = inventory.getAmount(ItemIdentifiers.BUCKET_OF_SAND) - sandBefore;
  if (converted !== 1) {
    if (converted > 0) inventory.deleteNumber(ItemIdentifiers.BUCKET_OF_SAND, converted);
    inventory.add(new api.core.Item(ItemIdentifiers.BUCKET, 1), true);
    return false;
  }

  event.handled = true;
  api.emitCustomEvent("diary:task", { player: event.player, diary: DIARY, task: TASK });
  return true;
}

function payClaim(api, player, now) {
  const day = today(now);
  if (player.getAttribute(LAST_DELIVERY_ATTRIBUTE) === day || !hasDeliverySpace(api, player)) return false;
  const bank = deliveryBank(api, player);
  if (!bank) return false;

  const sandItemId = api.core.ItemIdentifiers.BUCKET_OF_SAND;
  const before = bank.getAmount(sandItemId);
  const item = new api.core.Item(sandItemId, SAND_AMOUNT);
  if (bank.getAddableAmount(item) < SAND_AMOUNT) return false;
  const previousDate = player.getAttribute(LAST_DELIVERY_ATTRIBUTE);
  // Claim before bank mutation so a reentrant transcript callback cannot duplicate the deposit.
  player.setAttribute(LAST_DELIVERY_ATTRIBUTE, day);
  let added;
  try {
    bank.add(item, true);
    added = bank.getAmount(sandItemId) - before;
  } catch (error) {
    const partial = bank.getAmount(sandItemId) - before;
    if (partial > 0) bank.deleteNumber(sandItemId, partial);
    player.setAttribute(LAST_DELIVERY_ATTRIBUTE, previousDate);
    throw error;
  }
  if (added !== SAND_AMOUNT) {
    if (added > 0) {
      bank.deleteNumber(sandItemId, added);
      bank.refreshItems?.();
    }
    player.setAttribute(LAST_DELIVERY_ATTRIBUTE, previousDate);
    return false;
  }

  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
  return true;
}

module.exports = {
  name: "ArdougneBertSandDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests"],
  register,
  _test: { isComplete, isUltimateIronman, bankTabs, deliveryBank, hasDeliverySpace, selectVariant, today, payClaim, fillUimSandPit,
    QUEST_STAGE_ATTRIBUTE, INTRO_SEEN_ATTRIBUTE, LAST_DELIVERY_ATTRIBUTE, BANK_SPACE_CONDITION_ID,
    SAND_AMOUNT,
    INTRO_MESSAGE_ID, INTRO_VARIANT, DAILY_VARIANT },
};
