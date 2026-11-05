const DIARY = "lumbridge";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const ATTRIBUTES = {
  oakChopped: "achievement-diaries:lumbridge-oak-chopped",
  amuletStage: "achievement-diaries:lumbridge-power-amulet-stage",
};

// Task areas are based on public-world tile bounds. The tight bounds below avoid awarding credit
// for a matching action elsewhere in the broad region (for example, cooking at another range).
const AREAS = {
  lumbridge: { minX: 3200, maxX: 3263, minY: 3200, maxY: 3263, z: 0 },
  draynor: { minX: 3072, maxX: 3135, minY: 3200, maxY: 3263, z: 0 },
  alKharidFishing: { minX: 3250, maxX: 3288, minY: 3128, maxY: 3160, z: 0 },
  alKharidMine: { minX: 3284, maxX: 3312, minY: 3300, maxY: 3330, z: 0 },
  fireAltar: { minX: 3295, maxX: 3320, minY: 3240, maxY: 3268, z: 0 },
  alKharidPalace: { minX: 3275, maxX: 3312, minY: 3158, maxY: 3195, z: 0 },
  lumbridgeKitchen: { minX: 3204, maxX: 3222, minY: 3208, maxY: 3225, z: 0 },
  cowPen: { minX: 3234, maxX: 3272, minY: 3244, maxY: 3285, z: 0 },
  draynorWillows: { minX: 3072, maxX: 3135, minY: 3200, maxY: 3263, z: 0 },
  mageTrainingArena: { minX: 3352, maxX: 3391, minY: 3296, maxY: 3335, z: 0 },
  lumbridgeBasement: { minX: 3185, maxX: 3225, minY: 9588, maxY: 9625, z: 0 },
  wiseOldManHouse: { minX: 3083, maxX: 3094, minY: 3249, maxY: 3263, z: 0 },
  emirAltar: { minX: 3326, maxX: 3383, minY: 3197, maxY: 3295, z: 0 },
};

const TASKS = {
  waterRunes: "craft-some-water-runes-from-essence",
  oakLogs: "chop-and-burn-some-oak-logs-in-lumbridge",
  anchovies: "catch-some-anchovies-in-al-kharid",
  bread: "bake-some-bread-on-the-lumbridge-kitchen-range",
  iron: "mine-some-iron-ore-at-the-al-kharid-mine",
  ava: "purchase-an-upgraded-device-from-ava",
  riverLumGrapple: "grapple-across-the-river-lum",
  wizardTower: "travel-to-the-wizards-tower-by-fairy-ring",
  lumbridgeTeleport: "cast-the-teleport-to-lumbridge-spell",
  salmon: "catch-some-salmon-in-lumbridge",
  coif: "craft-a-coif-in-the-lumbridge-cow-pen",
  willow: "chop-some-willow-logs-in-draynor-village",
  martin: "pickpocket-martin-the-master-gardener",
  chaeldar: "get-a-slayer-task-from-chaeldar",
  impling: "catch-an-essence-or-eclectic-impling-in-puro-pur",
  lava: "craft-some-lava-runes-at-the-fire-altar-in-al-kh",
  peaches: "cast-bones-to-peaches-in-al-kharid-palace",
  juttingWall: "squeeze-past-the-jutting-wall-on-your-way-to-the",
  cosmic: "craft-56-cosmic-runes-simultaneously-from-essenc",
  barrowsGloves: "purchase-some-barrows-gloves-from-the-lumbridge",
  belladonna: "pick-some-belladonna-from-the-farming-patch-at-d",
  miningHelmet: "light-your-mining-helmet-in-the-lumbridge-castle",
  emirPrayer: "recharge-your-prayer-at-the-emir-s-arena-with-sm",
  amulet: "craft-string-and-enchant-an-amulet-of-power-in-l",
  magicLogs: "chop-some-magic-logs-at-the-mage-training-arena",
  adamantPlatebody: "smith-an-adamant-platebody-down-draynor-sewer",
  waterRunesElite: "craft-140-or-more-water-runes-simultaneously-fro",
  questCape: "perform-the-quest-cape-emote-in-the-wise-old-man",
};

