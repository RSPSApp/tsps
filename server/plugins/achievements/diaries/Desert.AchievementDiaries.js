/**
 * Desert Diary gameplay actions that the skill, combat and Pyramid Plunder plugins report through
 * their own success events. Credit is given only for the action the task names, with its location,
 * item, NPC and equipment requirements (OSRS Wiki: Desert Diary).
 *
 * The remaining Desert tasks are credited where their action lives: the Shantay Pass gate, magic
 * carpets, both agility courses, fletching at the Bedabin Camp, the Kalphite Lair rope, the
 * Spirits of the Elid statuette and genie, The Golem's desert phoenix, and the pollnivneach
 * redirected house tablet.
 */
const TASKS = Object.freeze({
  goldenWarbler: "catch-a-golden-warbler",
  clay: "mine-5-clay-in-the-north-eastern-desert",
  vulture: "kill-a-vulture",
  potatoCactus: "collect-5-potato-cactus-from-the-kalphite-hive",
  simonArtefacts: "sell-some-artefacts-to-simon-templeton",
  sarcophagus: "open-the-sarcophagus-in-the-first-room-of-pyrami",
  desertLizard: "slay-a-desert-lizard",
  orangeSalamander: "catch-an-orange-salamander",
  combatPotion: "create-a-combat-potion-in-the-desert",
  teak: "chop-some-teak-logs-near-uzer",
  menaphiteThug: "knock-out-and-pickpocket-a-menaphite-thug",
  granite: "mine-some-granite",
  kalphiteQueen: "kill-the-kalphite-queen",
  dustDevil: "slay-a-dust-devil-in-the-desert-cave-with-a-slay",
  locustRider: "defeat-a-locust-rider-with-keris",
  yewBalcony: "burn-some-yew-logs-on-the-nardah-mayor-s-balcony",
  mithrilPlatebody: "create-a-mithril-platebody-in-nardah",
  wildPie: "bake-a-wild-pie-at-the-nardah-clay-oven",
  grandGoldChest: "steal-from-the-grand-gold-chest-in-the-final-roo",
  sophanemAltar: "restore-at-least-85-prayer-points-when-praying-a",
});
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get("desert");

/** The Kharidian Desert's map, outside Al Kharid (plugins/areas/data/desert-heat.json). */
const DESERT = [3136, 3519, 2688, 3115];
const NARDAH = [3398, 3452, 2875, 2942];
/** The Uzer mine's clay rocks (3400-3423, 3153-3167), the north-eastern desert. */
const UZER_CLAY_MINE = [3390, 3430, 3145, 3175];
/** The teak grove north-east of the Uzer oasis. */
const UZER_TEAK_GROVE = [3495, 3530, 3055, 3090];
/** The Smoke Dungeon's dust devils (3179-3261, 9347-9402). */
const SMOKE_DUNGEON = [3170, 3270, 9340, 9410];
/** The Sophanem dungeon's locust riders (3270-3430, 9220-9271). */
const SOPHANEM_DUNGEON = [3260, 3440, 9210, 9280];
/** The Kalphite Lair's potato cactus ground spawns (3172-3198, 9411-9484). */
const KALPHITE_LAIR = [3150, 3260, 9400, 9520];
/** The Nardah Mayor's upper-floor balcony, east of the central fountain (Awusah at 3442,2912). */
const NARDAH_MAYOR_BALCONY = [3434, 3452, 2898, 2920];

const CLAY_ATTRIBUTE = "achievement-diaries:desert-clay-mined";
const POTATO_CACTUS_ATTRIBUTE = "achievement-diaries:desert-potato-cactus";
const THUG_KNOCKED_ATTRIBUTE = "achievement-diaries:desert-thug-knocked-out";
const CLAY_TARGET = 5;
const POTATO_CACTUS_TARGET = 5;
const CLAY_ITEM_ID = 434;
const POTATO_CACTUS_ITEM_ID = 3138;
const GRANITE_ITEM_IDS = [6979, 6981, 6983];
const TEAK_LOGS_ID = 6333;
const YEW_LOGS_ID = 1515;
const MITHRIL_PLATEBODY_ID = 1121;
const WILD_PIE_ID = 7208;
const COMBAT_POTION_ID = 9741;
const CLAY_OVEN_ID = 10377;
const SOPHANEM_ALTAR = [3278, 3285, 2770, 2778];
const MENAPHITE_THUG_IDS = [3549, 3550];

let api;
let core;

function inside(location, [minX, maxX, minY, maxY], z) {
  const x = typeof location.getX === "function" ? location.getX() : location.x;
  const y = typeof location.getY === "function" ? location.getY() : location.y;
  const plane = typeof location.getZ === "function" ? location.getZ() : location.z;
  return (z === undefined || plane === z) && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function emit(player, task) {
  api.emitCustomEvent("diary:task", { player, diary: "desert", task });
}

function counter(player, attribute, task, target) {
  const value = (Number(player.getAttribute(attribute)) || 0) + 1;
  if (value < target) {
    player.setAttribute(attribute, value);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, task);
    return;
  }
  player.setAttribute(attribute, 0);
  emit(player, task);
}

function hunterSuccess({ player, npcId }) {
  if (npcId === core.NpcIdentifiers.GOLDEN_WARBLER) emit(player, TASKS.goldenWarbler);
  else if (npcId === core.NpcIdentifiers.ORANGE_SALAMANDER) emit(player, TASKS.orangeSalamander);
}

function mined({ player, itemId }) {
  const at = player.getLocation();
  if (itemId === CLAY_ITEM_ID && inside(at, UZER_CLAY_MINE)) counter(player, CLAY_ATTRIBUTE, TASKS.clay, CLAY_TARGET);
  else if (GRANITE_ITEM_IDS.includes(itemId)) emit(player, TASKS.granite);
}

