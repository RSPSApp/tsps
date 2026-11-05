/**
 * Karamja diary tasks that are credited from the gameplay handler that performs them. Each
 * handler only awards its task when the action succeeded and, where the Wiki names one, the
 * player or object is in the task's area.
 *
 * Tasks whose base content does not exist here stay uncatalogued (the exact gaps are in the
 * issue and the PR): the Musa Point->Port Sarim boat, the Crandor/Karamja dungeon hidden wall
 * and surface rope, Vigroy and Hajedy's cart, the Lady of the Waves from Cairn Isle, the
 * south-of-volcano crossbow shortcut, palm-leaf picking, and the Brimhaven/farming tasks owned
 * by other workers.
 */
const DIARY = "karamja";
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const DiaryProgress = require("./Progress.AchievementDiaries");

const BANANAS = 5;
const SEAWEED = 5;
const NATURE_RUNES_SIMULTANEOUSLY = 56;
const BANANA_ATTRIBUTE = "karamja-diary:bananas-picked";
const SEAWEED_ATTRIBUTE = "karamja-diary:seaweed-collected";

/** Musa Point plantation east of the volcano. */
const BANANA_PLANTATION = { minX: 2880, maxX: 2950, minY: 3140, maxY: 3178 };
/** The three fishing spots north of it (npc spawns 1521/1522 at 2923-2926, 3179-3181). */
const BANANA_FISHING_SPOTS = { minX: 2900, maxX: 2950, minY: 3170, maxY: 3195 };
/** North Brimhaven mine, the Wiki's "north-west peninsula" and "horse shoe mine". */
const NORTH_BRIMHAVEN_MINE = { minX: 2690, maxX: 2770, minY: 3180, maxY: 3260 };
/** Brimhaven dock, including Barnaby's wandering tiles around 2773,3229. */
const BRIMHAVEN_DOCK = { minX: 2760, maxX: 2785, minY: 3215, maxY: 3240 };
/** The Pothole dungeon's jogre spawns (2825-2836, 9499-9526). */
const POTHOLE_DUNGEON = { minX: 2800, maxX: 2870, minY: 9470, maxY: 9570 };
/** The Shaman Caves' death wing spawns (2796-2811, 9292-9308). */
const SHAMAN_CAVES = { minX: 2780, maxX: 2830, minY: 9280, maxY: 9320 };
/** Brimhaven Dungeon's metal dragons (2632-2670, 9418-9459). */
const BRIMHAVEN_DUNGEON = { minX: 2600, maxX: 2700, minY: 9400, maxY: 9500 };
/** The TzHaar Fight Cave's cave. */
const FIGHT_CAVE = { minX: 2368, maxX: 2431, minY: 5056, maxY: 5119 };
/** Mor Ul Rek and its outskirts, as the Fight Pit plugin bounds them. */
const MOR_UL_REK = { minX: 2368, maxX: 2559, minY: 5056, maxY: 5183 };
/** Seaweed spawns on Karamja (Kharazi included), not Entrana/Kourend/Mos Le'Harmless. */
const KARAMJA = { minX: 2600, maxX: 3050, minY: 2850, maxY: 3350 };

const METAL_DRAGONS = new Set(["Bronze dragon", "Iron dragon", "Steel dragon"]);
/** Duradel/Kuradal: slayer_master_task.master_id (skills/data/slayer-masters.json). */
const SHILO_SLAYER_MASTER = 5;
const CAIRN_SHORTCUTS = new Set([
  "Rock slide (Cairn Isle, heading east)",
  "Rock slide (Cairn Isle, heading west)",
]);
const MOSS_GIANT_ISLAND_SHORTCUT = "Ropeswing (Moss Giant Island, to the island)";
const BANANA_TASK = "pick-5-bananas-from-the-plantation-located-east";
const SEAWEED_TASK = "collect-5-seaweed-from-anywhere-on-karamja";

let core;
let api;
let antivenoms;
let cookedSpiders;

const positionOf = (location) => location && { x: location.getX?.() ?? location.x, y: location.getY?.() ?? location.y, z: location.getZ?.() ?? location.z };
const inBox = (location, box) => {
  const at = positionOf(location);
  return at != null && at.z === 0 && at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY;
};
const here = (player) => player?.getLocation?.();