const MARTIN_ID = 5832;
const CHAELDAR_ID = 404;
const BELLADONNA_PATCH_ID = 7572;
const ZANARIS_JUTTING_WALLS = new Set([[2400, 4403].join(","), [2409, 4401].join(",")]);

let pluginApi;
let core;
let item;

function point(location) {
  if (!location) return null;
  const get = (method, prop) => typeof location[method] === "function" ? location[method]() : location[prop];
  const x = get("getX", "x");
  const y = get("getY", "y");
  const z = get("getZ", "z");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z: Number.isFinite(z) ? z : 0 } : null;
}

function inside(location, area) {
  const at = point(location);
  return !!at && at.z === area.z && at.x >= area.minX && at.x <= area.maxX
    && at.y >= area.minY && at.y <= area.maxY;
}

function inSquare(location, squareX, squareY, plane = 0) {
  const at = point(location);
  return !!at && at.z === plane && (at.x >> 6) === squareX && (at.y >> 6) === squareY;
}

function eligible(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && player.getPrivateArea?.() == null;
}

function complete(player, task) {
  if (!eligible(player)) return false;
  pluginApi.emitCustomEvent("diary:task", { player, diary: DIARY, task });
  return true;
}

function sameEssence(essenceIds) {
  return Array.isArray(essenceIds) && essenceIds.length > 0
    && essenceIds.every((id) => id === item.RUNE_ESSENCE || id === item.PURE_ESSENCE || id === item.DAEYALT_ESSENCE);
}

function runecrafted(event) {
  const { player, runeId, rolls, amountPerEssence, runeAmount, objectId, essenceIds } = event ?? {};
  if (!eligible(player) || !Number.isInteger(rolls) || rolls <= 0 || !sameEssence(essenceIds)) return;
  const amountCrafted = Number.isInteger(runeAmount) && runeAmount >= 0 ? runeAmount : rolls * amountPerEssence;
  if (runeId === item.WATER_RUNE) {
    complete(player, TASKS.waterRunes);
    if (amountCrafted >= 140) complete(player, TASKS.waterRunesElite);
  }
  if (runeId === item.LAVA_RUNE && objectId === core.ObjectIdentifiers.FIRE_ALTAR
    && inside(player.getLocation?.(), AREAS.fireAltar)) complete(player, TASKS.lava);
  if (runeId === item.COSMIC_RUNE && amountCrafted >= 56) complete(player, TASKS.cosmic);
}

function woodcut(event) {
  const { player, logId, location } = event ?? {};
  if (!eligible(player)) return;
  const at = location ?? player.getLocation?.();
  if (logId === item.OAK_LOGS && inSquare(at, 50, 50)) {
    if (player.getAttribute(ATTRIBUTES.oakChopped) !== true) {
      player.setAttribute(ATTRIBUTES.oakChopped, true);
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.oakLogs);
    }
  }
  if (logId === item.WILLOW_LOGS && inSquare(at, 48, 50)) complete(player, TASKS.willow);
  if (logId === item.MAGIC_LOGS && inside(at, AREAS.mageTrainingArena)) complete(player, TASKS.magicLogs);
}

function firemade(event) {
  const { player, itemId, activity } = event ?? {};
  if (!eligible(player)) return;
  const at = player.getLocation?.();
  if (activity === "mining-helmet" && itemId === item.MINING_HELMET_2
    && inside(at, AREAS.lumbridgeBasement)) complete(player, TASKS.miningHelmet);
  if (itemId === item.OAK_LOGS && inSquare(at, 50, 50)
    && player.getAttribute(ATTRIBUTES.oakChopped) === true) {
    player.setAttribute(ATTRIBUTES.oakChopped, false);
    complete(player, TASKS.oakLogs);
  }
}

