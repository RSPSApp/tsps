/**
 * Morytania diary tasks that follow successful native gameplay actions. Catalogue keys are in
 * data/achievement-diaries.json; the Wiki page (https://oldschool.runescape.wiki/w/Morytania_Diary)
 * gives each task's location, item and requirement. Every handler here checks the same thing the
 * Wiki asks for (the skill action, then the place, item or NPC) before it emits `diary:task`.
 *
 * Producers that already emit a generic event are consumed as they are; a few actions had no
 * event, so the small emit that follows them is in the module that owns the action (cooking's
 * object, tanning, the farming patch, the ectophial landing, a POH portal, the Barrows chest and
 * the shade pyre's wood). Those emits describe the action, not the diary.
 */
const DIARY = "morytania";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const MAHOGANY_ATTRIBUTE = "morytania-diary:mahogany-chopped";

/** Skill requirement for the Morytania advanced spike chain (Wiki). */
const ADVANCED_SPIKE_CHAIN = { shortcut: "Spikey chain (Slayer Tower)", x: 3447, y: 3576 };
/** Nature Grotto's altar, "Altar of nature" (cache loc 3521), where the nature tasks are done. */
const NATURE_GROTTO_ALTAR = { x: 3441, y: 9740, z: 1 };
/** Mazchna's master id in plugins/skills/data/slayer-masters.json. */
const MAZCHNA_MASTER_ID = 2;
/** Port Phasmatys objects (cache loc dumps): the town's range and furnace. */
const PORT_PHASMATYS_RANGE = { id: 16641, x: 3676, y: 3467 };
const PORT_PHASMATYS_FURNACE = { x: 3688, y: 3478 };
/** Mort Myre Swamp, from NatureSpirit's Boundary (3380, 3590, 3310, 3480, 0). */
const SWAMP = { minX: 3380, maxX: 3590, minY: 3310, maxY: 3480, z: 0 };
/** Canifis bank, whose booths are on x=3513, y=3478-3483. */
const CANIFIS_BANK = { minX: 3504, maxX: 3515, minY: 3474, maxY: 3490 };
/** The Slayer Tower's two floors (data/slayer-areas.json area 9). */
const SLAYER_TOWER = [
  { minX: 3400, maxX: 3450, minY: 3530, maxY: 3580 },
  { minX: 3400, maxX: 3450, minY: 9930, maxY: 9980 },
];
/** Braindeath Island's Fever spiders (npc-spawns.json: 2140-2150, 5093-5103). */
const BRAINDEATH = { minX: 2100, maxX: 2200, minY: 5050, maxY: 5150 };
/** Mos Le'Harmless (Jungle horror spawns and the charter landing, 3671,2931). */
const MOS_LE_HARMLESS = { minX: 3650, maxX: 3800, minY: 2930, maxY: 3070 };
/** The Abandoned Mine's mithril rocks (cache loc dump: 3032-3052, 9714-9739). */
const ABANDONED_MINE = { minX: 3020, maxX: 3060, minY: 9700, maxY: 9750 };
/** Farming patches (plugins/skills/data/farming-data.json). */
const CANIFIS_MUSHROOM_PATCH = 8337;
const MORYTANIA_FLOWER_PATCH = 7850;
const MORYTANIA_HERB_PATCH = 8153;
const HARMONY_ALLOTMENT_PATCH = 21950;
/** Barrows brothers' equipment names all start with one of these. */
const BARROWS_SETS = ["Ahrim's", "Dharok's", "Guthan's", "Karil's", "Torag's", "Verac's"];
const PIETY = 26; // PrayerHandler.PIETY

let api = null;
// Human forms retain their individual cache names when wielding Wolfbane.
const HUMAN_FORM_WEREWOLVES = new Set([
  "Boris", "Imre", "Yuri", "Joseph", "Nikolai", "Eduard", "Lev", "Georgy",
  "Svetlana", "Irina", "Alexis", "Milla", "Galina", "Sofiya", "Ksenia",
  "Yadviga", "Nikita", "Vera", "Zoja", "Liliya",
]);

const emit = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });

