const { DIARIES, TIERS } = require("../../diaries/DiaryData");
const QuestRuntime = require("../QuestRuntime");

// Cache DB table 0 is `quest`; its columns identify the title, main quest type, point reward,
// subquest parent and storyline parent. Child chapters remain covered by their parent quest.
const QUEST_TABLE_ID = 0;
const QUEST_NAME_COLUMN = 1;
const QUEST_TYPE_COLUMN = 4;
const QUEST_POINTS_COLUMN = 17;
const HAS_SUBQUESTS_COLUMN = 22;
const PRICE = 99000;
const GATE_LOCATION = { x: 2727, y: 3349, z: 0 };

let pluginApi;
let Items;
let requiredQuestNames;

function isCape(itemId) {
  return itemId === Items.QUEST_POINT_CAPE || itemId === Items.QUEST_POINT_CAPE_T_;
}

function canonicalQuestName(name) {
  const normalized = String(name)
    .trim()
    .replace(/,\s*(?:the|a|an)$/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized === "perliousmoons" ? "perilousmoons" : normalized;
}

function getRequiredQuestNames() {
  if (requiredQuestNames) return requiredQuestNames;
  let rows;
  try {
    rows = pluginApi.core.CacheDefinitions.getDbTableRows(QUEST_TABLE_ID);
  } catch {
    return null;
  }
  const names = rows
    .filter((row) => row.int(QUEST_TYPE_COLUMN) === 0 && row.column(21).length === 0 &&
      (row.int(QUEST_POINTS_COLUMN) > 0 || row.int(HAS_SUBQUESTS_COLUMN) === 1))
    .map((row) => row.string(QUEST_NAME_COLUMN))
    .filter((name) => name && name !== ".");
  const keys = names.map(canonicalQuestName);
  if (!names.length || new Set(keys).size !== keys.length) return null;
  requiredQuestNames = names;
  return requiredQuestNames;
}

function allQuestsComplete(player) {
  const required = getRequiredQuestNames();
  if (!required) return false;
  const registered = QuestRuntime.getRegisteredQuests();
  const byCanonicalName = new Map();
  for (const quest of registered) {
    const name = canonicalQuestName(quest.name);
    if (!name || byCanonicalName.has(name)) return false;
    byCanonicalName.set(name, quest);
  }
  if (byCanonicalName.size !== required.length) return false;
  for (const name of required) {
    const quest = byCanonicalName.get(canonicalQuestName(name));
    if (!quest) return false;
    const request = { player, key: quest.key, complete: false };
    pluginApi.emitCustomEvent("quest:is-complete", request);
    if (request.complete !== true) return false;
  }
  return true;
}

function answerCapeRequirement(request) {
  if (request?.player) request.canUse = allQuestsComplete(request.player);
}

function allDiariesComplete(player) {
  return DIARIES.every((diary) => TIERS.every((tier) => {
    const request = { player, diary: diary.key, tier, complete: false };
    pluginApi.emitCustomEvent("diary:is-complete", request);
    return request.complete === true;
  }));
}

function showCapePurchase({ player }) {
  if (!allQuestsComplete(player)) return false;
  player.sendMessage("The Quest point cape and hood cost 99,000 coins.");
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Would you like to buy a Quest point cape and hood for 99,000 coins?",
    "Yes, please.", buyCape,
    "No, thanks.", cancelPurchase,
  );
  return true;
}

function cancelPurchase(player) {
  player.sendMessage("Perhaps another time.");
}

function buyCape(player) {
  if (!allQuestsComplete(player)) {
    player.sendMessage("You need to complete every quest before I can sell you a Quest point cape.");
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(Items.COINS) < PRICE) {
    player.sendMessage("You need 99,000 coins to buy a Quest point cape and hood.");
    return;
  }
  const freedCoinSlot = inventory.getAmount(Items.COINS) === PRICE ? 1 : 0;
  if (inventory.getFreeSlots() + freedCoinSlot < 2) {
    player.sendMessage("You need two free inventory spaces to buy the cape and hood.");
    return;
  }
  inventory.deleteNumber(Items.COINS, PRICE);
  inventory.adds(Items.QUEST_POINT_CAPE, 1);
  inventory.adds(Items.QUEST_POINT_HOOD, 1);
  inventory.refreshItems();
  player.sendMessage("The Wise Old Man sells you a Quest point cape and hood for 99,000 coins.");
}

