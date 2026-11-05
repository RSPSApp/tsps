/**
 * Kandarin Diary gameplay credit (https://oldschool.runescape.wiki/w/Kandarin_Diary): the
 * tasks whose underlying action this server already performs, credited only on the action's
 * own success event and only in the place the Wiki names.
 *
 * The Maple shortbow (Seers' Village bank) credit is data-driven through
 * plugins/skills/data/fletching.json, as the other fletching diary tasks are.
 */

const DIARY = "kandarin";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

const CATHERBY_FISHING = { minX: 2820, maxX: 2870, minY: 3410, maxY: 3445, z: 0 };
const OTTO_GROTTO = { minX: 2480, maxX: 2530, minY: 3460, maxY: 3520, z: 0 };
const SEERS_ORGAN = { minX: 2689, maxX: 2695, minY: 3459, maxY: 3463, z: 0 };
const WATERFALL_DUNGEON = { minX: 2540, maxX: 2600, minY: 9860, maxY: 9910, z: 0 };
const SHADOW_DUNGEON = { minX: 2680, maxX: 2760, minY: 5040, maxY: 5120, z: 0 };
const SEERS_FLAX_FIELD = { minX: 2734, maxX: 2753, minY: 3435, maxY: 3455, z: 0 };
const COAL_TRUCKS = { minX: 2568, maxX: 2618, minY: 3468, maxY: 3512, z: 0 };
const JUTE_PATCH = { minX: 2664, maxX: 2669, minY: 3523, maxY: 3528, z: 0 };
const CATHERBY_FLOWER_PATCH = { minX: 2809, maxX: 2809, minY: 3463, maxY: 3463, z: 0 };
const CATHERBY_HERB_PATCH = { minX: 2813, maxX: 2813, minY: 3463, maxY: 3463, z: 0 };
const WORKSHOP = { minX: 2680, maxX: 2745, minY: 9860, maxY: 9920, z: 0 };

const SHERLOCK = "Sherlock";
const ELEMENTALS = new Map([
  ["Earth elemental", 1], ["Water elemental", 2], ["Air elemental", 4], ["Fire elemental", 8],
]);
const ALL_ELEMENTALS = 15;
const ELEMENTALS_ATTRIBUTE = "kandarin-diary:workshop-elementals";
const FLAX_ATTRIBUTE = "kandarin-diary:flax-picked";

let api;

function inBox(location, box) {
  return location
    && location.getX() >= box.minX && location.getX() <= box.maxX
    && location.getY() >= box.minY && location.getY() <= box.maxY
    && location.getZ() === box.z;
}