function inside(location, box) {
  if (!location) return false;
  const z = location.getZ?.() ?? location.z;
  if (box.z !== undefined && z !== box.z) return false;
  const x = location.getX?.() ?? location.x;
  const y = location.getY?.() ?? location.y;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

const inAny = (location, boxes) => boxes.some((box) => inside(location, box));
const inSlayerTower = (location) => inAny(location, SLAYER_TOWER);
const at = (player) => player.getLocation();

function near(player, point, distance = 3) {
  const location = at(player);
  return Math.abs(location.getX() - point.x) <= distance && Math.abs(location.getY() - point.y) <= distance;
}

// ---------------------------------------------------------------- easy

/** Cook a thin Snail on the Port Phasmatys range. */
function cooked({ player, itemId, objectId }) {
  if (itemId !== api.core.ItemIdentifiers.THIN_SNAIL_MEAT) return;
  if (objectId !== PORT_PHASMATYS_RANGE.id) return;
  emit(player, "cook-a-thin-snail-on-the-port-phasmatys-range");
}

/** Get a slayer task from the Slayer Master in Canifis (Mazchna, or Achtryn his replacement). */
function assigned({ player, master }) {
  if (master !== MAZCHNA_MASTER_ID) return;
  emit(player, "get-a-slayer-task-from-the-slayer-master-in-cani");
}

/** Have Sbott in Canifis tan something for you. */
function tanned({ player, tanner }) {
  if (tanner !== "Sbott") return;
  emit(player, "have-sbott-in-canifis-tan-something-for-you");
}

/** Offer some bonemeal at the Ectofuntus. */
function worshipped({ player }) {
  emit(player, "offer-some-bonemeal-at-the-ectofuntus");
}

/** The swamp's existing Area reports entry after the player crosses its boundary. */
function swampEntered({ player }) {
  emit(player, "enter-mort-myre-swamp");
}

function mapSquare({ player, location }) {
  if (inside(location, SWAMP)) emit(player, "enter-mort-myre-swamp");
}

function login({ player }) {
  if (inside(at(player), SWAMP)) emit(player, "enter-mort-myre-swamp");
}

/** Place a Scarecrow in the Morytania flower patch. */
function scarecrow({ player, patch }) {
  if (patch?.id === MORYTANIA_FLOWER_PATCH) emit(player, "place-a-scarecrow-in-the-morytania-flower-patch");
}

/** The nature altar restores Prayer; the hard task also needs Piety active. */
function natureAltar({ player }) {
  emit(player, "restore-your-prayer-points-at-the-nature-altar");
  if (player.getPrayerActive?.()?.[PIETY] === true) {
    emit(player, "pray-at-the-altar-of-nature-with-piety-activated");
  }
}

// ---------------------------------------------------------------- medium

/** Catch a swamp lizard. */
function hunted({ player, npcId, method }) {
  if (method !== "swamp" || npcId !== api.core.NpcIdentifiers.SWAMP_LIZARD) return;
  emit(player, "catch-a-swamp-lizard");
}

/** Obtain some Bark from a Hollow tree. */
function chopped({ player, logId, logAmount }) {
  if (logAmount === 0) return;
  const I = api.core.ItemIdentifiers;
  if (logId === I.BARK) emit(player, "obtain-some-bark-from-a-hollow-tree");
  if (logId === I.MAHOGANY_LOGS && inside(at(player), MOS_LE_HARMLESS)) {
    if (player.getAttribute(MAHOGANY_ATTRIBUTE) !== true) {
      player.setAttribute(MAHOGANY_ATTRIBUTE, true);
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, "chop-and-burn-some-mahogany-logs-on-mos-le-harml");
    }
  }
}

/** Chop and burn some mahogany logs on Mos Le'Harmless: the chop must come first. */
function burned({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.MAHOGANY_LOGS) return;
  if (!inside(at(player), MOS_LE_HARMLESS) || player.getAttribute(MAHOGANY_ATTRIBUTE) !== true) return;
  player.setAttribute(MAHOGANY_ATTRIBUTE, false);
  emit(player, "chop-and-burn-some-mahogany-logs-on-mos-le-harml");
}

/** Make a batch of steel cannonballs at the Port Phasmatys furnace. */
function smithed({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.STEEL_CANNONBALL) return;
  if (!near(player, PORT_PHASMATYS_FURNACE, 4)) return;
  emit(player, "make-a-batch-of-steel-cannonballs-at-the-port-ph");
}

/** Use an ectophial to return to Port Phasmatys: the landing by the Ectofuntus. */
function ectophialLanding({ player }) {
  const location = at(player);
  if (location.getZ() !== 0 || location.getY() !== 3522) return;
  if (location.getX() < 3658 || location.getX() > 3661) return;
  emit(player, "use-an-ectophial-to-return-to-port-phasmatys");
}

// ---------------------------------------------------------------- hard

/** Enter the Kharyrll portal in your POH (a directed portal or the portal nexus). */
function housePortal({ player, destination }) {
  if (destination !== "kharyrll teleport" && destination !== "kharyrll") return;
  emit(player, "enter-the-kharyrll-portal-in-your-poh");
}

/** Climb the advanced spike chain (the level 71 chain at 3447,3576), not the basic one. */
function shortcut({ player, location, shortcut: name }) {
  if (name !== ADVANCED_SPIKE_CHAIN.shortcut) return;
  if (location?.x !== ADVANCED_SPIKE_CHAIN.x || location?.y !== ADVANCED_SPIKE_CHAIN.y) return;
  emit(player, "climb-the-advanced-spike-chain-within-slayer-tow");
}

function salveShortcut({ player, shortcut: name }) {
  if (name !== "Rocks (Mort Myre, down)") return;
  emit(player, "use-the-shortcut-to-get-to-the-bridge-over-the-s");
}

/** Harvest watermelon on Harmony Island or bittercap mushrooms in Canifis. */
function harvested({ player, crop, patch }) {
  if (crop === "WATERMELON" && patch?.id === HARMONY_ALLOTMENT_PATCH) {
    emit(player, "harvest-some-watermelon-from-the-allotment-patch");
  }
  if (crop === "MUSHROOM" && patch?.id === CANIFIS_MUSHROOM_PATCH) {
    emit(player, "harvest-some-bittercap-mushrooms-from-the-patch");
  }
}

