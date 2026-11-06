"use strict";

/**
 * Kandarin Diary tasks whose normal gameplay was absent from the first credit pass
 * (https://oldschool.runescape.wiki/w/Kandarin_Diary).
 *
 * The catalogue and progress dispatch live in AchievementDiaries; KandarinDiary credits the
 * actions other plugins already perform. This file supplies the actions still missing and
 * credits each task only after the source-backed qualifying action succeeds.
 *
 * Ordered tasks follow the Wiki's "completing or updating any other task in-between these steps
 * will reset the progress" rule: a pending sequence is dropped only when AchievementDiaries
 * marks another task as newly completed. Repeated, rejected and private attempts leave it
 * intact; this plugin's own credit clears its sequence before that event arrives.
 */

const DIARY = "kandarin";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

const TASK = {
  candle: "buy-a-candle-from-the-chandler-in-catherby",
  petFish: "get-a-pet-fish-from-harry-in-catherby",
  stew: "buy-a-stew-from-the-seers-pub",
  superAntipoison: "create-a-super-antipoison-potion-from-scratch-in",
  waterObelisk: "use-the-grapple-shortcut-to-get-from-the-water-o",
  bass: "catch-and-cook-a-bass-in-catherby",
  hemensterChest: "steal-from-the-chest-in-hemenster",
  yewLongbow: "create-a-yew-longbow-from-scratch-around-seers-v",
  bowFiremaking: "burn-some-maple-logs-with-a-bow-in-seers-village",
  graniteBody: "purchase-and-equip-a-granite-body-from-barbarian",
  estateAgent: "have-the-seers-estate-agent-decorate-your-house",
  blackboard: "read-the-blackboard-at-barbarian-assault-after-r",
  sharks: "fish-and-cook-5-sharks-in-catherby-using-the-coo",
  staminaMix: "mix-a-stamina-mix-on-top-of-the-seers-village-ba",
  pyreShip: "construct-a-pyre-ship-from-magic-logs-col-800000",
  courthouse: "enter-the-seers-village-courthouse-with-piety-tu",
};

// Cache tiles (yarn dump:loc and the Wiki's locations) scope the actions.
const CATHERBY = { minX: 2810, maxX: 2870, minY: 3410, maxY: 3460, z: 0 };
const SEERS_VILLAGE = { minX: 2670, maxX: 2780, minY: 3430, maxY: 3530, z: 0 };
const SEERS_BANK_ROOF = { minX: 2720, maxX: 2732, minY: 3486, maxY: 3495, z: 3 };
const WATER_OBELISK_SHORE = { x: 2840, y: 3434, z: 0 };
const HEMENSTER_CHEST = { x: 2639, y: 3424, z: 0 };
const SEERS_AGENT = { x: 2737, y: 3502, z: 0, radius: 4 };
const BA_BLACKBOARD = [20134];
const HEMENSTER_CHEST_ID = 11742;
const AQUARIUM = "Aquarium";
const AQUARIUM_ID = 10091;
const CANDLE_SHOP = "Candle Shop";

const FANCY_STONE_STYLE = "Fancy stone";
const SEERS_AGENT_ATTRIBUTE = "kandarin-diary:seers-agent-style";

const GRANITE_BODY = 10564;
const COOKING_GAUNTLETS = 775;
const CANDLE = 36;
const STEW = 2003;
const RAW_BASS = 363;
const BASS = 365;
const RAW_SHARK = 383;
const SHARK = 385;
const YEW_LOGS = 1515;
const MAPLE_LOGS = 1517;
const MAGIC_LOGS = 1513;
const CHEWED_BONES = 11338;
const YEW_LONGBOW_U = 66;
const YEW_LONGBOW = 855;
const BOW_STRING = 1777;
const IRIT_POTION_UNF = 101;
const SUPERANTIPOISON_3 = 181;
const STAMINA_POTION_2 = 12629;
const STAMINA_MIX_2 = 12633;
const CAVIAR = 11326;
const TINY_NET = 6674;
const FISHBOWL_WATER_SEAWEED = 6669;
const PET_FISH_IDS = [6670, 6671, 6672];
const SEERS_BANK_TOP = { minX: 2720, maxX: 2732, minY: 3486, maxY: 3495, z: 3 };
// Cache walls 38848 at x=2730/2741,y=3463..3474; doors 25825/25827 at 2735/2736,3472.
const SEERS_COURTHOUSE = { minX: 2731, maxX: 2740, minY: 3464, maxY: 3473, z: 0 };
const STEW_COST = 20;
const GRANITE_BODY_COST = 95000;
const SUPERANTIPOISON_LEVEL = 48;
const YEW_LONGBOW_LEVEL = 70;
const SHARKS_REQUIRED = 5;

