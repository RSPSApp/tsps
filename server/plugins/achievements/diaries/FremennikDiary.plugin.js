/**
 * Fremennik Diary (OSRS Wiki: Fremennik Diary) gameplay credits. Each handler only answers the
 * producer for an action the Wiki names, and the existing skill/quest handler still enforces its
 * own requirements; credits are emitted after the producer reports success.
 *
 * Two tasks ask for a sequence or a set and reset if another task is completed in between
 * (the Wiki's notes): the Rellekka tiara and the Dagannoth Kings.
 */
const Common = require("../../bosses/godwars/Common.GodWars");
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get("fremennik");

const DIARY = "fremennik";
const FREMENNIK_TRIALS = "fremennik_trials";
const THE_GIANT_DWARF = "giant_dwarf";
const EADGARS_RUSE = "eadgars_ruse";
const EAGLES_PEAK = "eagles_peak";
const FAIRYTALE_II = "fairytale_ii_cure_a_queen";
const THE_FREMENNIK_ISLES = "the_fremennik_isles";
const LUNAR_DIPLOMACY = "lunar_diplomacy";

const YRSA_SHOP = 1387;
const STONEMASON_SHOP = 1193;
const ROCK_CRAB_IDS = new Set([100, 102]); // Rock Crab; Giant Rock Crab (2261) does not count
const KING_IDS = new Set([2265, 2266, 2267]); // Supreme, Prime, Rex
const GENERAL_BY_FACTION = { armadyl: 3162, bandos: 2215, saradomin: 2205, zamorak: 3129 };
const KING_TASKS = {
  2265: "supreme",
  2266: "prime",
  2267: "rex",
};

const RELLEKKA = { minX: 2600, maxX: 2720, minY: 3640, maxY: 3740, z: 0 };
const RELLEKKA_FURNACE = { minX: 2615, maxX: 2620, minY: 3665, maxY: 3670, z: 0 };
const RELLEKKA_WELL = { minX: 2666, maxX: 2671, minY: 3658, maxY: 3663, z: 0 };
const FREMENNIK_PROVINCE = { minX: 2550, maxX: 2800, minY: 3550, maxY: 3850, z: 0 };
const WATERBIRTH = { minX: 2450, maxX: 2600, minY: 3680, maxY: 3800, z: 0 };
const KELDAGRIM = { minX: 2800, maxX: 2950, minY: 10150, maxY: 10260, z: 0 };
const JATIZSO_MINE = { minX: 2370, maxX: 2430, minY: 10180, maxY: 10235, z: 0 };
const ARZINIAN_MINE = { minX: 2300, maxX: 2431, minY: 4920, maxY: 5010, z: 0 };
const NEITIZNOT_CLAY_FORGE = { minX: 2343, maxX: 2345, minY: 3810, maxY: 3812, z: 0 };
const TROLL_STRONGHOLD_TOP = { minX: 2800, maxX: 2920, minY: 10040, maxY: 10120, levels: [2] };
const TROLL_STRONGHOLD_CAVES = { minX: 2860, maxX: 2950, minY: 9990, maxY: 10060, levels: [0] };
const TROLL_STRONGHOLD_PRISON = { minX: 2800, maxX: 2860, minY: 10040, maxY: 10120, levels: [0] };

const KELDAGRIM_CRAFTING_STALLS = new Set(["Crafting stall"]);
const KELDAGRIM_BAKER_STALLS = new Set(["Bakery stall", "Baker's stall", "Baker's Stall"]);
const KELDAGRIM_GEM_STALLS = new Set(["Gem stall", "Gem Stall"]);
const PET_ROCK_IDS = new Set([3695, 16746]);

const ROCK_CRABS_ATTRIBUTE = "fremennik-diary:rock-crabs";
const SNAPE_GRASS_ATTRIBUTE = "fremennik-diary:snape-grass";
const ADAMANTITE_ATTRIBUTE = "fremennik-diary:adamantite";
const TIARA_STAGE_ATTRIBUTE = "fremennik-diary:tiara-stage";
const OAK_CHOPPED_ATTRIBUTE = "fremennik-diary:oak-chopped";
const KINGS_ATTRIBUTE = "fremennik-diary:dagannoth-kings";
const GENERALS_ATTRIBUTE = "fremennik-diary:gwd-generals";

let api;