function chopped({ player, logId }) {
  if (logId === TEAK_LOGS_ID && inside(player.getLocation(), UZER_TEAK_GROVE)) emit(player, TASKS.teak);
}

function burned({ player, itemId }) {
  if (itemId === YEW_LOGS_ID && inside(player.getLocation(), NARDAH_MAYOR_BALCONY, 1)) emit(player, TASKS.yewBalcony);
}

function smithed({ player, itemId }) {
  if (itemId === MITHRIL_PLATEBODY_ID && inside(player.getLocation(), NARDAH)) emit(player, TASKS.mithrilPlatebody);
}

function cooked({ player, itemId, objectId }) {
  if (itemId === WILD_PIE_ID && objectId === CLAY_OVEN_ID && inside(player.getLocation(), NARDAH)) emit(player, TASKS.wildPie);
}

function mixed({ player, itemId }) {
  if (itemId === COMBAT_POTION_ID && inside(player.getLocation(), DESERT)) emit(player, TASKS.combatPotion);
}

function wornName(player, slot) {
  const id = player.getEquipment().get(slot)?.getId?.() ?? -1;
  return String(core.ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase();
}

function knifeBlocked(player) {
  return wornName(player, core.Equipment.HEAD_SLOT).includes("slayer helmet");
}

function kerisEquipped(player) {
  return wornName(player, core.Equipment.WEAPON_SLOT).startsWith("keris");
}

function npcName(npc, player) {
  return npc.getCurrentDefinition?.(player)?.getName?.() ?? npc.getDefinition?.()?.getName?.() ?? "";
}

function npcDeath({ killer, npc }) {
  if (!killer?.isPlayer?.() || npc.getPrivateArea?.() !== null) return;
  const at = npc.getLocation();
  const name = npcName(npc, killer);
  if (name === "Vulture") emit(killer, TASKS.vulture);
  else if (name === "Desert lizard") emit(killer, TASKS.desertLizard);
  else if (name === "Kalphite Queen") emit(killer, TASKS.kalphiteQueen);
  else if (name === "Dust devil" && inside(at, SMOKE_DUNGEON) && knifeBlocked(killer)) emit(killer, TASKS.dustDevil);
  else if (name === "Locust rider" && inside(at, SOPHANEM_DUNGEON) && kerisEquipped(killer)) emit(killer, TASKS.locustRider);
}

function thieved({ player, method, target }) {
  if (method !== "pickpocket" || target !== "Menaphite Thug" || !player.getAttribute(THUG_KNOCKED_ATTRIBUTE)) return;
  player.setAttribute(THUG_KNOCKED_ATTRIBUTE, false);
  emit(player, TASKS.menaphiteThug);
}

function knockedOut({ player, npcId }) {
  if (MENAPHITE_THUG_IDS.includes(npcId) && player.getAttribute(THUG_KNOCKED_ATTRIBUTE) !== true) {
    player.setAttribute(THUG_KNOCKED_ATTRIBUTE, true);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.menaphiteThug);
  }
}

function chestSearched({ player, room }) {
  if (room === 8) emit(player, TASKS.grandGoldChest);
}

function artefactsSold({ player }) {
  emit(player, TASKS.simonArtefacts);
}

function sarcophagusOpened({ player, room }) {
  if (room === 1) emit(player, TASKS.sarcophagus);
}

function groundItemTaken({ player, groundItem, itemId, amount }) {
  if (itemId !== POTATO_CACTUS_ITEM_ID || !groundItem?.position || !inside(groundItem.position, KALPHITE_LAIR)) return;
  for (let picked = 0; picked < amount; picked++) counter(player, POTATO_CACTUS_ATTRIBUTE, TASKS.potatoCactus, POTATO_CACTUS_TARGET);
}

/** The Sophanem altar's prayer gain, credited by the Altars plugin. */
function sophanemPrayer({ player, location, restored }) {
  if (restored >= 85 && inside(location, SOPHANEM_ALTAR)) emit(player, TASKS.sophanemAltar);
}

module.exports = function attachDesertDiary(registry) {
  api = registry;
  core = registry.core;
  api.persistAttribute(CLAY_ATTRIBUTE, 0);
  api.persistAttribute(POTATO_CACTUS_ATTRIBUTE, 0);
  api.persistAttribute(THUG_KNOCKED_ATTRIBUTE, false);
  api.onCustomEvent("hunter:success", hunterSuccess);
  api.onCustomEvent("mining:success", mined);
  api.onCustomEvent("woodcutting:success", chopped);
  api.onCustomEvent("firemaking:success", burned);
  api.onCustomEvent("smithing:success", smithed);
  api.onCustomEvent("cooking:success", cooked);
  api.onCustomEvent("herblore:made", mixed);
  api.onCustomEvent("thieving:success", thieved);
  api.onCustomEvent("thieving:blackjack-knockout", knockedOut);
  api.onCustomEvent("pyramid-plunder:chest-searched", chestSearched);
  api.onCustomEvent("pyramid-plunder:sarcophagus-opened", sarcophagusOpened);
  api.onCustomEvent("pyramid-plunder:artefacts-sold", artefactsSold);
  api.onCustomEvent("ground-items:taken", groundItemTaken);
  api.onCustomEvent("altars:prayed", sophanemPrayer);
  api.onNpcDeath(npcDeath);
};

Object.assign(module.exports, { TASKS, _test: { inside, mined, chopped, burned, smithed, cooked, mixed, npcDeath, thieved, knockedOut, chestSearched, sarcophagusOpened, artefactsSold, groundItemTaken, sophanemPrayer, CLAY_ATTRIBUTE, POTATO_CACTUS_ATTRIBUTE, THUG_KNOCKED_ATTRIBUTE } });