const BA_SHOP_ID = 1427;

let api;
let core;
let candleShopId = null;

const pending = new WeakMap();
/** Chest relock: the Wiki's 90 seconds, kept per player to stop repeat loot. */
const chestLooted = new WeakMap();
const CHEST_RELOCK_MS = 90_000;

function state(player) {
  let value = pending.get(player);
  if (!value) {
    value = {};
    pending.set(player, value);
  }
  return value;
}

function active(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.();
}

function inBox(location, box) {
  return Boolean(location)
    && location.getX() >= box.minX && location.getX() <= box.maxX
    && location.getY() >= box.minY && location.getY() <= box.maxY
    && location.getZ() === box.z;
}

function near(location, point) {
  return Boolean(location) && location.getZ() === point.z
    && Math.abs(location.getX() - point.x) <= point.radius
    && Math.abs(location.getY() - point.y) <= point.radius;
}

function credit(player, task) {
  if (!active(player)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

/** Only a newly completed task resets the ordered sequences; repeats and rejected events do not. */
function diaryProgress({ player, completed }) {
  if (completed !== true) return;
  pending.delete(player);
}

function wearsGauntlets(player) {
  return player.getEquipment?.().get(core.Equipment.HANDS_SLOT)?.getId?.() === COOKING_GAUNTLETS;
}

function resolveCandleShop() {
  if (candleShopId !== null) return candleShopId;
  const shop = core.ShopDefinition?.all?.().find((definition) => definition.getName?.() === CANDLE_SHOP);
  candleShopId = shop?.getId?.() ?? -1;
  return candleShopId;
}

// ---------------------------------------------------------------- candle / shop

function openCandleShop(event) {
  if (event.handled || event.action !== "open_interface" || event.target !== CANDLE_SHOP) return;
  const shopId = resolveCandleShop();
  if (shopId < 0) return;
  // Ending this action closes the chatbox, which also closes any shop opened under it.
  // Answer the dialogue now and open the shop once the close has settled.
  event.handled = true;
  event.end = true;
  const { player } = event;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1); }
    execute() {
      this.stop();
      if (player.isRegistered?.() && player.getInterfaceId?.() === -1) core.ShopManager.open(player, shopId, true);
    }
  })());
}

function candlePurchased({ player, shopId, itemId }) {
  if (itemId !== CANDLE || shopId !== resolveCandleShop()) return;
  credit(player, TASK.candle);
}

// ---------------------------------------------------------------- Harry and the pet fish

function harryDialogue(event) {
  if (event.handled || !event.player) return;
  if (!(event.pages ?? []).some((entry) => entry.page === "Harry")) return;
  if (event.action !== "receive" || event.stepId !== "2WT853") return;

  const inventory = event.player.getInventory();
  if (!inventory.contains(TINY_NET)) {
    if (inventory.getAmount(core.ItemIdentifiers.COINS) < 10) {
      event.player.sendMessage("You need 10 coins to buy a tiny net.");
      event.handled = true;
      event.end = true;
      return;
    }
    if (inventory.isFull()) {
      event.player.sendMessage("You need a free inventory slot for the tiny net.");
      event.handled = true;
      event.end = true;
      return;
    }
    inventory.deleteNumber(core.ItemIdentifiers.COINS, 10);
    inventory.adds(TINY_NET, 1);
  }
  event.handled = true;
}

/** Aquarium (id 10091) "Fish-in": Wiki Fishbowl (pet), 10 Fishing, 1 xp, tiny net, bowl with seaweed. */
function fishPet(event) {
  const { player } = event;
  if (!active(player) || event.objectId !== AQUARIUM_ID) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(TINY_NET)) {
    player.sendMessage("You need a tiny net to catch a pet fish.");
    return true;
  }
  if (!inventory.contains(FISHBOWL_WATER_SEAWEED)) {
    player.sendMessage("You need a fishbowl with water and seaweed in it.");
    return true;
  }
  if (player.getSkillManager().getCurrentLevel(core.Skill.FISHING) < 10) {
    player.sendMessage("You need a Fishing level of at least 10 to catch a pet fish.");
    return true;
  }
  // Wiki: the type depends on Fishing level (spinefish needs 70). Exact low-level weights are
  // not published; bluefish/greenfish split evenly until the spinefish becomes available.
  const level = player.getSkillManager().getCurrentLevel(core.Skill.FISHING);
  const roll = Math.random();
  const petId = level >= 70
    ? roll < 0.4 ? PET_FISH_IDS[0] : roll < 0.8 ? PET_FISH_IDS[1] : PET_FISH_IDS[2]
    : roll < 0.5 ? PET_FISH_IDS[0] : PET_FISH_IDS[1];
  inventory.deleteNumber(FISHBOWL_WATER_SEAWEED, 1);
  inventory.adds(petId, 1);
  player.getSkillManager().addExperiences(core.Skill.FISHING, 1);
  credit(player, TASK.petFish);
  return true;
}