/** Fertilize the Morytania herb patch with Lunar Magic's Fertile Soil. */
function fertilized({ player, patch, spell }) {
  if (spell !== "fertile soil" || patch?.id !== MORYTANIA_HERB_PATCH) return;
  emit(player, "fertilize-the-morytania-herb-patch-using-lunar-m");
}

/** Mine some Mithril ore in the Abandoned Mine. */
function mined({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.MITHRIL_ORE) return;
  if (!inside(at(player), ABANDONED_MINE)) return;
  emit(player, "mine-some-mithril-ore-in-the-abandoned-mine");
}

// ---------------------------------------------------------------- elite

/** Cremate shade remains on magic or redwood pyre logs. */
function cremated({ player, wood }) {
  if (wood !== "magic" && wood !== "redwood") return;
  emit(player, "cremate-any-shade-remains-on-a-magic-or-redwood");
}

/** Craft a black dragonhide body in Canifis bank. */
function crafted({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.BLACK_DHIDE_BODY) return;
  if (!inside(at(player), CANIFIS_BANK)) return;
  emit(player, "craft-a-black-dragonhide-body-in-canifis-bank");
}

function fullBarrowsSet(player) {
  const names = player.getEquipment().getItems().map((item) => item?.getDefinition?.()?.getName?.() ?? "");
  return BARROWS_SETS.some((set) => names.filter((name) => name.startsWith(set)).length >= 4);
}

/** Loot the Barrows chest wearing a complete set (all four pieces, weapon included). */
function barrowsChest({ player }) {
  if (!fullBarrowsSet(player)) return;
  emit(player, "loot-the-barrows-chest-while-wearing-any-complet");
}

// ---------------------------------------------------------------- kills

const KILL_TASKS = {
  Banshee: ["kill-a-banshee-in-the-slayer-tower", inSlayerTower],
  Ghoul: ["kill-a-ghoul"],
  "Terror dog": ["kill-a-terror-dog"],
  "Fever spider": ["kill-a-fever-spider-on-braindeath-island", (location) => inside(location, BRAINDEATH)],
  "Cave horror": ["kill-a-cave-horror"],
  "Abyssal demon": ["kill-an-abyssal-demon-in-the-slayer-tower", inSlayerTower],
};

function killed({ killer, npc, npcId, location }) {
  if (!killer?.isPlayer?.()) return;
  const name = npc?.getCurrentDefinition?.(killer)?.getName?.() ?? npc?.getCurrentDefinition?.()?.getName?.();
  const task = KILL_TASKS[name];
  if (task) {
    const [key, check] = task;
    if (!check || check(location)) emit(killer, key);
  }
  if (HUMAN_FORM_WEREWOLVES.has(name) && usesWolfbane(killer)) {
    emit(killer, "kill-a-werewolf-in-its-human-form-using-the-wolf");
  }
}

function usesWolfbane(player) {
  const I = api.core.ItemIdentifiers;
  const weapon = player.getEquipment?.().get?.(api.core.Equipment.WEAPON_SLOT)?.getId?.();
  return weapon === I.WOLFBANE || weapon === I.WOLFBANE_2;
}

module.exports = function attachMorytania(pluginApi) {
  api = pluginApi;
  const persist = api.persistAttribute ?? (() => {});
  persist(MAHOGANY_ATTRIBUTE, false);

  api.onCustomEvent("cooking:success", cooked);
  api.onCustomEvent("slayer:task-assigned", assigned);
  api.onCustomEvent("tanning:done", tanned);
  api.onCustomEvent("ectofuntus:worshipped", worshipped);
  api.onCustomEvent("mort-myre:entered", swampEntered);
  api.onCustomEvent("farming:scarecrow", scarecrow);
  api.onCustomEvent("farming:spell-fertilized", fertilized);
  api.onCustomEvent("farming:harvested", harvested);
  api.onCustomEvent("hunter:success", hunted);
  api.onCustomEvent("woodcutting:success", chopped);
  api.onCustomEvent("firemaking:success", burned);
  api.onCustomEvent("smithing:success", smithed);
  api.onCustomEvent("ectophial:arrived", ectophialLanding);
  api.onCustomEvent("construction:portal", housePortal);
  api.onCustomEvent("agility:obstacle", shortcut);
  api.onCustomEvent("agility:obstacle", salveShortcut);
  api.onCustomEvent("mining:success", mined);
  api.onCustomEvent("shades-of-mortton:cremated", cremated);
  api.onCustomEvent("crafting:made", crafted);
  api.onCustomEvent("barrows:chest-looted", barrowsChest);
  api.onCustomEvent("altar:nature", natureAltar);
  api.onPlayerMapSquareChange(mapSquare);
  api.onPlayerLogin(login);
  api.onNpcDeath(killed);
};

Object.assign(module.exports, {
  MAHOGANY_ATTRIBUTE, natureAltar, killed, shortcut, salveShortcut, fullBarrowsSet,
});