function fished({ player, itemId } = {}) {
  if (!eligible(player)) return;
  const at = player.getLocation?.();
  if (itemId === item.RAW_ANCHOVIES && inside(at, AREAS.alKharidFishing)) complete(player, TASKS.anchovies);
  if (itemId === item.RAW_SALMON && inSquare(at, 50, 50)) complete(player, TASKS.salmon);
}

function cooked({ player, itemId, objectId, objectLocation } = {}) {
  if (itemId === item.BREAD && objectId === core.ObjectIdentifiers.COOKING_RANGE
    && inside(objectLocation, AREAS.lumbridgeKitchen)) complete(player, TASKS.bread);
}

function mined({ player, itemId } = {}) {
  if (itemId === item.IRON_ORE && eligible(player) && inside(player.getLocation?.(), AREAS.alKharidMine)) {
    complete(player, TASKS.iron);
  }
}

function smithed({ player, itemId } = {}) {
  if (itemId === item.ADAMANT_PLATEBODY && eligible(player)
    && inSquare(player.getLocation?.(), 48, 151)) complete(player, TASKS.adamantPlatebody);
}

function produced({ player, skill, itemId, kind } = {}) {
  if (!eligible(player)) return;
  const at = player.getLocation?.();
  if (itemId === item.COIF && inside(at, AREAS.cowPen)) complete(player, TASKS.coif);
  if (inside(at, AREAS.lumbridge) && skill === core.Skill.CRAFTING) {
    const stage = Number(player.getAttribute(ATTRIBUTES.amuletStage)) || 0;
    if (itemId === item.DIAMOND_AMULET_U_ && stage !== 1) {
      player.setAttribute(ATTRIBUTES.amuletStage, 1);
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.amulet);
    } else if (itemId === item.DIAMOND_AMULET && kind === "string" && stage >= 1) {
      if (stage !== 2) {
        player.setAttribute(ATTRIBUTES.amuletStage, 2);
        DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.amulet);
      }
    }
  }
}

function enchanted({ player, itemId, productId, spellName } = {}) {
  if (!eligible(player) || itemId !== item.DIAMOND_AMULET || productId !== item.AMULET_OF_POWER
    || String(spellName).toLowerCase() !== "lvl-4 enchant"
    || !inside(player.getLocation?.(), AREAS.lumbridge)
    || Number(player.getAttribute(ATTRIBUTES.amuletStage)) < 2) return;
  player.setAttribute(ATTRIBUTES.amuletStage, 0);
  complete(player, TASKS.amulet);
}

function thieved({ player, kind, succeeded, npc } = {}) {
  if (!eligible(player) || kind !== "pickpocket" || succeeded !== true || npc?.getId?.() !== MARTIN_ID
    || !npc.isRegistered?.() || npc.getHitpoints?.() <= 0 || npc.getPrivateArea?.() != null
    || !inSquare(npc.getLocation?.(), 48, 50)) return;
  complete(player, TASKS.martin);
}

function assignedSlayerTask({ player, master } = {}) {
  if (master === CHAELDAR_ID) complete(player, TASKS.chaeldar);
}

function caughtImpling({ player, npcId, puro } = {}) {
  const allowed = new Set([1639, 1640, 1649, 1650]);
  if (puro === true && allowed.has(npcId)) complete(player, TASKS.impling);
}

function fairyRingTravelled({ player, code, destination } = {}) {
  if (String(code).toUpperCase() === "DIS" && inside(destination, { minX: 3100, maxX: 3120, minY: 3158, maxY: 3180, z: 0 })) {
    complete(player, TASKS.wizardTower);
  }
}

function teleportArrived({ player, name } = {}) {
  if (String(name).trim().toLowerCase() === "lumbridge teleport" && inSquare(player?.getLocation?.(), 50, 50)) {
    complete(player, TASKS.lumbridgeTeleport);
  }
}

function harvested({ player, crop, patch } = {}) {
  if (crop === "BELLADONNA" && patch?.type === "BELLADONNA" && patch.id === BELLADONNA_PATCH_ID
    && patch.x === 3086 && patch.y === 3354 && patch.z === 0) complete(player, TASKS.belladonna);
}