// ---------------------------------------------------------------- Seers' pub

const FORESTER_ARMS = "Bartender (Forester's Arms)";
const FOOD = new Map([
  ["vK7RXN", { cost: STEW_COST, item: STEW, receive: "EKnotq" }],
  ["V1d7Na", { cost: 16, item: 2332, receive: "Y4aArb" }], // meat pie
  ["jEvkgA", { cost: 2, item: 1917, receive: "4KV5Yt" }], // beer
]);

function foresterArms(event) {
  if (event.handled || !event.player) return;
  if (!(event.pages ?? []).some((entry) => entry.page === FORESTER_ARMS)) return;
  const byGive = FOOD.get(event.stepId);
  const byReceive = [...FOOD.values()].find((entry) => entry.receive === event.stepId);
  const food = event.action === "give" ? byGive : byReceive;
  if (!food) return;

  if (event.action === "give") {
    const inventory = event.player.getInventory();
    const coins = inventory.getAmount(core.ItemIdentifiers.COINS);
    if (coins < food.cost) {
      event.player.sendMessage("You don't have enough coins.");
      event.handled = true;
      event.end = true;
      return;
    }
    if (inventory.getFreeSlots() + (coins === food.cost ? 1 : 0) < 1) {
      event.player.sendMessage("You need a free inventory slot.");
      event.handled = true;
      event.end = true;
      return;
    }
    inventory.deleteNumber(core.ItemIdentifiers.COINS, food.cost);
    event.handled = true;
  } else if (event.action === "receive") {
    event.player.getInventory().adds(food.item, 1);
    if (food.item === STEW) credit(event.player, TASK.stew);
    event.handled = true;
  }
}

// ---------------------------------------------------------------- ordered skill tasks

function fishingSuccess({ player, itemId }) {
  if (!active(player) || player.getPrivateArea?.() != null) return;
  const at = player.getLocation();
  if (!inBox(at, CATHERBY)) return;
  const s = state(player);
  if (itemId === RAW_BASS && !s.bass) {
    s.bass = true;
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.bass);
  } else if (itemId === RAW_SHARK && (s.sharks ?? 0) < SHARKS_REQUIRED) {
    s.sharks = (s.sharks ?? 0) + 1;
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.sharks);
  }
}

function cookingSuccess({ player, itemId }) {
  if (!active(player) || player.getPrivateArea?.() != null) return;
  const at = player.getLocation();
  if (!inBox(at, CATHERBY)) return;
  const s = state(player);
  if (itemId === BASS && s.bass) {
    delete s.bass;
    credit(player, TASK.bass);
  } else if (itemId === SHARK && wearsGauntlets(player) && (s.sharks ?? 0) > 0) {
    s.sharks -= 1;
    s.sharkCooks = (s.sharkCooks ?? 0) + 1;
    if (s.sharkCooks >= SHARKS_REQUIRED) {
      delete s.sharks;
      delete s.sharkCooks;
      credit(player, TASK.sharks);
    } else DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.sharks);
  }
}

function woodcuttingSuccess({ player, logId }) {
  if (!active(player) || logId !== YEW_LOGS || !inBox(player.getLocation(), SEERS_VILLAGE)) return;
  const s = state(player);
  if (!s.yewLogs) {
    s.yewLogs = true;
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.yewLongbow);
  }
}

function fletchingMade({ player, itemId }) {
  if (!active(player) || !inBox(player.getLocation(), SEERS_VILLAGE)) return;
  const s = state(player);
  if (itemId === YEW_LONGBOW_U && s.yewLogs) {
    s.yewUnstrung = true;
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.yewLongbow);
  } else if (itemId === YEW_LONGBOW && s.yewUnstrung) {
    delete s.yewLogs;
    delete s.yewUnstrung;
    credit(player, TASK.yewLongbow);
  }
}

