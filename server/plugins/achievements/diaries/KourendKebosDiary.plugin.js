/**
 * Kourend & Kebos Diary gameplay credit: the actions whose handlers already exist, keyed to the
 * task keys in data/achievement-diaries.json. Actions this server does not implement (the Veos
 * ferry, Kharedst's memoirs, Xeric's talisman, the Arceuus Library, the Piscarilius crane,
 * Captain Ginea/Khaled deliveries, saltpetre, bluegill, the Farming Guild gate, Tyss's spellbook
 * switch and the other missing base content) are left uncredited rather than inferred.
 *
 * Every check is on the successful action's own event and its target: the rock, stall, shop,
 * NPC's tile or the player's tile, never a bare command or admin completion.
 */
const DIARY = "kourend";
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const DiaryProgress = require("./Progress.AchievementDiaries");
const ANGLER_CAUGHT_ATTRIBUTE = "kourend-kebos:anglerfish-caught";

const MOUNT_KARUULM_MINE = { minX: 1265, maxX: 1295, minY: 3800, maxY: 3825, z: 0 };
const HOSIDIUS_STALLS = { minX: 1755, maxX: 1810, minY: 3585, maxY: 3620, z: 0 };
const RIVER_MOLCH = { minX: 1180, maxX: 1300, minY: 3660, maxY: 3780, z: 0 };
const KOUREND_WOODLAND = { minX: 1450, maxX: 1520, minY: 3480, maxY: 3530, z: 0 };
const MAHOGANY_NORTH_OF_FARMING_GUILD = { minX: 1225, maxX: 1250, minY: 3758, maxY: 3785, z: 0 };
const LOVAKENGJ_PUB = { x: 1570, y: 3760, z: 0, radius: 8 };
const SHAYZIEN_CRYPTS = { minX: 1460, maxX: 1605, minY: 9890, maxY: 10000, z: 0 };
const LIZARDMAN_TEMPLE = { minX: 1280, maxX: 1345, minY: 10080, maxY: 10110, z: 0 };
const KARUULM_SLAYER_DUNGEON = { minX: 1230, maxX: 1350, minY: 10120, maxY: 10290, z: 0 };
const QUIDAMORTEM_TROLLS = { minX: 1200, maxX: 1260, minY: 3470, maxY: 3530, z: 0 };
const GREAT_KOUREND = { minX: 1100, maxX: 1900, minY: 3300, maxY: 4200, z: 0 };
const HOSIDIUS_HOUSE_PORTAL = 8;
const BLOOD_ALTAR = 27978;
const FORSAKEN_TOWER_FURNACE = 56366;
const DENSE_ESSENCE_BOULDER = 27990;

let api;

function within(location, area) {
  if (!location) return false;
  const x = location.getX?.() ?? location.x;
  const y = location.getY?.() ?? location.y;
  const z = location.getZ?.() ?? location.z;
  return x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
    && (area.z === undefined || z === area.z);
}

function near(location, area) {
  if (!location) return false;
  const x = location.getX?.() ?? location.x;
  const y = location.getY?.() ?? location.y;
  const z = location.getZ?.() ?? location.z;
  return z === area.z && Math.hypot(x - area.x, y - area.y) <= area.radius;
}

function eligible(player, allowPrivate = false) {
  return Boolean(player)
    && player.isRegistered?.() === true
    && (player.getHitpoints?.() ?? 1) > 0
    && player.isDyingReturn?.() !== true
    && (allowPrivate || !player.getPrivateArea?.());
}

function complete(player, task, allowPrivate = false) {
  if (eligible(player, allowPrivate)) api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function npcName(npc, player) {
  return String((npc?.getCurrentDefinition?.(player) ?? npc?.getDefinition?.())?.getName?.() ?? "");
}

function mined(event) {
  const { player, itemId } = event;
  if (!eligible(player)) return;
  if (itemId === api.core.ItemIdentifiers.IRON_ORE && within(event.location, MOUNT_KARUULM_MINE)) {
    complete(player, "mine-some-iron-at-the-mount-karuulm-mine");
  }
  if (itemId === api.core.ItemIdentifiers.LOVAKITE_ORE) complete(player, "mine-some-lovakite");
}

function thieved(event) {
  if (event.method !== "stall" || event.stall !== "Fruit Stall" || !within(event.location, HOSIDIUS_STALLS)) return;
  complete(event.player, "steal-from-a-hosidius-food-stall");
}

function shopOpened({ player, shopName }) {
  if (shopName === "Warrens General Store") complete(player, "browse-the-warrens-general-store");
}

function herbloreMade({ player, itemId }) {
  const I = api.core.ItemIdentifiers;
  const strength = [I.STRENGTH_POTION_4_, I.STRENGTH_POTION_3_, I.STRENGTH_POTION_2_, I.STRENGTH_POTION_1_];
  if (!strength.includes(itemId) || !near(player.getLocation?.(), LOVAKENGJ_PUB)) return;
  complete(player, "create-a-strength-potion-in-the-lovakengj-pub");
}

function fished({ player, itemId }) {
  if (!eligible(player)) return;
  if (itemId === api.core.ItemIdentifiers.RAW_TROUT && within(player.getLocation?.(), RIVER_MOLCH)) {
    complete(player, "fish-a-trout-from-the-river-molch");
  }
  if (itemId === api.core.ItemIdentifiers.RAW_ANGLERFISH && player.getAttribute(ANGLER_CAUGHT_ATTRIBUTE) !== true) {
    player.setAttribute(ANGLER_CAUGHT_ATTRIBUTE, true);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "catch-an-anglerfish-and-cook-it-whilst-in-great");
  }
}

