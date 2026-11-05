"use strict";

/**
 * Western Provinces Diary gameplay credits (OSRS Wiki: Western Provinces Diary), from the actions
 * other plugins already complete. The catalogue is in
 * plugins/achievements/diaries/data/achievement-diaries.json; this file only says which successful
 * action completes which task.
 *
 * Everything here is credited after the qualifying action succeeds; the ordinary gnome-cooking
 * flow lives in Cooking's recipe data and Farming emits its successful gardener protection.
 */

const DIARY = "western";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

// Cache tiles (yarn dump:loc and npc-spawns.json) bound the actions that the Wiki scopes to a place.
const PISCATORIS_HUNTER = [2295, 2350, 3575, 3610, 0];
const FELDIP_HUNTER = [2535, 2580, 2875, 2915, 0];
const PISCATORIS_FALCONRY = [2360, 2400, 3570, 3595, 0];
const TERRORBIRD_ENCLOSURE = [2365, 2390, 3425, 3450, 0];
const APE_ATOLL = [2650, 2800, 2650, 2800, 0];
const PISCATORIS_COLONY = [2290, 2370, 3680, 3720, 0];
const SWAMP_TOAD_PEN = [2400, 2435, 3500, 3525, 0];
const PISCATORIS_MINE = [2332, 2345, 3634, 3646, 0];
const GRAND_TREE_MINE = [2482, 2497, 9902, 9916, 0];
const ISAFDAR_MINE = [2272, 2286, 3152, 3166, 0];
const THERMONUCLEAR_ROOM = [2351, 2378, 9438, 9461, 0];
const APE_ATOLL_TELEPORT = [2790, 2802, 2792, 2804, 0];
const LLETYA_PALM_PATCH = { x: 2346, y: 3161, z: 0 };
const PRISSY_TREE_PATCH = { x: 2435, y: 3414, z: 0 };
const GRAND_TREE_RANGE = { x: 2482, y: 3479, z: 1, radius: 6 };

const TASK = {
  copperLongtail: "catch-a-copper-longtail",
  novicePestControl: "complete-a-novice-game-of-pest-control",
  ironPiscatoris: "mine-some-iron-ore-near-piscatoris",
  chompyHat: "claim-any-chompy-bird-hat-from-rantz",
  pestControlTeleport: "teleport-to-pest-control-using-the-minigame-tele",
  swampToad: "collect-a-swamp-toad-at-the-gnome-stronghold",
  brimstailTeleport: "have-brimstail-teleport-you-to-the-essence-mine",
  terrorbird: "kill-a-terrorbird-in-the-terrorbird-enclosure",
  grandTreeShortcut: "take-the-agility-shortcut-from-the-grand-tree-to",
  spiritTree: "travel-to-the-gnome-stronghold-by-spirit-tree",
  spinedLarupia: "trap-a-spined-larupia",
  bassApeAtoll: "fish-some-bass-on-ape-atoll",
  teakApeAtoll: "chop-and-burn-some-teak-logs-on-ape-atoll",
  intermediatePestControl: "complete-an-intermediate-game-of-pest-control",
  feldipGlider: "travel-to-the-feldip-hills-by-gnome-glider",
  chompyHat125: "claim-a-chompy-bird-hat-from-rantz-after-registe",
  chocolateBomb: "make-a-chocolate-bomb-at-the-grand-tree",
  feldipEagle: "travel-from-eagles-peak-to-the-feldip-hills-by-e",
  gnomeRestaurant: "complete-a-delivery-for-the-gnome-restaurant",
  crystalSaw: "turn-your-small-crystal-seed-into-a-crystal-saw",
  goldGrandTree: "mine-some-gold-ore-underneath-the-grand-tree",
  elfCrystalBow: "kill-an-elf-with-a-crystal-bow",
  monkfishPiscatoris: "catch-and-cook-a-monkfish-in-piscatoris",
  veteranPestControl: "complete-a-veteran-game-of-pest-control",
  dashingKebbit: "catch-a-dashing-kebbit",
  mahoganyApeAtoll: "chop-and-burn-some-mahogany-logs-on-ape-atoll",
  adamantiteTirannwn: "mine-some-adamantite-ore-in-tirannwn",
  lletyaPalm: "check-the-health-of-your-palm-tree-in-lletya",
  chompyHat300: "claim-a-chompy-bird-hat-from-rantz-after-registe-2",
  isafdarPainting: "build-an-isafdar-painting-in-your-poh-quest-hall",
  zulrah: "kill-zulrah",
  apeAtollTeleport: "teleport-to-ape-atoll",
  gnomePickpocket: "pickpocket-a-gnome",
  thermonuclear: "kill-the-thermonuclear-smoke-devil-col-800000-do",
  prissyScilla: "have-prissy-scilla-protect-your-magic-tree",
  elvenOverpass: "use-the-elven-overpass-advanced-cliffside-shortc",
  voidSet: "equip-any-complete-void-set",
  chompyHat1000: "claim-a-chompy-bird-hat-from-rantz-after-registe-3",
  elfPickpocket: "pickpocket-an-elf",
};