function herbloreMade({ player, itemId }) {
  if (!active(player) || player.getPrivateArea?.() != null) return;
  const at = player.getLocation();
  const inArea = inBox(at, SEERS_VILLAGE) || inBox(at, CATHERBY);
  if (!inArea) return;
  const s = state(player);
  if (itemId === IRIT_POTION_UNF) {
    if (!s.iritUnfinished) {
      s.iritUnfinished = true;
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.superAntipoison);
    }
  } else if (itemId === SUPERANTIPOISON_3 && s.iritUnfinished) {
    delete s.iritUnfinished;
    credit(player, TASK.superAntipoison);
  }
}

// ---------------------------------------------------------------- water obelisk

function agilityObstacle({ player, shortcut, method }) {
  // Wiki: the task needs the mith grapple, not the 72-Agility barehanded climb. The cache
  // models the crossing two-way; the source route is the Obelisk of Water to Catherby shore.
  if (!active(player) || shortcut !== "Crossbow Tree" || method !== "grapple") return;
  const at = player.getLocation();
  if (at.getX() !== WATER_OBELISK_SHORE.x || at.getY() !== WATER_OBELISK_SHORE.y || at.getZ() !== WATER_OBELISK_SHORE.z) return;
  credit(player, TASK.waterObelisk);
}

// ---------------------------------------------------------------- Hemenster chest

function hemensterChest(event) {
  const { player } = event;
  if (event.objectId !== HEMENSTER_CHEST_ID) return false;
  if (!active(player)) return false;
  const at = event.object?.getLocation?.();
  if (!at || at.getX() !== HEMENSTER_CHEST.x || at.getY() !== HEMENSTER_CHEST.y || at.getZ() !== HEMENSTER_CHEST.z) return false;
  // ponytail: per-player relock, not a shared object timer; enough to stop repeat loot here.
  if (Date.now() < (chestLooted.get(player) ?? 0)) {
    player.sendMessage("The chest is empty.");
    return true;
  }

  const inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < 47) {
    player.sendMessage("You need a Thieving level of at least 47 to steal from this chest.");
    return true;
  }
  if (!inventory.contains(core.ItemIdentifiers.LOCKPICK)) {
    player.sendMessage("You need a lockpick to open this chest.");
    return true;
  }
  const rewards = [new core.Item(core.ItemIdentifiers.STEEL_ARROWTIPS, 5), new core.Item(core.ItemIdentifiers.COINS, 20)];
  const slotsNeeded = rewards.filter((item) => !inventory.contains(item.getId())).length;
  if (inventory.getFreeSlots() < slotsNeeded || rewards.some((item) => inventory.getAddableAmount(item) < item.getAmount())) {
    player.sendMessage("You need room in your inventory for the loot.");
    return true;
  }
  inventory.adds(core.ItemIdentifiers.STEEL_ARROWTIPS, 5);
  inventory.adds(core.ItemIdentifiers.COINS, 20);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, 150);
  chestLooted.set(player, Date.now() + CHEST_RELOCK_MS);
  credit(player, TASK.hemensterChest);
  return true;
}

// ---------------------------------------------------------------- estate agent

function houseRedecorated({ player, style, npc }) {
  if (!active(player) || style !== FANCY_STONE_STYLE) return;
  const at = npc?.getLocation?.();
  if (!near(at, SEERS_AGENT)) return;
  player.setAttribute(SEERS_AGENT_ATTRIBUTE, style);
  credit(player, TASK.estateAgent);
}

// ---------------------------------------------------------------- Barbarian Assault

function blackboardRead({ player, objectId, handled }) {
  if (handled || !BA_BLACKBOARD.includes(objectId) || !active(player)) return false;
  const levels = ["attacker", "collector", "defender", "healer"]
    .map((role) => Number(player.getAttribute(`barbarian-assault:level-${role}`)) || 1);
  if (!levels.every((level) => level >= 5)) {
    player.sendMessage("You must reach level 5 in every Barbarian Assault role first.");
    return true;
  }
  credit(player, TASK.blackboard);
  return true;
}

function graniteBodyBought({ player }) {
  if (!active(player)) return;
  const s = state(player);
  if (!s.graniteBought) {
    s.graniteBought = true;
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.graniteBody);
  }
}

function equipmentChanged({ player }) {
  if (!active(player)) return;
  const body = player.getEquipment?.().get(core.Equipment.BODY_SLOT)?.getId?.();
  const s = pending.get(player);
  if (body === GRANITE_BODY && s?.graniteBought) {
    delete s.graniteBought;
    credit(player, TASK.graniteBody);
  }
}

// ---------------------------------------------------------------- stamina mix