function agilityObstacle({ player, objectId, location, shortcut, method } = {}) {
  const at = point(location);
  const key = at ? `${at.x},${at.y}` : "";
  if (shortcut === "Broken Raft" && objectId === 17068 && key === "3252,3179" && method === "grapple") {
    complete(player, TASKS.riverLumGrapple);
  }
  if (objectId === 17002 && ZANARIS_JUTTING_WALLS.has(key)
    && /^Jutting wall \(Zanaris, (medium|advanced)\)$/i.test(String(shortcut ?? ""))) {
    complete(player, TASKS.juttingWall);
  }
}

function purchased({ player, itemId, shopName } = {}) {
  if (itemId === item.BARROWS_GLOVES && /^Culinaromancer.s Chest/i.test(String(shopName ?? ""))
    && inside(player?.getLocation?.(), AREAS.lumbridgeBasement)) complete(player, TASKS.barrowsGloves);
}

function prayerRestored({ player, location, prayerAfter, prayerBefore } = {}) {
  if (eligible(player) && prayerAfter > prayerBefore && inside(location, AREAS.emirAltar)
    && core.PrayerHandler?.isActivated?.(player, core.PrayerHandler.SMITE)) complete(player, TASKS.emirPrayer);
}

function emote({ player, sequence } = {}) {
  const cape = player?.getEquipment?.()?.getItems?.()[core.Equipment.CAPE_SLOT];
  if (sequence === 4945 && [item.QUEST_POINT_CAPE, item.QUEST_POINT_CAPE_T_].includes(cape?.getId?.())
    && inside(player?.getLocation?.(), AREAS.wiseOldManHouse)) complete(player, TASKS.questCape);
}

function spellEffectSucceeded({ player, spellName } = {}) {
  if (String(spellName).trim().toLowerCase() === "bones to peaches"
    && inside(player?.getLocation?.(), AREAS.alKharidPalace)) complete(player, TASKS.peaches);
}

module.exports = {
  name: "LumbridgeDraynorDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    pluginApi = api;
    core = api.core;
    item = core.ItemIdentifiers;
    api.persistAttribute(ATTRIBUTES.oakChopped, false);
    api.persistAttribute(ATTRIBUTES.amuletStage, 0);
    api.onCustomEvent("runecrafting:success", runecrafted);
    api.onCustomEvent("woodcutting:success", woodcut);
    api.onCustomEvent("firemaking:success", firemade);
    api.onCustomEvent("fishing:success", fished);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("mining:success", mined);
    api.onCustomEvent("smithing:success", smithed);
    api.onCustomEvent("skills:produced", produced);
    api.onCustomEvent("magic:enchanted", enchanted);
    api.onCustomEvent("thieving:done", thieved);
    api.onCustomEvent("slayer:task-assigned", assignedSlayerTask);
    api.onCustomEvent("hunter:impling-caught", caughtImpling);
    api.onCustomEvent("fairy-rings:travelled", fairyRingTravelled);
    api.onCustomEvent("spell:teleport-arrival", teleportArrived);
    api.onCustomEvent("farming:harvested", harvested);
    api.onCustomEvent("agility:obstacle", agilityObstacle);
    api.onCustomEvent("shop:purchase", purchased);
    api.onCustomEvent("prayer:restored-at-altar", prayerRestored);
    api.onCustomEvent("player:emote", emote);
    api.onCustomEvent("magic:spell-effect-succeeded", spellEffectSucceeded);
  },
  _test: {
    AREAS, ATTRIBUTES, TASKS, inSquare, inside, runecrafted, woodcut, firemade, fished, cooked, mined,
    produced, smithed, enchanted, thieved, assignedSlayerTask, caughtImpling, fairyRingTravelled, teleportArrived,
    harvested, agilityObstacle, purchased, prayerRestored, emote, spellEffectSucceeded,
  },
};