const at = (location) => ({
  x: location?.getX?.() ?? location?.x,
  y: location?.getY?.() ?? location?.y,
  z: location?.getZ?.() ?? location?.z,
});

function inBox(location, box) {
  const point = at(location);
  return point.x >= box.minX && point.x <= box.maxX
    && point.y >= box.minY && point.y <= box.maxY
    && point.z === box.z;
}

function active(player, privateArea = null) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && player.isDyingReturn?.() !== true && (player.getPrivateArea?.() ?? null) === privateArea;
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** A completed quest has also been started, and the two events answer only their own state. */
function questStarted(player, key) {
  const started = { player, key, started: null };
  api.emitCustomEvent("quest:is-started", started);
  if (started.started === true) return true;
  return questComplete(player, key);
}

function complete(player, task) {
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function increment(player, attribute, need, task) {
  const total = (Number(player.getAttribute(attribute)) || 0) + 1;
  player.setAttribute(attribute, Math.min(total, need));
  if (total >= need) complete(player, task);
  else DiaryProgress.notifyTaskProgress(player, DIARY_DATA, task);
}

function onShopOpened({ player, shopId }) {
  if (!active(player)) return;
  if (shopId === YRSA_SHOP) {
    if (questComplete(player, FREMENNIK_TRIALS)) {
      complete(player, "change-your-boots-at-yrsa-s-shoe-store");
    }
  } else if (shopId === STONEMASON_SHOP && questStarted(player, THE_GIANT_DWARF)) {
    complete(player, "browse-the-stonemasons-shop");
  }
}

function onHunterSuccess({ player, npcId }) {
  if (!active(player)) return;
  const N = api.core.NpcIdentifiers;
  if (npcId === N.CERULEAN_TWITCH) complete(player, "catch-a-cerulean-twitch");
  else if (npcId === N.SNOWY_KNIGHT) complete(player, "catch-a-snowy-knight");
  else if (npcId === N.SABRE_TOOTHED_KYATT) complete(player, "catch-a-sabre-toothed-kyatt");
}

function onNpcDeath({ killer, npc }) {
  if (!killer?.isPlayer?.() || !npc) return;
  const player = killer;
  if (!active(player)) return;
  const id = npc.getId?.();
  if (ROCK_CRAB_IDS.has(id)) {
    increment(player, ROCK_CRABS_ATTRIBUTE, 5, "kill-5-rock-crabs");
    return;
  }
  const name = npc.getCurrentDefinition?.(player)?.getName?.() ?? npc.getDefinition?.()?.getName?.() ?? "";
  if (name === "Brine rat") {
    complete(player, "slay-a-brine-rat");
  } else if (KING_IDS.has(id)) {
    recordKing(player, id);
  } else if (name.toLowerCase() === "spiritual mage" && Common.inDungeon(npc.getLocation())) {
    complete(player, "slay-a-spiritual-mage-within-the-godwars-dungeon");
  }
}

function recordKing(player, id) {
  const kings = new Set(player.getAttribute(KINGS_ATTRIBUTE) ?? []);
  const previousSize = kings.size;
  kings.add(KING_TASKS[id]);
  player.setAttribute(KINGS_ATTRIBUTE, [...kings]);
  if (kings.size === KING_IDS.size) {
    player.setAttribute(KINGS_ATTRIBUTE, []);
    complete(player, "kill-each-of-the-dagannoth-kings");
  } else if (kings.size !== previousSize) {
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "kill-each-of-the-dagannoth-kings");
  }
}

function onGroundItemsTaken(event) {
  const { player, itemId, amount, groundItem } = event;
  if (PET_ROCK_IDS.has(itemId)) return onPetRockTaken(event);
  if (!active(player) || itemId !== api.core.ItemIdentifiers.SNAPE_GRASS) return;
  if (!inBox(groundItem?.getPosition?.(), WATERBIRTH)) return;
  const total = (Number(player.getAttribute(SNAPE_GRASS_ATTRIBUTE)) || 0) + amount;
  const previous = Number(player.getAttribute(SNAPE_GRASS_ATTRIBUTE)) || 0;
  player.setAttribute(SNAPE_GRASS_ATTRIBUTE, Math.min(total, 5));
  if (total >= 5) complete(player, "collect-5-snape-grass-on-waterbirth-island");
  else if (total > previous) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "collect-5-snape-grass-on-waterbirth-island");
}