/** The stamina mix is Herblore's barbarian recipe (it needs Barbarian Training); this credits one made on the bank roof. */
function staminaMix({ player, itemId }) {
  if (!active(player) || itemId !== STAMINA_MIX_2 || !inBox(player.getLocation(), SEERS_BANK_ROOF)) return;
  credit(player, TASK.staminaMix);
}

function firemakingSuccess({ player, itemId, bow }) {
  if (!active(player) || itemId !== MAPLE_LOGS || bow !== true) return;
  if (!inBox(player.getLocation(), SEERS_VILLAGE)) return;
  credit(player, TASK.bowFiremaking);
}

function pyreBuilt({ player, logsId, bonesId }) {
  if (!active(player) || logsId !== MAGIC_LOGS || bonesId !== CHEWED_BONES) return;
  credit(player, TASK.pyreShip);
}

/** Cache-derived courthouse interior (walls 38848, south doors 25825/25827). */
function registerCourthouse(registry) {
  class SeersCourthouse extends core.Area {
    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      if (player.getPrayerActive?.()[core.PrayerHandler.PIETY] === true) credit(player, TASK.courthouse);
    }
  }
  registry.registerArea(new SeersCourthouse([
    new core.Boundary(SEERS_COURTHOUSE.minX, SEERS_COURTHOUSE.maxX, SEERS_COURTHOUSE.minY, SEERS_COURTHOUSE.maxY, SEERS_COURTHOUSE.z),
  ]));
}

module.exports = {
  name: "KandarinDiaryFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    core = registry.core;
    registry.persistAttribute(SEERS_AGENT_ATTRIBUTE, null);
    registry.onCustomEvent("diary:task", diaryProgress);
    registry.onCustomEvent("shop:purchase", candlePurchased);
    registry.onCustomEvent("npc-dialogue:action", harryDialogue);
    registry.onCustomEvent("npc-dialogue:action", foresterArms);
    registry.onCustomEvent("fishing:success", fishingSuccess);
    registry.onCustomEvent("cooking:success", cookingSuccess);
    registry.onCustomEvent("woodcutting:success", woodcuttingSuccess);
    registry.onCustomEvent("fletching:made", fletchingMade);
    registry.onCustomEvent("herblore:made", herbloreMade);
    registry.onCustomEvent("herblore:made", staminaMix);
    registry.onCustomEvent("agility:obstacle", agilityObstacle);
    registry.onCustomEvent("equipment:changed", equipmentChanged);
    registry.onCustomEvent("construction:house-redecorated", houseRedecorated);
    registry.onCustomEvent("barbarian-assault:granite-body-bought", graniteBodyBought);
    registry.onCustomEvent("firemaking:success", firemakingSuccess);
    registry.onCustomEvent("barbarian-pyre:built", pyreBuilt);
    registerCourthouse(registry);
    registry.onObjectInteraction(AQUARIUM, { "Fish-in": fishPet });
    registry.onObjectInteraction("Chest", {
      Open: hemensterChest,
      "Search for traps": hemensterChest,
    });
    registry.onObjectInteraction("Blackboard", { Read: blackboardRead });
    registry.onCustomEvent("npc-dialogue:action", openCandleShop);
  },
  _test: {
    TASK, CATHERBY, SEERS_VILLAGE, SEERS_BANK_ROOF, HEMENSTER_CHEST, SEERS_AGENT,
    HEMENSTER_CHEST_ID, BA_BLACKBOARD, GRANITE_BODY, COOKING_GAUNTLETS, CANDLE, STEW,
    RAW_BASS, BASS, RAW_SHARK, SHARK, YEW_LOGS, YEW_LONGBOW_U, YEW_LONGBOW, BOW_STRING,
    IRIT_POTION_UNF, SUPERANTIPOISON_3, STAMINA_POTION_2, STAMINA_MIX_2, CAVIAR,
    TINY_NET, PET_FISH_IDS, GRANITE_BODY_COST, BA_SHOP_ID, FANCY_STONE_STYLE,
    MAPLE_LOGS, MAGIC_LOGS, CHEWED_BONES, SEERS_COURTHOUSE,
    pending, inBox, near, diaryProgress, AQUARIUM, AQUARIUM_ID,
    openCandleShop, candlePurchased, harryDialogue, fishPet, foresterArms, fishingSuccess,
    cookingSuccess, woodcuttingSuccess, fletchingMade, herbloreMade,
    agilityObstacle, hemensterChest, houseRedecorated, blackboardRead, graniteBodyBought,
    equipmentChanged, staminaMix, firemakingSuccess, pyreBuilt, resolveCandleShop, credit,
    setCandleShopId: (id) => { candleShopId = id; },
    resetCandleShop: () => { candleShopId = null; },
  },
};