let api;
const lastMining = new WeakMap();
const monkfishCaught = new WeakSet();
const teakChopped = new WeakSet();
const mahoganyChopped = new WeakSet();

const locationOf = (entity) => entity?.getLocation?.() ?? entity?.getPosition?.() ?? null;
const nameOf = (entity) => entity?.getCurrentDefinition?.()?.getName?.() ?? entity?.getDefinition?.()?.getName?.() ?? "";
const inBox = (at, [minX, maxX, minY, maxY, z]) => Boolean(at)
  && at.getZ() === z && at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY;
const active = (player) => player?.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.();
const done = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
const nearGrandTreeRange = (at) => Boolean(at) && at.getZ() === GRAND_TREE_RANGE.z
  && Math.abs(at.getX() - GRAND_TREE_RANGE.x) <= GRAND_TREE_RANGE.radius
  && Math.abs(at.getY() - GRAND_TREE_RANGE.y) <= GRAND_TREE_RANGE.radius;

function hunted({ player, npcId }) {
  if (!active(player)) return;
  const N = api.core.NpcIdentifiers;
  const at = player.getLocation();
  if (npcId === N.COPPER_LONGTAIL && inBox(at, PISCATORIS_HUNTER)) done(player, TASK.copperLongtail);
  else if (npcId === N.SPINED_LARUPIA && inBox(at, FELDIP_HUNTER)) done(player, TASK.spinedLarupia);
  else if (npcId === N.DASHING_KEBBIT && inBox(at, PISCATORIS_FALCONRY)) done(player, TASK.dashingKebbit);
}

function pestControlWon({ player, boat }) {
  if (!active(player)) return;
  if (boat === "novice") done(player, TASK.novicePestControl);
  else if (boat === "intermediate") done(player, TASK.intermediatePestControl);
  else if (boat === "veteran") done(player, TASK.veteranPestControl);
}

function minigameTeleported({ player, minigame }) {
  if (active(player) && minigame === "Pest Control") done(player, TASK.pestControlTeleport);
}

function spiritTreeTravelled({ player, tree }) {
  if (active(player) && tree === "Gnome Stronghold") done(player, TASK.spiritTree);
}

function gliderArrived({ player, destination }) {
  if (active(player) && destination?.area === "Feldip Hills") done(player, TASK.feldipGlider);
}

function eagleArrived({ player, to }) {
  if (!active(player) || !Array.isArray(to)) return;
  if (to[0] === 2520 && to[1] === 9325 && (to[2] ?? 0) === 0) done(player, TASK.feldipEagle);
}

function farmingChecked({ player, type, crop, patch }) {
  if (!active(player) || type !== "FRUIT_TREE" || crop !== "PALM" || !patch) return;
  if (patch.x === LLETYA_PALM_PATCH.x && patch.y === LLETYA_PALM_PATCH.y && patch.z === LLETYA_PALM_PATCH.z) {
    done(player, TASK.lletyaPalm);
  }
}

function farmingProtected({ player, npc, patch, crop }) {
  if (!active(player) || crop !== "MAGIC" || nameOf(npc) !== "Prissy Scilla" || !patch) return;
  if (patch.x === PRISSY_TREE_PATCH.x && patch.y === PRISSY_TREE_PATCH.y && patch.z === PRISSY_TREE_PATCH.z) {
    done(player, TASK.prissyScilla);
  }
}

function teleported({ player, to }) {
  if (active(player) && inBox(to, APE_ATOLL_TELEPORT)) done(player, TASK.apeAtollTeleport);
}

function thieved({ player, method, target }) {
  if (!active(player) || method !== "pickpocket") return;
  if (target === "gnome") done(player, TASK.gnomePickpocket);
  else if (target === "elf") done(player, TASK.elfPickpocket);
}