function onMiningSuccess({ player, itemId }) {
  if (!active(player)) return;
  const I = api.core.ItemIdentifiers;
  const location = player.getLocation();
  if (itemId === I.SILVER_ORE && inBox(location, RELLEKKA) && questComplete(player, FREMENNIK_TRIALS)) {
    if (player.getAttribute(TIARA_STAGE_ATTRIBUTE) !== 1) {
      player.setAttribute(TIARA_STAGE_ATTRIBUTE, 1);
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "craft-a-tiara-from-scratch-in-rellekka");
    }
  } else if (itemId === I.COAL && inBox(location, RELLEKKA) && questComplete(player, FREMENNIK_TRIALS)) {
    complete(player, "mine-some-coal-in-rellekka");
  } else if (itemId === I.GOLD_ORE && inBox(location, ARZINIAN_MINE)) {
    complete(player, "mine-some-gold-at-the-arzinian-mine");
  } else if (itemId === I.ADAMANTITE_ORE && inBox(location, JATIZSO_MINE)
    && questStarted(player, THE_FREMENNIK_ISLES)) {
    increment(player, ADAMANTITE_ATTRIBUTE, 5, "mine-5-adamantite-ores-on-jatizso");
  }
}

function onSmeltingSuccess({ player, itemId }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.SILVER_BAR) return;
  if (player.getAttribute(TIARA_STAGE_ATTRIBUTE) === 1 && inBox(player.getLocation(), RELLEKKA_FURNACE)) {
    player.setAttribute(TIARA_STAGE_ATTRIBUTE, 2);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "craft-a-tiara-from-scratch-in-rellekka");
  }
}

function onCraftingMade({ player, itemId }) {
  if (!active(player)) return;
  const I = api.core.ItemIdentifiers;
  if (itemId === I.TIARA && player.getAttribute(TIARA_STAGE_ATTRIBUTE) === 2
    && inBox(player.getLocation(), RELLEKKA)) {
    player.setAttribute(TIARA_STAGE_ATTRIBUTE, 0);
    complete(player, "craft-a-tiara-from-scratch-in-rellekka");
  } else if (itemId === I.DRAGONSTONE_AMULET_U_ && inBox(player.getLocation(), NEITIZNOT_CLAY_FORGE)
    && questStarted(player, THE_FREMENNIK_ISLES)) {
    complete(player, "create-a-dragonstone-amulet-in-the-neitiznot-fur");
  }
}

function onWoodcuttingSuccess({ player, itemId }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.OAK_LOGS) return;
  if (inBox(player.getLocation(), FREMENNIK_PROVINCE) && player.getAttribute(OAK_CHOPPED_ATTRIBUTE) !== true) {
    player.setAttribute(OAK_CHOPPED_ATTRIBUTE, true);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "chop-and-burn-some-oak-logs-in-the-fremennik-pro");
  }
}

function onFiremakingSuccess({ player, itemId }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.OAK_LOGS) return;
  if (player.getAttribute(OAK_CHOPPED_ATTRIBUTE) === true && inBox(player.getLocation(), FREMENNIK_PROVINCE)) {
    player.setAttribute(OAK_CHOPPED_ATTRIBUTE, false);
    complete(player, "chop-and-burn-some-oak-logs-in-the-fremennik-pro");
  }
}

function onHerbloreMade({ player, itemId }) {
  if (!active(player) || ![api.core.ItemIdentifiers.SUPER_DEFENCE_3_, api.core.ItemIdentifiers.SUPER_DEFENCE_4_].includes(itemId)) return;
  if (inBox(player.getLocation(), RELLEKKA)) complete(player, "mix-a-super-defence-potion-in-the-fremennik-prov");
}

function onThievingSuccess({ player, method, stall, location }) {
  if (!active(player) || method !== "stall") return;
  if (stall === "Fish stall") {
    if (questComplete(player, FREMENNIK_TRIALS) && inBox(location ?? player.getLocation(), RELLEKKA)) {
      complete(player, "steal-from-the-rellekka-fish-stalls");
    }
  } else if (KELDAGRIM_CRAFTING_STALLS.has(stall) || KELDAGRIM_BAKER_STALLS.has(stall)) {
    if (questStarted(player, THE_GIANT_DWARF) && inBox(location ?? player.getLocation(), KELDAGRIM)) {
      complete(player, "steal-from-the-keldagrim-crafting-or-baker-s-sta");
    }
  } else if (KELDAGRIM_GEM_STALLS.has(stall)) {
    if (questStarted(player, THE_GIANT_DWARF) && inBox(location ?? player.getLocation(), KELDAGRIM)) {
      complete(player, "steal-from-the-keldagrim-gem-stall");
    }
  }
}