function trimCape({ player, item, itemId }) {
  if (itemId !== Items.QUEST_POINT_CAPE) return;
  // The wiki permits this diary-earned toggle even when a later quest blocks wearing the cape.
  if (!allDiariesComplete(player)) {
    player.sendMessage("You need to complete every Achievement Diary before trimming your Quest point cape.");
    return;
  }
  item.setId(itemId === Items.QUEST_POINT_CAPE ? Items.QUEST_POINT_CAPE_T_ : Items.QUEST_POINT_CAPE);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function untrimCape({ player, item, itemId }) {
  if (itemId !== Items.QUEST_POINT_CAPE_T_) return;
  if (!allDiariesComplete(player)) {
    player.sendMessage("You need to complete every Achievement Diary before untrimming your Quest point cape.");
    return;
  }
  item.setId(Items.QUEST_POINT_CAPE);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function teleport({ player, itemId }) {
  if (!isCape(itemId)) return;
  if (!allQuestsComplete(player)) {
    player.sendMessage("You need to complete every quest before using your Quest point cape.");
    return;
  }
  const { Location, TeleportHandler, TeleportType } = pluginApi.core;
  const destination = new Location(GATE_LOCATION.x, GATE_LOCATION.y, GATE_LOCATION.z);
  if (TeleportHandler.checkReqs(player, destination)) {
    TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false);
  }
}

function canEquip(event) {
  const { player, item } = event;
  if (!isCape(item?.getId?.()) || allQuestsComplete(player)) return;
  event.allow = false;
  player.sendMessage("You need to complete every quest before you can wear your Quest point cape.");
}

function removeInvalidCape({ player }) {
  const { Equipment, EquipPacketListener } = pluginApi.core;
  const equipment = player.getEquipment();
  const cape = equipment.getItems()[Equipment.CAPE_SLOT];
  if (!cape || !isCape(cape.getId()) || allQuestsComplete(player)) return;
  if (EquipPacketListener.unequip(player, Equipment.CAPE_SLOT)) return;
  const isUltimateIronman = player.getAttribute?.("ironman:mode") === "ultimate";
  const bank = isUltimateIronman ? undefined : player.getBanks().find((tab) => tab?.getFreeSlots() > 0);
  if (bank) {
    bank.add(cape, true);
    equipment.set(Equipment.CAPE_SLOT, Equipment.NO_ITEM);
    bank.refreshItems();
    equipment.refreshItems();
    pluginApi.getBonusManager().update(player);
    player.getUpdateFlag().flag(pluginApi.core.Flag.APPEARANCE);
    return;
  }
  // If inventory and bank have no room (or this is an ultimate ironman), OSRS
  // destroys the cape rather than leaving it equipped without its requirement.
  equipment.set(Equipment.CAPE_SLOT, Equipment.NO_ITEM);
  equipment.refreshItems();
  pluginApi.getBonusManager().update(player);
  player.getUpdateFlag().flag(pluginApi.core.Flag.APPEARANCE);
}

function onQuestCompleted({ player }) {
  if (player && allQuestsComplete(player)) {
    player.sendMessage("You have completed every quest. Speak to the Wise Old Man to claim your Quest point cape.");
  }
}

module.exports = function attachQuestCape(api) {
  pluginApi = api;
  Items = api.core.ItemIdentifiers;
  api.onNpcInteraction("Wise Old Man", { "Talk-to": showCapePurchase });
  api.onItemAction("Quest point cape", { Trim: trimCape, Teleport: teleport });
  api.onItemAction("Quest point cape (t)", { Untrim: untrimCape, Teleport: teleport });
  api.onCanEquip(canEquip);
  api.onPlayerLogin(removeInvalidCape);
  api.onCustomEvent("quest:completed", onQuestCompleted);
  api.onCustomEvent("quest-cape:can-use", answerCapeRequirement);
};

module.exports._test = { allQuestsComplete, allDiariesComplete, answerCapeRequirement, canEquip, buyCape, trimCape, untrimCape, teleport, removeInvalidCape, canonicalQuestName };