function itemName(itemId) {
  if (!Number.isInteger(itemId) || itemId <= 0) return "";
  return api.core.CacheDefinitions.getItem(itemId)?.name?.toLowerCase?.() ?? "";
}

function equipmentChanged({ player }) {
  if (!active(player)) return;
  const equipment = player.getEquipment?.();
  const items = equipment?.getItems?.() ?? [];
  const { HEAD_SLOT, BODY_SLOT, LEG_SLOT, HANDS_SLOT } = api.core.Equipment;
  const head = itemName(items[HEAD_SLOT]?.getId?.());
  const body = itemName(items[BODY_SLOT]?.getId?.());
  const legs = itemName(items[LEG_SLOT]?.getId?.());
  const hands = itemName(items[HANDS_SLOT]?.getId?.());
  if (/^void (melee|ranger|mage) helm/.test(head)
    && /^(elite )?void (knight )?top/.test(body)
    && /^(elite )?void (knight )?robe/.test(legs)
    && /^void knight gloves/.test(hands)) done(player, TASK.voidSet);
}

function npcKilled({ killer, npc }) {
  if (!active(killer)) return;
  const name = nameOf(npc);
  const at = npc.getLocation?.();
  if (name === "Thermonuclear smoke devil" && inBox(at, THERMONUCLEAR_ROOM)) {
    done(killer, TASK.thermonuclear);
  } else if (name === "Terrorbird" && inBox(at, TERRORBIRD_ENCLOSURE)) {
    done(killer, TASK.terrorbird);
  } else if (name === "Elf Warrior" || name === "Elf Archer") {
    const weaponId = killer.getEquipment?.()?.get?.(api.core.Equipment.WEAPON_SLOT)?.getId?.();
    if (/crystal bow|bow of faerdhinen/.test(itemName(weaponId))) done(killer, TASK.elfCrystalBow);
  }
}

function oreAttempt({ player, object, success }) {
  if (success && player && object) lastMining.set(player, { object });
}

function oreMined({ player, itemId }) {
  if (!active(player)) return;
  const attempt = lastMining.get(player);
  lastMining.delete(player);
  const at = locationOf(attempt?.object);
  const I = api.core.ItemIdentifiers;
  if (itemId === I.IRON_ORE && inBox(at, PISCATORIS_MINE)) done(player, TASK.ironPiscatoris);
  else if (itemId === I.GOLD_ORE && inBox(at, GRAND_TREE_MINE)) done(player, TASK.goldGrandTree);
  else if (itemId === I.ADAMANTITE_ORE && inBox(at, ISAFDAR_MINE)) done(player, TASK.adamantiteTirannwn);
}

function fished({ player, itemId }) {
  if (!active(player)) return;
  const at = player.getLocation();
  const I = api.core.ItemIdentifiers;
  if (itemId === I.RAW_BASS && inBox(at, APE_ATOLL)) done(player, TASK.bassApeAtoll);
  else if (itemId === I.RAW_MONKFISH && inBox(at, PISCATORIS_COLONY) && !monkfishCaught.has(player)) {
    monkfishCaught.add(player);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.monkfishPiscatoris);
  }
}

function cooked({ player, itemId }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.MONKFISH || !monkfishCaught.has(player)) return;
  if (!inBox(player.getLocation(), PISCATORIS_COLONY)) return;
  monkfishCaught.delete(player);
  done(player, TASK.monkfishPiscatoris);
}

function produced({ player, itemId }) {
  if (active(player) && itemId === api.core.ItemIdentifiers.CHOCOLATE_BOMB && nearGrandTreeRange(player.getLocation())) {
    done(player, TASK.chocolateBomb);
  }
}

function chopped({ player, logId }) {
  if (!active(player) || !inBox(player.getLocation(), APE_ATOLL)) return;
  const I = api.core.ItemIdentifiers;
  if (logId === I.TEAK_LOGS && !teakChopped.has(player)) {
    teakChopped.add(player);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.teakApeAtoll);
  } else if (logId === I.MAHOGANY_LOGS && !mahoganyChopped.has(player)) {
    mahoganyChopped.add(player);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.mahoganyApeAtoll);
  }
}

/** Only a newly completed task resets the ordered chop-then-burn pair; repeats and rejected events do not. */
function diaryProgress({ player, completed }) {
  if (completed !== true) return;
  teakChopped.delete(player);
  mahoganyChopped.delete(player);
}