function credit(player, task) {
  if (player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function fishingSuccess({ player, itemId }) {
  if (player.getPrivateArea?.() != null) return;
  const at = player.getLocation();
  if (itemId === api.core.ItemIds.RAW_MACKEREL && inBox(at, CATHERBY_FISHING)) {
    credit(player, "catch-a-mackerel-at-catherby");
  } else if (itemId === api.core.ItemIds.LEAPING_STURGEON && inBox(at, OTTO_GROTTO)) {
    credit(player, "catch-a-leaping-sturgeon");
  }
}

function farmingPlanted({ player, crop, patch }) {
  if (crop === "JUTE" && inBox(patch, JUTE_PATCH)) {
    credit(player, "plant-some-jute-seeds-in-the-patch-north-of-mcgr");
  }
}

function farmingHarvested({ player, crop, patch }) {
  if (crop === "LIMPWURT" && inBox(patch, CATHERBY_FLOWER_PATCH)) {
    credit(player, "pick-some-limpwurt-root-from-the-farming-patch-i");
  } else if (crop === "DWARF_WEED" && inBox(patch, CATHERBY_HERB_PATCH)) {
    credit(player, "pick-some-dwarf-weed-from-the-herb-patch-at-cath");
  }
}

function miningSuccess({ player, itemId }) {
  if (itemId !== api.core.ItemIds.COAL || player.getPrivateArea?.() != null || !inBox(player.getLocation(), COAL_TRUCKS)) return;
  credit(player, "mine-some-coal-near-the-coal-trucks");
}

function smithingSuccess({ player, itemId }) {
  if (player.getPrivateArea?.() != null || !inBox(player.getLocation(), OTTO_GROTTO)) return;
  if (itemId === api.core.ItemIds.ADAMANT_SPEAR) credit(player, "smith-an-adamant-spear-at-otto-s-grotto");
  else if (itemId === api.core.ItemIds.RUNE_HASTA) credit(player, "smith-a-rune-hasta-at-otto-s-grotto");
}

function craftingMade({ player, itemId }) {
  if (itemId === api.core.ItemIds.WATER_ORB) credit(player, "charge-a-water-orb");
}

function picked({ player, itemId, plant }) {
  if (itemId !== api.core.ItemIds.FLAX || plant !== "Flax" || player.getPrivateArea?.() != null
    || !inBox(player.getLocation(), SEERS_FLAX_FIELD)) return;
  const previous = Number(player.getAttribute(FLAX_ATTRIBUTE)) | 0;
  const picked = Math.min(5, previous + 1);
  player.setAttribute(FLAX_ATTRIBUTE, picked);
  if (picked === 5) credit(player, "collect-five-flax-from-the-seers-flax-fields");
  else if (picked > previous) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "collect-five-flax-from-the-seers-flax-fields");
}

function barbarianAssaultWave({ player }) {
  credit(player, "complete-a-wave-of-barbarian-assault");
}

function agilityObstacle({ player, shortcut }) {
  if (shortcut === "Log balance (Coal Trucks)") credit(player, "cross-the-coal-truck-log-shortcut");
}

function fairyRingTravelled({ player, code }) {
  if (code === "ALS") credit(player, "travel-to-mcgrubor-s-wood-by-fairy-ring");
}

function teleportArrival({ player, name }) {
  if (player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.()) return;
  const spell = name?.trim().toLowerCase();
  if (spell === "camelot teleport") credit(player, "teleport-to-camelot");
  else if (spell === "catherby teleport" || spell === "tele group catherby") credit(player, "teleport-to-catherby");
}

function npcDeath({ killer, npc }) {
  if (!killer?.isPlayer?.() || killer.getPrivateArea?.() != null || npc.getPrivateArea?.() != null) return;
  const name = npc.getCurrentDefinition(killer)?.getName();
  const at = npc.getLocation();
  if (name === "Fire giant" && inBox(at, WATERFALL_DUNGEON)) {
    credit(killer, "kill-a-fire-giant-inside-baxtorian-waterfall");
  } else if (name === "Shadow Hound" && inBox(at, SHADOW_DUNGEON)) {
    credit(killer, "kill-a-shadow-hound-in-the-shadow-dungeon");
  } else if (name === "Mithril dragon") {
    credit(killer, "kill-a-mithril-dragon");
  } else if (inBox(at, WORKSHOP) && ELEMENTALS.has(name)) {
    if (name === "Earth elemental" && npc.getId() !== api.core.NpcIdentifiers.EARTH_ELEMENTAL) return;
    const previous = Number(killer.getAttribute(ELEMENTALS_ATTRIBUTE)) | 0;
    const killed = previous | ELEMENTALS.get(name);
    killer.setAttribute(ELEMENTALS_ATTRIBUTE, killed);
    if (killed === ALL_ELEMENTALS) credit(killer, "defeat-one-of-each-elemental-in-the-workshop");
    else if (killed !== previous) DiaryProgress.notifyTaskProgress(killer, DIARY_DATA, "defeat-one-of-each-elemental-in-the-workshop");
  }
}

function playOrgan({ player, object }) {
  if (inBox(object.getLocation(), SEERS_ORGAN)) credit(player, "play-the-organ-in-seers-church");
}

function talkToSherlock({ player }) {
  credit(player, "speak-to-sherlock");
}

module.exports = {
  name: "KandarinDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(ELEMENTALS_ATTRIBUTE, 0);
    api.persistAttribute(FLAX_ATTRIBUTE, 0);
    api.onCustomEvent("fishing:success", fishingSuccess);
    api.onCustomEvent("world:picked", picked);
    api.onCustomEvent("farming:planted", farmingPlanted);
    api.onCustomEvent("farming:harvested", farmingHarvested);
    api.onCustomEvent("mining:success", miningSuccess);
    api.onCustomEvent("smithing:success", smithingSuccess);
    api.onCustomEvent("crafting:made", craftingMade);
    api.onCustomEvent("barbarian-assault:wave-complete", barbarianAssaultWave);
    api.onCustomEvent("agility:obstacle", agilityObstacle);
    api.onCustomEvent("fairy-rings:travelled", fairyRingTravelled);
    api.onCustomEvent("spell:teleport-arrival", teleportArrival);
    api.onNpcDeath(npcDeath);
    api.onObjectInteraction("Church organ", { Play: playOrgan });
    api.onNpcInteraction(SHERLOCK, { "Talk-to": talkToSherlock });
  },
  _test: {
    inBox, playOrgan, talkToSherlock, fishingSuccess, farmingPlanted, farmingHarvested, miningSuccess,
    smithingSuccess, craftingMade, picked, barbarianAssaultWave, agilityObstacle,
    fairyRingTravelled, teleportArrival, npcDeath, credit,
    CATHERBY_FISHING, OTTO_GROTTO, SEERS_ORGAN, SEERS_FLAX_FIELD, COAL_TRUCKS, JUTE_PATCH,
    CATHERBY_FLOWER_PATCH, CATHERBY_HERB_PATCH, WATERFALL_DUNGEON, SHADOW_DUNGEON,
    WORKSHOP, ELEMENTALS_ATTRIBUTE, FLAX_ATTRIBUTE,
  },
};