function onTrollStrongholdEnter({ player }) {
  if (active(player)) complete(player, "enter-the-troll-stronghold");
}

function onEagleArrived({ player, eyrie }) {
  if (active(player) && eyrie === "polar" && questComplete(player, EAGLES_PEAK)) {
    complete(player, "travel-to-the-snowy-hunter-area-via-eagle");
  }
}

function onFairyRingLanded({ player, source, code }) {
  if (!active(player) || source !== "fairy-ring" || String(code).toUpperCase() !== "CIP") return;
  if (questComplete(player, FREMENNIK_TRIALS) && questStarted(player, FAIRYTALE_II)) {
    complete(player, "travel-to-miscellania-by-fairy-ring");
  }
}

function onSpellArrival({ player, name }) {
  if (!active(player)) return;
  const spell = name?.trim().toLowerCase();
  if (spell === "trollheim teleport" && questComplete(player, EADGARS_RUSE)) {
    complete(player, "teleport-to-trollheim");
  } else if (spell === "waterbirth teleport" && questComplete(player, LUNAR_DIPLOMACY)) {
    complete(player, "teleport-to-waterbirth-island");
  }
}

function onWaterSourceFilled({ player, itemId, name, location }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.BUCKET) return;
  if (String(name).toLowerCase() === "well" && inBox(location, RELLEKKA_WELL)) {
    complete(player, "fill-a-bucket-with-water-at-the-rellekka-well");
  }
}

function onPetRockTaken({ player, itemId, amount, source, groundItem }) {
  const house = player?.getPrivateArea?.();
  if (!house || house.owner !== player || house.buildingMode || !active(player, house)
    || source !== "pickup" || amount < 1 || !PET_ROCK_IDS.has(itemId)
    || groundItem?.getPrivateArea?.() !== house) return;
  const position = house.getRoomPositionAt?.(player.getLocation());
  const room = position && house.getRoom?.(position);
  if (!["MENAGERIE_INDOORS", "MENAGERIE_OUTDOORS"].includes(room?.roomKey)) return;
  if (questStarted(player, FREMENNIK_TRIALS)) {
    complete(player, "pick-up-your-pet-rock-from-your-poh-menagerie");
  }
}

function onApprovalChanged({ player, value, max }) {
  if (!player || !Number.isFinite(value) || !Number.isFinite(max)) return;
  if (value >= max) complete(player, "obtain-100-support-from-your-kingdom-subjects");
}

function onDialogueLine({ player, npcId, text }) {
  if (npcId !== api.core.NpcIdentifiers.BLAST_FURNACE_FOREMAN) return;
  if (text !== "A human has level 60 smithing? How extraordinary!") return;
  if (!questStarted(player, THE_GIANT_DWARF)) return;
  if (player.getSkillManager().getMaxLevel(api.core.Skill.SMITHING) < 60) return;
  complete(player, "obtain-the-blast-furnace-foreman-s-permission-to");
}

function onShieldMade({ player }) {
  if (active(player)) complete(player, "craft-a-neitiznot-shield-on-neitiznot");
}

function onRunecraftingSuccess({ player, runeId, rolls, amountPerEssence }) {
  if (!active(player) || runeId !== api.core.ItemIdentifiers.ASTRAL_RUNE) return;
  // Astral multiplies at 82; Ourania's single-rune rolls are excluded by the multiplier.
  if ((Number(rolls) || 0) * (Number(amountPerEssence) || 0) >= 56
    && Number(amountPerEssence) >= 2 && questComplete(player, LUNAR_DIPLOMACY)) {
    complete(player, "craft-56-astral-runes-simultaneously-from-essenc");
  }
}