function burnt({ player, itemId }) {
  if (!active(player) || !inBox(player.getLocation(), APE_ATOLL)) return;
  const I = api.core.ItemIdentifiers;
  if (itemId === I.TEAK_LOGS && teakChopped.has(player)) {
    teakChopped.delete(player);
    done(player, TASK.teakApeAtoll);
  } else if (itemId === I.MAHOGANY_LOGS && mahoganyChopped.has(player)) {
    mahoganyChopped.delete(player);
    done(player, TASK.mahoganyApeAtoll);
  }
}

function itemTaken({ player, itemId, groundItem }) {
  if (!active(player) || itemId !== api.core.ItemIdentifiers.SWAMP_TOAD) return;
  if (inBox(locationOf(groundItem), SWAMP_TOAD_PEN)) done(player, TASK.swampToad);
}

function chompyHatClaimed({ player, kills }) {
  if (!active(player)) return;
  done(player, TASK.chompyHat);
  if (kills >= 125) done(player, TASK.chompyHat125);
  if (kills >= 300) done(player, TASK.chompyHat300);
  if (kills >= 1000) done(player, TASK.chompyHat1000);
}

function obstacleCompleted({ player, shortcut }) {
  if (!active(player)) return;
  if (shortcut === "Rocks (Tree Gnome Stronghold, down)") done(player, TASK.grandTreeShortcut);
  else if (shortcut === "Rocks (Tirannwn advanced)") done(player, TASK.elvenOverpass);
}

function furnitureBuilt({ player, buildable }) {
  if (active(player) && buildable?.key === "ISAFDAR_LANDSCAPE") done(player, TASK.isafdarPainting);
}

function gnomeRestaurantDelivered({ player }) {
  if (active(player)) done(player, TASK.gnomeRestaurant);
}

function crystalSawMade({ player }) {
  if (active(player)) done(player, TASK.crystalSaw);
}

function brimstailTeleported({ player }) {
  if (active(player)) done(player, TASK.brimstailTeleport);
}

function bossKilled({ player, monster }) {
  if (active(player) && monster === "Zulrah") done(player, TASK.zulrah);
}

module.exports = {
  name: "WesternProvincesDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onCustomEvent("hunter:success", hunted);
    api.onCustomEvent("pest-control:won", pestControlWon);
    api.onCustomEvent("minigame-teleport:arrived", minigameTeleported);
    api.onCustomEvent("spirit-trees:travelled", spiritTreeTravelled);
    api.onCustomEvent("gnome-gliders:arrived", gliderArrived);
    api.onCustomEvent("eagle-transport:arrived", eagleArrived);
    api.onCustomEvent("farming:check-health", farmingChecked);
    api.onCustomEvent("farming:protected", farmingProtected);
    api.onCustomEvent("teleport:landed", teleported);
    api.onCustomEvent("thieving:success", thieved);
    api.onCustomEvent("equipment:changed", equipmentChanged);
    api.onCustomEvent("mining:attempt", oreAttempt);
    api.onCustomEvent("mining:success", oreMined);
    api.onCustomEvent("fishing:success", fished);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("skills:produced", produced);
    api.onCustomEvent("diary:task", diaryProgress);
    api.onCustomEvent("woodcutting:success", chopped);
    api.onCustomEvent("firemaking:success", burnt);
    api.onCustomEvent("ground-items:taken", itemTaken);
    api.onCustomEvent("big-chompy-bird-hunting:hat-claimed", chompyHatClaimed);
    api.onCustomEvent("agility:obstacle", obstacleCompleted);
    api.onCustomEvent("construction:furniture-built", furnitureBuilt);
    api.onCustomEvent("gnome-restaurant:delivered", gnomeRestaurantDelivered);
    api.onCustomEvent("crystal-saw:made", crystalSawMade);
    api.onCustomEvent("runecrafting:brimstail-essence", brimstailTeleported);
    api.onCustomEvent("combat-achievements:kill", bossKilled);
    api.onNpcDeath(npcKilled);
  },
  _test: { TASK, hunted, pestControlWon, gliderArrived, eagleArrived, oreAttempt, oreMined, fished, cooked, chopped, burnt, itemTaken, chompyHatClaimed, obstacleCompleted, npcKilled, equipmentChanged, thieved, teleported },
};