function complete(player, task) {
  if (!player) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function count(player, attribute, target, task) {
  const total = (Number(player.getAttribute(attribute)) || 0) + 1;
  player.setAttribute(attribute, Math.min(total, target));
  if (total >= target) complete(player, task);
  else DiaryProgress.notifyTaskProgress(player, DIARY_DATA, task);
}

/** Picks are counted from the tree's tile, so Ape Atoll's plantation cannot count. */
function bananaPicked({ player, object }) {
  if (player?.getPrivateArea?.() != null || !inBox(object?.getLocation?.(), BANANA_PLANTATION)) return;
  count(player, BANANA_ATTRIBUTE, BANANAS, BANANA_TASK);
}

function seaweedTaken({ player, groundItem, source, itemId, amount }) {
  const I = core.ItemIdentifiers;
  if (!player || player.getPrivateArea?.() != null || !["pickup", "telegrab"].includes(source)) return;
  if (itemId !== I.SEAWEED || amount <= 0 || !inBox(groundItem?.getPosition?.(), KARAMJA)) return;
  count(player, SEAWEED_ATTRIBUTE, SEAWEED, SEAWEED_TASK);
}

function mined({ player, itemId }) {
  const I = core.ItemIdentifiers;
  if (itemId === I.GOLD_ORE && inBox(here(player), NORTH_BRIMHAVEN_MINE)) {
    complete(player, "mine-some-gold-from-the-rocks-on-the-north-west");
  }
  if (itemId === I.UNCUT_RED_TOPAZ) complete(player, "mine-a-red-topaz-from-a-gem-rock");
}

function caught({ player, itemId }) {
  const I = core.ItemIdentifiers;
  if (itemId === I.RAW_KARAMBWAN) complete(player, "catch-a-karambwan");
  if (inBox(here(player), BANANA_FISHING_SPOTS)) complete(player, "use-the-fishing-spots-north-of-the-banana-planta");
}

function cooked({ player, itemId }) {
  const I = core.ItemIdentifiers;
  if (cookedSpiders.has(itemId)) complete(player, "cook-a-spider-on-a-stick");
  if (itemId === I.COOKED_KARAMBWAN) complete(player, "cook-a-karambwan-thoroughly");
}

function chopped({ player, logId }) {
  const I = core.ItemIdentifiers;
  if (logId === I.TEAK_LOGS) complete(player, "cut-a-log-from-a-teak-tree");
  if (logId === I.MAHOGANY_LOGS) complete(player, "cut-a-log-from-a-mahogany-tree");
}

function runecrafted({ player, runeId, rolls, amountPerEssence }) {
  if (runeId !== core.ItemIdentifiers.NATURE_RUNE) return;
  complete(player, "craft-some-nature-runes-from-essence");
  if (Number(rolls) * Number(amountPerEssence) >= NATURE_RUNES_SIMULTANEOUSLY) {
    complete(player, "craft-56-nature-runes-simultaneously-from-essenc");
  }
}

function mixed({ player, itemId }) {
  if (antivenoms.has(itemId) && inBox(here(player), NORTH_BRIMHAVEN_MINE)) {
    complete(player, "create-an-antivenom-potion-whilst-standing-in-th");
  }
}

function eaten({ player, itemId }) {
  if (itemId === core.ItemIdentifiers.COOKED_OOMLIE_WRAP) complete(player, "eat-an-oomlie-wrap");
}

function equipmentChanged({ player }) {
  const cape = player?.getEquipment?.()?.get?.(core.Equipment.CAPE_SLOT)?.getId?.();
  if ((cape === core.ItemIdentifiers.FIRE_CAPE || cape === core.ItemIdentifiers.INFERNAL_CAPE)
    && inBox(here(player), MOR_UL_REK)) {
    complete(player, "equip-a-fire-cape-or-infernal-cape-in-mor-ul-rek");
  }
}

function trapped({ player, npcId }) {
  if (npcId === core.NpcIdentifiers.HORNED_GRAAHK) complete(player, "trap-a-horned-graahk");
}

function slayerAssigned({ player, master }) {
  if (master === SHILO_SLAYER_MASTER) complete(player, "be-assigned-a-slayer-task-by-the-slayer-master-i");
}

function npcKilled({ killer, npc, location }) {
  if (!killer?.isPlayer?.()) return;
  const name = npc?.getDefinition?.()?.getName?.() ?? npc?.getCurrentDefinition?.(killer)?.getName?.();
  if (name === "Jogre" && inBox(location, POTHOLE_DUNGEON)) complete(killer, "kill-a-jogre-in-the-pothole-dungeon");
  if (name === "Death wing" && inBox(location, SHAMAN_CAVES)) complete(killer, "kill-a-deathwing-in-the-dungeon-under-the-kharaz");
  if (METAL_DRAGONS.has(name) && inBox(location, BRIMHAVEN_DUNGEON)) complete(killer, "kill-a-metal-dragon-in-brimhaven-dungeon");
  if (name === "Ket-Zek" && inBox(location, FIGHT_CAVE)) complete(killer, "successfully-kill-a-ket-zek-in-the-fight-caves");
}

function obstacle({ player, shortcut }) {
  if (CAIRN_SHORTCUTS.has(shortcut)) complete(player, "explore-cairn-island-to-the-west-of-karamja");
  if (shortcut === MOSS_GIANT_ISLAND_SHORTCUT) complete(player, "use-the-rope-swing-to-travel-to-the-small-island");
}

function ferried({ player, route, from }) {
  if (route === "barnaby-ardougne" && inBox(from, BRIMHAVEN_DOCK)) complete(player, "travel-to-ardougne-via-the-port-near-brimhaven");
}

function glided({ player, destination }) {
  if (destination?.index === 1) complete(player, "use-the-gnome-glider-to-travel-to-karamja");
}

function chartered({ player, from }) {
  if (from?.slug === "shipyard" || from === "shipyard") complete(player, "charter-a-ship-from-the-shipyard-in-the-far-east");
}

function fightPitEntered({ player }) {
  complete(player, "attempt-the-tzhaar-fight-pits-or-fight-cave");
}

function fightCaveEntered({ player }) {
  complete(player, "attempt-the-tzhaar-fight-pits-or-fight-cave");
}

function fightPitChampion({ player }) {
  complete(player, "become-the-champion-of-the-fight-pits");
}

function taiBwoFavour({ player, percentage }) {
  if (Number(percentage) >= 100) complete(player, "earn-100-favour-in-the-village-of-tai-bwo-wannai");
}

module.exports = {
  name: "KaramjaDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    const obj = (name) => core.CacheDefinitions.getObjId(name);
    antivenoms = new Set(["antivenom1", "antivenom2", "antivenom3", "antivenom4"].map(obj));
    cookedSpiders = new Set(["tbw_spider_on_stick_cooked", "tbw_spider_on_shaft_cooked"].map(obj));
    api.persistAttribute(BANANA_ATTRIBUTE, 0);
    api.persistAttribute(SEAWEED_ATTRIBUTE, 0);
    api.onCustomEvent("banana-tree:picked", bananaPicked);
    api.onCustomEvent("ground-items:taken", seaweedTaken);
    api.onCustomEvent("mining:success", mined);
    api.onCustomEvent("fishing:success", caught);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("woodcutting:success", chopped);
    api.onCustomEvent("runecrafting:success", runecrafted);
    api.onCustomEvent("herblore:made", mixed);
    api.onCustomEvent("food:eaten", eaten);
    api.onCustomEvent("equipment:changed", equipmentChanged);
    api.onCustomEvent("hunter:success", trapped);
    api.onCustomEvent("slayer:task-assigned", slayerAssigned);
    api.onCustomEvent("agility:obstacle", obstacle);
    api.onCustomEvent("ferries:departed", ferried);
    api.onCustomEvent("gnome-gliders:arrived", glided);
    api.onCustomEvent("charter-ships:arrived", chartered);
    api.onCustomEvent("fight-pits:entered", fightPitEntered);
    api.onCustomEvent("fight-caves:entered", fightCaveEntered);
    api.onCustomEvent("fight-pits:champion", fightPitChampion);
    api.onCustomEvent("tai-bwo-wannai-cleanup:favour-gained", taiBwoFavour);
    api.onNpcDeath(npcKilled);
  },
  _test: {
    BANANA_TASK, SEAWEED_TASK,
    BANANA_PLANTATION, BANANA_FISHING_SPOTS, NORTH_BRIMHAVEN_MINE, POTHOLE_DUNGEON, SHAMAN_CAVES,
    BRIMHAVEN_DUNGEON, FIGHT_CAVE, MOR_UL_REK, KARAMJA,
    bananaPicked, seaweedTaken, mined, caught, cooked, chopped, runecrafted, mixed, eaten,
    equipmentChanged, trapped, slayerAssigned, npcKilled, obstacle, ferried, glided, chartered,
    fightPitEntered, fightCaveEntered, fightPitChampion, taiBwoFavour,
  },
};