function cooked({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.ANGLERFISH || !within(player.getLocation?.(), GREAT_KOUREND)) return;
  if (player.getAttribute(ANGLER_CAUGHT_ATTRIBUTE) !== true) return;
  player.setAttribute(ANGLER_CAUGHT_ATTRIBUTE, false);
  complete(player, "catch-an-anglerfish-and-cook-it-whilst-in-great");
}

function caughtChinchompa({ player, npcId }) {
  if (npcId === api.core.NpcIdentifiers.CHINCHOMPA && within(player.getLocation?.(), KOUREND_WOODLAND)) {
    complete(player, "catch-a-chinchompa-in-the-kourend-woodland");
  }
}

function chopped({ player, logId }) {
  if (logId === api.core.ItemIdentifiers.MAHOGANY_LOGS && within(player.getLocation?.(), MAHOGANY_NORTH_OF_FARMING_GUILD)) {
    complete(player, "chop-some-mahogany-logs-north-of-the-farming-gui");
  }
}

function travelledFairyRing({ player, code }) {
  if (code === "CIR") complete(player, "travel-to-the-fairy-ring-south-of-mount-karuulm");
}

function enteredHouse({ player, location }) {
  if (location === HOSIDIUS_HOUSE_PORTAL) complete(player, "enter-your-player-owned-house-from-hosidius", true);
}

function agilityObstacle({ player, objectId }) {
  if (objectId === DENSE_ESSENCE_BOULDER) complete(player, "use-the-boulder-leap-in-the-arceuus-essence-mine");
}

function smelted({ player, itemId, furnaceId }) {
  if (itemId === api.core.ItemIdentifiers.ADAMANTITE_BAR && furnaceId === FORSAKEN_TOWER_FURNACE) {
    complete(player, "smelt-an-adamantite-bar-in-the-forsaken-tower");
  }
}

function craftedRunes({ player, runeId, altarId }) {
  if (runeId === api.core.ItemIdentifiers.BLOOD_RUNE && altarId === BLOOD_ALTAR) {
    complete(player, "craft-one-or-more-blood-runes-from-dark-essence");
  }
}

function monsterExamined({ player, npc }) {
  if (npcName(npc, player) === "Mountain troll" && within(npc.getLocation?.(), QUIDAMORTEM_TROLLS)) {
    complete(player, "cast-monster-examine-on-a-troll-south-of-mount-q");
  }
}

function killed({ killer, npc }) {
  const player = killer?.isPlayer?.() ? killer : null;
  const name = npcName(npc, player);
  const ownBoss = (name === "Skotizo" || name === "Alchemical Hydra")
    && npc?.getPrivateArea?.() === player?.getPrivateArea?.();
  if (!eligible(player, ownBoss)) return;
  const location = npc.getLocation?.();
  if (name === "Lizardman") complete(player, "kill-a-lizardman");
  if (name === "Lizardman shaman" && within(location, LIZARDMAN_TEMPLE)) {
    complete(player, "kill-a-lizardman-shaman-in-the-lizardman-temple");
  }
  if (name === "Zombie" && within(location, SHAYZIEN_CRYPTS)) {
    complete(player, "kill-a-zombie-in-the-shayzien-crypts");
  }
  if (name === "Wyrm" && within(location, KARUULM_SLAYER_DUNGEON)) {
    complete(player, "kill-a-wyrm-in-the-karuulm-slayer-dungeon");
  }
  if ((name === "Hydra" && within(location, KARUULM_SLAYER_DUNGEON)) || name === "Alchemical Hydra") {
    complete(player, "kill-a-hydra-in-the-karuulm-slayer-dungeon", ownBoss);
  }
  if (name === "Skotizo") complete(player, "defeat-skotizo-in-the-catacombs-of-kourend", ownBoss);
}

module.exports = {
  name: "KourendKebosDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(ANGLER_CAUGHT_ATTRIBUTE, false);
    api.onCustomEvent("mining:success", mined);
    api.onCustomEvent("thieving:success", thieved);
    api.onCustomEvent("shop:opened", shopOpened);
    api.onCustomEvent("herblore:made", herbloreMade);
    api.onCustomEvent("fishing:success", fished);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("hunter:success", caughtChinchompa);
    api.onCustomEvent("woodcutting:success", chopped);
    api.onCustomEvent("fairy-rings:travelled", travelledFairyRing);
    api.onCustomEvent("poh:entered", enteredHouse);
    api.onCustomEvent("agility:obstacle", agilityObstacle);
    api.onCustomEvent("smelting:success", smelted);
    api.onCustomEvent("runecrafting:success", craftedRunes);
    api.onCustomEvent("magic:monster-examine", monsterExamined);
    api.onNpcDeath(killed);
  },
  _test: {
    within, near, eligible, mined, thieved, shopOpened, herbloreMade, fished, cooked, caughtChinchompa,
    chopped, travelledFairyRing, enteredHouse, agilityObstacle, smelted, craftedRunes, monsterExamined, killed,
    setApi: (value) => { api = value; },
    ANGLER_CAUGHT_ATTRIBUTE,
  },
};