function onGodWarsKill({ player, npcId, faction }) {
  if (!active(player) || GENERAL_BY_FACTION[faction] !== npcId) return;
  const generals = new Set(player.getAttribute(GENERALS_ATTRIBUTE) ?? []);
  const previousSize = generals.size;
  generals.add(faction);
  player.setAttribute(GENERALS_ATTRIBUTE, [...generals]);
  if (generals.size === Object.keys(GENERAL_BY_FACTION).length) {
    complete(player, "kill-the-generals-of-armadyl-bandos-saradomin-an");
  } else if (generals.size !== previousSize) {
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "kill-the-generals-of-armadyl-bandos-saradomin-an");
  }
}

function onDiaryTask(request) {
  const { player, diary, task } = request ?? {};
  if (!player) return;
  if (!(diary === DIARY && task === "craft-a-tiara-from-scratch-in-rellekka")) {
    player.setAttribute(TIARA_STAGE_ATTRIBUTE, 0);
  }
  if (!(diary === DIARY && task === "kill-each-of-the-dagannoth-kings")) {
    player.setAttribute(KINGS_ATTRIBUTE, []);
  }
}

module.exports = {
  name: "FremennikDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(ROCK_CRABS_ATTRIBUTE, 0);
    api.persistAttribute(SNAPE_GRASS_ATTRIBUTE, 0);
    api.persistAttribute(ADAMANTITE_ATTRIBUTE, 0);
    api.persistAttribute(TIARA_STAGE_ATTRIBUTE, 0);
    api.persistAttribute(OAK_CHOPPED_ATTRIBUTE, false);
    api.persistAttribute(KINGS_ATTRIBUTE, []);
    api.persistAttribute(GENERALS_ATTRIBUTE, []);
    api.onCustomEvent("shop:opened", onShopOpened);
    api.onCustomEvent("hunter:success", onHunterSuccess);
    api.onNpcDeath(onNpcDeath);
    api.onCustomEvent("ground-items:taken", onGroundItemsTaken);
    api.onCustomEvent("mining:success", onMiningSuccess);
    api.onCustomEvent("smelting:success", onSmeltingSuccess);
    api.onCustomEvent("crafting:made", onCraftingMade);
    api.onCustomEvent("woodcutting:success", onWoodcuttingSuccess);
    api.onCustomEvent("firemaking:success", onFiremakingSuccess);
    api.onCustomEvent("herblore:made", onHerbloreMade);
    api.onCustomEvent("thieving:success", onThievingSuccess);
    api.onZoneEnter(TROLL_STRONGHOLD_TOP, onTrollStrongholdEnter);
    api.onZoneEnter(TROLL_STRONGHOLD_CAVES, onTrollStrongholdEnter);
    api.onZoneEnter(TROLL_STRONGHOLD_PRISON, onTrollStrongholdEnter);
    api.onCustomEvent("eagle-transport:arrived", onEagleArrived);
    api.onCustomEvent("teleport:landed", onFairyRingLanded);
    api.onCustomEvent("spell:teleport-arrival", onSpellArrival);
    api.onCustomEvent("water-source:filled", onWaterSourceFilled);
    api.onCustomEvent("miscellania:approval-changed", onApprovalChanged);
    api.onCustomEvent("npc-dialogue:line", onDialogueLine);
    api.onCustomEvent("fremennik-isles:shield-made", onShieldMade);
    api.onCustomEvent("runecrafting:success", onRunecraftingSuccess);
    api.onCustomEvent("godwars:kill", onGodWarsKill);
    api.onCustomEvent("diary:task", onDiaryTask);
  },
  _test: {
    inBox, questComplete, questStarted, onShopOpened, onHunterSuccess, onNpcDeath, onGroundItemsTaken,
    onMiningSuccess, onSmeltingSuccess, onCraftingMade, onWoodcuttingSuccess, onFiremakingSuccess,
    onHerbloreMade, onThievingSuccess, onTrollStrongholdEnter, onEagleArrived, onFairyRingLanded, onSpellArrival,
    onWaterSourceFilled, onPetRockTaken, onApprovalChanged, onDialogueLine, onShieldMade,
    onRunecraftingSuccess, onGodWarsKill, onDiaryTask,
    RELLEKKA, RELLEKKA_FURNACE, RELLEKKA_WELL, FREMENNIK_PROVINCE, WATERBIRTH, KELDAGRIM,
    JATIZSO_MINE, ARZINIAN_MINE, NEITIZNOT_CLAY_FORGE,
  },
};
