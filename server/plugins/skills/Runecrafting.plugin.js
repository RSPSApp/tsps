let pluginApi;
let Skill;
let Item;
let Graphic;
let Animation;
let Location;
let TeleportHandler;
let Sound;
let Sounds;
let Equipment;
let ItemIdentifiers;
let ObjectIdentifiers;

let RUNES_BY_ALTAR_ID;
let TALISMANS;
let ALTAR_DESTINATIONS;
let RIFT_RUNES;
let POUCH_TIERS;
let POUCH_ACTIONS;
let ABYSS_OBSTACLES;
let PICKAXE_IDS;
let AXE_IDS;
let CRAFT_RUNES_GRAPHIC;
let CRAFT_RUNES_ANIMATION;
let RUNE_ESSENCE_MINE;
let ABYSS_INNER_RING;

const RUNE_MYSTERIES_STAGE_ATTRIBUTE = "quest.rune_mysteries.stage";
const POUCHES_ATTRIBUTE = "runecrafting:pouches";
const RUNE_MYSTERIES_COMPLETE_STAGE = 6;
const ABYSS_OBSTACLE_XP = 25;
const ABYSS_SKULL_SECONDS = 10 * 60;
const RIFT_GUARDIAN_BASE = 1795758;
const BLOOD_RIFT_GUARDIAN_BASE = 804984;
const ABYSS_TELEPORT_STEP = "o8m7y6";
const ESSENCE_TELEPORT_STEPS = new Set(["ILlRUH", "SvUvek"]);

const RUNE_ESSENCE_TELEPORT_NPCS = [
  "Aubury",
  "Archmage Sedridor",
  "Wizard Distentor",
  "Brimstail",
  "Wizard Cromperty",
  "Wizard Jalarast",
];

const RIFT_OBJECT_NAMES = [
  "Air rift",
  "Mind rift",
  "Water rift",
  "Earth rift",
  "Fire rift",
  "Body rift",
  "Cosmic rift",
  "Chaos rift",
  "Nature rift",
  "Law rift",
  "Death rift",
  "Blood rift",
];

function initialize(api) {
  pluginApi = api;
  ({
    Skill,
    Item,
    Graphic,
    Animation,
    Location,
    TeleportHandler,
    Sound,
    Sounds,
    Equipment,
    ItemIdentifiers,
    ObjectIdentifiers,
  } = api.core);

  CRAFT_RUNES_GRAPHIC = new Graphic(186, api.core.GraphicHeight.HIGH);
  CRAFT_RUNES_ANIMATION = new Animation(791);
  RUNE_ESSENCE_MINE = new Location(2913, 4832, 0);
  ABYSS_INNER_RING = new Location(3040, 4839, 0);

  PICKAXE_IDS = [
    ItemIdentifiers.BRONZE_PICKAXE,
    ItemIdentifiers.IRON_PICKAXE,
    ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.BLACK_PICKAXE,
    ItemIdentifiers.MITHRIL_PICKAXE,
    ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
    ItemIdentifiers.DRAGON_PICKAXE,
  ];
  AXE_IDS = [
    ItemIdentifiers.BRONZE_AXE,
    ItemIdentifiers.IRON_AXE,
    ItemIdentifiers.STEEL_AXE,
    ItemIdentifiers.BLACK_AXE,
    ItemIdentifiers.MITHRIL_AXE,
    ItemIdentifiers.ADAMANT_AXE,
    ItemIdentifiers.RUNE_AXE,
    ItemIdentifiers.DRAGON_AXE,
  ];

  RUNES_BY_ALTAR_ID = new Map([
    [ObjectIdentifiers.ALTAR_33, { runeId: ItemIdentifiers.AIR_RUNE, level: 1, xp: 5, pureOnly: false, multiplier: [[11, 2], [22, 3], [33, 4], [44, 5], [55, 6], [66, 7], [77, 8], [88, 9], [99, 10]] }],
    [ObjectIdentifiers.ALTAR_34, { runeId: ItemIdentifiers.MIND_RUNE, level: 2, xp: 6, pureOnly: false, multiplier: [[14, 2], [28, 3], [42, 4], [56, 5], [70, 6], [84, 7], [98, 8]] }],
    [ObjectIdentifiers.ALTAR_35, { runeId: ItemIdentifiers.WATER_RUNE, level: 5, xp: 7, pureOnly: false, multiplier: [[19, 2], [38, 3], [57, 4], [76, 5], [95, 6]] }],
    [ObjectIdentifiers.ALTAR_36, { runeId: ItemIdentifiers.EARTH_RUNE, level: 9, xp: 8, pureOnly: false, multiplier: [[26, 2], [52, 3], [78, 4]] }],
    [ObjectIdentifiers.ALTAR_37, { runeId: ItemIdentifiers.FIRE_RUNE, level: 14, xp: 9, pureOnly: false, multiplier: [[35, 2], [70, 3]] }],
    [ObjectIdentifiers.ALTAR_38, { runeId: ItemIdentifiers.BODY_RUNE, level: 20, xp: 10, pureOnly: false, multiplier: [[46, 2], [92, 3]] }],
    [ObjectIdentifiers.ALTAR_39, { runeId: ItemIdentifiers.COSMIC_RUNE, level: 27, xp: 11, pureOnly: true, multiplier: [[59, 2]] }],
    [ObjectIdentifiers.ALTAR_55, { runeId: ItemIdentifiers.CHAOS_RUNE, level: 35, xp: 12, pureOnly: true, multiplier: [[74, 2]] }],
    [ObjectIdentifiers.ALTAR_57, { runeId: ItemIdentifiers.ASTRAL_RUNE, level: 40, xp: 13, pureOnly: true, multiplier: [[82, 2]] }],
    [ObjectIdentifiers.ALTAR_46, { runeId: ItemIdentifiers.NATURE_RUNE, level: 44, xp: 14, pureOnly: true, multiplier: [[91, 2]] }],
    [ObjectIdentifiers.ALTAR_40, { runeId: ItemIdentifiers.LAW_RUNE, level: 54, xp: 15, pureOnly: true, multiplier: [[95, 2]] }],
    [ObjectIdentifiers.ALTAR_56, { runeId: ItemIdentifiers.DEATH_RUNE, level: 65, xp: 16, pureOnly: true, multiplier: [[99, 2]] }],
    [ObjectIdentifiers.BLOOD_ALTAR, { runeId: ItemIdentifiers.BLOOD_RUNE, level: 75, xp: 27, pureOnly: true, multiplier: [] }],
  ]);
  RUNES_BY_ALTAR_ID.set(ObjectIdentifiers.ALTAR_83, RUNES_BY_ALTAR_ID.get(ObjectIdentifiers.BLOOD_ALTAR));

  TALISMANS = new Map([
    [ItemIdentifiers.AIR_TALISMAN, { name: "Air talisman", runeId: ItemIdentifiers.AIR_RUNE, x: 2841, y: 4828, ruinX: 2983, ruinY: 3288 }],
    [ItemIdentifiers.MIND_TALISMAN, { name: "Mind talisman", runeId: ItemIdentifiers.MIND_RUNE, x: 2793, y: 4827, ruinX: 2980, ruinY: 3511 }],
    [ItemIdentifiers.WATER_TALISMAN, { name: "Water talisman", runeId: ItemIdentifiers.WATER_RUNE, x: 2720, y: 4831, ruinX: 3182, ruinY: 3162 }],
    [ItemIdentifiers.EARTH_TALISMAN, { name: "Earth talisman", runeId: ItemIdentifiers.EARTH_RUNE, x: 2655, y: 4829, ruinX: 3302, ruinY: 3477 }],
    [ItemIdentifiers.FIRE_TALISMAN, { name: "Fire talisman", runeId: ItemIdentifiers.FIRE_RUNE, x: 2576, y: 4846, ruinX: 3310, ruinY: 3252 }],
    [ItemIdentifiers.BODY_TALISMAN, { name: "Body talisman", runeId: ItemIdentifiers.BODY_RUNE, x: 2522, y: 4833, ruinX: 3050, ruinY: 3442 }],
    [ItemIdentifiers.COSMIC_TALISMAN, { name: "Cosmic talisman", runeId: ItemIdentifiers.COSMIC_RUNE, x: 2163, y: 4833, ruinX: 2405, ruinY: 4381 }],
    [ItemIdentifiers.CHAOS_TALISMAN, { name: "Chaos talisman", runeId: ItemIdentifiers.CHAOS_RUNE, x: 2282, y: 4837, ruinX: 3060, ruinY: 3585 }],
    [ItemIdentifiers.NATURE_TALISMAN, { name: "Nature talisman", runeId: ItemIdentifiers.NATURE_RUNE, x: 2400, y: 4834, ruinX: 2865, ruinY: 3022 }],
    [ItemIdentifiers.LAW_TALISMAN, { name: "Law talisman", runeId: ItemIdentifiers.LAW_RUNE, x: 2464, y: 4817, ruinX: 2858, ruinY: 3378 }],
    [ItemIdentifiers.DEATH_TALISMAN, { name: "Death talisman", runeId: ItemIdentifiers.DEATH_RUNE, x: 2208, y: 4829, ruinX: 1863, ruinY: 4639 }],
    [ItemIdentifiers.BLOOD_TALISMAN, { name: "Blood talisman", runeId: ItemIdentifiers.BLOOD_RUNE, x: 1722, y: 3826, locateMessage: "The talisman doesn't seem to work. Maybe the ruins are deep underground." }],
  ]);

  ALTAR_DESTINATIONS = new Map(
    [...TALISMANS.values()].map((talisman) => [
      talisman.runeId,
      { x: talisman.x, y: talisman.y },
    ])
  );

  RIFT_RUNES = new Map([
    [ObjectIdentifiers.AIR_RIFT, ItemIdentifiers.AIR_RUNE],
    [ObjectIdentifiers.MIND_RIFT, ItemIdentifiers.MIND_RUNE],
    [ObjectIdentifiers.WATER_RIFT, ItemIdentifiers.WATER_RUNE],
    [ObjectIdentifiers.EARTH_RIFT, ItemIdentifiers.EARTH_RUNE],
    [ObjectIdentifiers.FIRE_RIFT, ItemIdentifiers.FIRE_RUNE],
    [ObjectIdentifiers.BODY_RIFT, ItemIdentifiers.BODY_RUNE],
    [ObjectIdentifiers.COSMIC_RIFT, ItemIdentifiers.COSMIC_RUNE],
    [ObjectIdentifiers.CHAOS_RIFT, ItemIdentifiers.CHAOS_RUNE],
    [ObjectIdentifiers.NATURE_RIFT, ItemIdentifiers.NATURE_RUNE],
    [ObjectIdentifiers.LAW_RIFT, ItemIdentifiers.LAW_RUNE],
    [ObjectIdentifiers.DEATH_RIFT, ItemIdentifiers.DEATH_RUNE],
    [ObjectIdentifiers.BLOOD_RIFT, ItemIdentifiers.BLOOD_RUNE],
    [ObjectIdentifiers.BLOOD_RIFT_2, ItemIdentifiers.BLOOD_RUNE],
  ]);

  POUCH_TIERS = [
    { itemId: ItemIdentifiers.SMALL_POUCH, name: "Small pouch", level: 1, capacity: 3, decayChance: -1 },
    { itemId: ItemIdentifiers.MEDIUM_POUCH, name: "Medium pouch", level: 25, capacity: 6, decayChance: 45 },
    { itemId: ItemIdentifiers.LARGE_POUCH, name: "Large pouch", level: 50, capacity: 9, decayChance: 29 },
    { itemId: ItemIdentifiers.GIANT_POUCH, name: "Giant pouch", level: 75, capacity: 12, decayChance: 10 },
  ];
  POUCH_ACTIONS = new Map();
  for (const tier of POUCH_TIERS) {
    POUCH_ACTIONS.set(tier.itemId, tier);
  }
  POUCH_ACTIONS.set(ItemIdentifiers.MEDIUM_POUCH_2, POUCH_ACTIONS.get(ItemIdentifiers.MEDIUM_POUCH));
  POUCH_ACTIONS.set(ItemIdentifiers.LARGE_POUCH_2, POUCH_ACTIONS.get(ItemIdentifiers.LARGE_POUCH));
  POUCH_ACTIONS.set(ItemIdentifiers.GIANT_POUCH_2, POUCH_ACTIONS.get(ItemIdentifiers.GIANT_POUCH));

  ABYSS_OBSTACLES = new Map([
    [ObjectIdentifiers.ROCK_111, { objectName: "Rock", action: "Mine", skill: Skill.MINING, toolIds: PICKAXE_IDS, toolMessage: "You need a pickaxe to mine through the rock.", fail: "You fail to mine through the rock." }],
    [ObjectIdentifiers.TENDRILS_4, { objectName: "Tendrils", action: "Chop", skill: Skill.WOODCUTTING, toolIds: AXE_IDS, toolMessage: "You need an axe to chop through the tendrils.", fail: "You fail to chop through the tendrils." }],
    [ObjectIdentifiers.BOIL, { objectName: "Boil", action: "Burn-down", skill: Skill.FIREMAKING, toolIds: [ItemIdentifiers.TINDERBOX], toolMessage: "You need a tinderbox to burn through the boil.", fail: "You fail to burn through the boil." }],
    [ObjectIdentifiers.EYES, { objectName: "Eyes", action: "Distract", skill: Skill.THIEVING, toolIds: null, toolMessage: null, fail: "You fail to distract the eyes." }],
    [ObjectIdentifiers.GAP_42, { objectName: "Gap", action: "Squeeze-through", skill: Skill.AGILITY, toolIds: null, toolMessage: null, fail: "You fail to squeeze through the gap." }],
    [ObjectIdentifiers.PASSAGE_4, { objectName: "Passage", action: "Go-through", skill: null, toolIds: null, toolMessage: null, fail: null }],
  ]);
}

function runeMultiplier(level, runeData) {
  let amount = 1;
  for (const [requiredLevel, multiplier] of runeData.multiplier) {
    if (level >= requiredLevel) {
      amount = multiplier;
    }
  }
  return amount;
}

function hasTool(player, itemIds) {
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  if (weapon && itemIds.includes(weapon.getId())) {
    return true;
  }
  return itemIds.some((itemId) => player.getInventory().contains(itemId));
}

function hasCompletedRuneMysteries(player) {
  const stage = Number(player.getAttribute(RUNE_MYSTERIES_STAGE_ATTRIBUTE));
  return Number.isFinite(stage) && stage >= RUNE_MYSTERIES_COMPLETE_STAGE;
}

function requestTeleport(player, destination) {
  pluginApi.emitCustomEvent("lever:teleport", { player, destination: destination.clone() });
}

function ensurePouchArray(player) {
  const existing = player.getAttribute(POUCHES_ATTRIBUTE);
  const containers = Array.isArray(existing) ? existing : [];

  const byItemId = new Map();
  for (const container of containers) {
    const pouchId = container?.pouch?.itemId ?? container?.pouch?.id ?? -1;
    if (Number.isInteger(pouchId)) {
      byItemId.set(pouchId, container);
    }
  }

  const normalized = [];
  for (const tier of POUCH_TIERS) {
    const raw = byItemId.get(tier.itemId);
    normalized.push({
      pouch: {
        itemId: tier.itemId,
        requiredLevel: tier.level,
        capacity: tier.capacity,
        decayChance: tier.decayChance,
      },
      runeEssenceAmt: Math.max(0, Number(raw?.runeEssenceAmt || 0)),
      pureEssenceAmt: Math.max(0, Number(raw?.pureEssenceAmt || 0)),
    });
  }

  player.setAttribute(POUCHES_ATTRIBUTE, normalized);
  return normalized;
}

function pouchContainerFor(event) {
  const tier = POUCH_ACTIONS.get(event.itemId);
  if (!tier) {
    return null;
  }
  return ensurePouchArray(event.player).find((entry) => entry.pouch.itemId === tier.itemId) ?? null;
}

function storePouch(player, container) {
  if (container.runeEssenceAmt + container.pureEssenceAmt >= container.pouch.capacity) {
    player.sendMessage("Your pouch is already full.");
    return;
  }

  if (
    player.getSkillManager().getMaxLevel(Skill.RUNECRAFTING) <
    container.pouch.requiredLevel
  ) {
    player.sendMessage(
      `You need a Runecrafting level of at least ${container.pouch.requiredLevel} to use this.`
    );
    return;
  }

  for (
    let i = container.runeEssenceAmt + container.pureEssenceAmt;
    i < container.pouch.capacity;
    i++
  ) {
    if (player.getInventory().contains(ItemIdentifiers.PURE_ESSENCE)) {
      player.getInventory().deleteNumber(ItemIdentifiers.PURE_ESSENCE, 1);
      container.pureEssenceAmt++;
    } else if (player.getInventory().contains(ItemIdentifiers.RUNE_ESSENCE)) {
      player.getInventory().deleteNumber(ItemIdentifiers.RUNE_ESSENCE, 1);
      container.runeEssenceAmt++;
    } else {
      player.sendMessage("You don't have any more essence to store.");
      break;
    }
  }
}

function checkPouch(player, container) {
  const tier = POUCH_TIERS.find((entry) => entry.itemId === container.pouch.itemId);
  const label = (tier?.name ?? "pouch").toLowerCase();
  player.sendMessage(
    `Your ${label} contains ${container.runeEssenceAmt} Rune essence and ${container.pureEssenceAmt} Pure essence.`
  );
}

function withdrawPouch(player, container) {
  const total = container.runeEssenceAmt + container.pureEssenceAmt;
  if (total <= 0) {
    player.sendMessage("Your pouch is already empty.");
    return;
  }

  for (let i = 0; i < total; i++) {
    if (player.getInventory().isFull()) {
      player.getInventory().full();
      break;
    }
    if (container.pureEssenceAmt > 0) {
      player.getInventory().adds(ItemIdentifiers.PURE_ESSENCE, 1);
      container.pureEssenceAmt--;
    } else if (container.runeEssenceAmt > 0) {
      player.getInventory().adds(ItemIdentifiers.RUNE_ESSENCE, 1);
      container.runeEssenceAmt--;
    } else {
      break;
    }
  }
}

function handlePouchStore(event) {
  const container = pouchContainerFor(event);
  if (!container) {
    return false;
  }
  storePouch(event.player, container);
  return true;
}

function handlePouchCheck(event) {
  const container = pouchContainerFor(event);
  if (!container) {
    return false;
  }
  checkPouch(event.player, container);
  return true;
}

function handlePouchWithdraw(event) {
  const container = pouchContainerFor(event);
  if (!container) {
    return false;
  }
  withdrawPouch(event.player, container);
  return true;
}

function handleCraftRunes(event) {
  const runeData = RUNES_BY_ALTAR_ID.get(event.objectId);
  if (!runeData) {
    return false;
  }

  const player = event.player;
  const level = player.getSkillManager().getCurrentLevel(Skill.RUNECRAFTING);
  if (level < runeData.level) {
    player.sendMessage(
      `You need a Runecrafting level of at least ${runeData.level} to craft this.`
    );
    event.handled = true;
    return true;
  }

  const essenceId = runeData.pureOnly
    ? ItemIdentifiers.PURE_ESSENCE
    : player.getInventory().contains(ItemIdentifiers.RUNE_ESSENCE)
      ? ItemIdentifiers.RUNE_ESSENCE
      : player.getInventory().contains(ItemIdentifiers.PURE_ESSENCE)
        ? ItemIdentifiers.PURE_ESSENCE
        : -1;

  if (essenceId === -1) {
    player.sendMessage(
      runeData.pureOnly
        ? "You need Pure essence to craft runes using this altar."
        : "You don't have any essence in your inventory."
    );
    event.handled = true;
    return true;
  }

  const amountPerEssence = runeMultiplier(level, runeData);
  let craftedEssence = 0;
  while (player.getInventory().contains(essenceId)) {
    player.getInventory().deleteNumber(essenceId, 1);
    player.getInventory().addItem(new Item(runeData.runeId, amountPerEssence));
    craftedEssence++;
  }

  if (craftedEssence > 0) {
    player.performGraphic(CRAFT_RUNES_GRAPHIC);
    player.performAnimation(CRAFT_RUNES_ANIMATION);
    Sounds.sendSound(player, Sound.CRAFT_RUNES);
    player
      .getSkillManager()
      .addExperiences(Skill.RUNECRAFTING, craftedEssence * runeData.xp);
    // The rift guardian rolls per essence (Wiki).
    pluginApi.emitCustomEvent("runecrafting:success", {
      player,
      skill: Skill.RUNECRAFTING,
      petBase: runeData.runeId === ItemIdentifiers.BLOOD_RUNE ? BLOOD_RIFT_GUARDIAN_BASE : RIFT_GUARDIAN_BASE,
      rolls: craftedEssence,
      runeId: runeData.runeId,
    });
  }

  event.handled = true;
  return true;
}

function locateDirection(player, ruinX, ruinY) {
  const dx = ruinX - player.getLocation().getX();
  const dy = ruinY - player.getLocation().getY();
  if (dx === 0 && dy === 0) {
    return null;
  }
  const northSouth = dy > 0 ? "North" : dy < 0 ? "South" : "";
  const eastWest = dx > 0 ? "East" : dx < 0 ? "West" : "";
  return [northSouth, eastWest].filter(Boolean).join("-");
}

function handleTalismanLocate(event) {
  const talisman = TALISMANS.get(event.itemId);
  if (!talisman) {
    return false;
  }

  const player = event.player;
  if (talisman.locateMessage) {
    player.sendMessage(talisman.locateMessage);
    return true;
  }

  const direction = locateDirection(player, talisman.ruinX, talisman.ruinY);
  player.sendMessage(
    direction
      ? `The talisman pulls to the ${direction}.`
      : "The talisman is having trouble pin-pointing the location."
  );
  return true;
}

function handleRuneEssenceTeleport(event) {
  const player = event.player;
  if (!hasCompletedRuneMysteries(player)) {
    player.sendMessage("You need to complete Rune Mysteries before using this teleport.");
    return true;
  }
  player.sendMessage("Senventior disthine molenko!");
  requestTeleport(player, RUNE_ESSENCE_MINE.clone());
  return true;
}

function teleportToAbyss(player) {
  if (!TeleportHandler.checkReqs(player, ABYSS_INNER_RING)) {
    return;
  }
  player.getSkillManager().setCurrentLevels(Skill.PRAYER, 0);
  // The Mage of Zamorak skulls the player for 10 minutes (Wiki).
  pluginApi.core.CombatFactory.skull(player, pluginApi.core.SkullType.WHITE_SKULL, ABYSS_SKULL_SECONDS);
  requestTeleport(player, ABYSS_INNER_RING);
}

function handleZamorakTeleport(event) {
  teleportToAbyss(event.player);
  return true;
}

function handleDialogueAction(event) {
  if (event.handled || event.action !== "teleport") {
    return;
  }

  const player = event.player;
  if (event.stepId === ABYSS_TELEPORT_STEP) {
    teleportToAbyss(player);
  } else if (ESSENCE_TELEPORT_STEPS.has(event.stepId)) {
    if (!hasCompletedRuneMysteries(player)) {
      player.sendMessage("You need to complete Rune Mysteries before using this teleport.");
    } else {
      requestTeleport(player, RUNE_ESSENCE_MINE);
    }
  } else {
    return;
  }

  event.handled = true;
  event.end = true;
}

function abyssObstacleChance(player, obstacle) {
  if (obstacle.skill == null) {
    return 100;
  }
  return Math.min(100, player.getSkillManager().getCurrentLevel(obstacle.skill) + 1);
}

function handleAbyssObstacle(event) {
  const obstacle = ABYSS_OBSTACLES.get(event.objectId);
  if (!obstacle) {
    return false;
  }

  const player = event.player;
  if (obstacle.toolIds && !hasTool(player, obstacle.toolIds)) {
    player.sendMessage(obstacle.toolMessage);
    return true;
  }

  if (Math.random() * 100 < abyssObstacleChance(player, obstacle)) {
    if (obstacle.skill != null) {
      player.getSkillManager().addExperiences(obstacle.skill, ABYSS_OBSTACLE_XP);
    }
    requestTeleport(player, ABYSS_INNER_RING.clone());
  } else {
    player.sendMessage(obstacle.fail);
  }
  return true;
}

function handleEnterRift(event) {
  const runeId = RIFT_RUNES.get(event.objectId);
  if (!runeId) {
    return false;
  }
  const destination = ALTAR_DESTINATIONS.get(runeId);
  if (destination) {
    requestTeleport(event.player, new Location(destination.x, destination.y, 0));
  }
  return true;
}

module.exports = {
  name: "Runecrafting",
  register(api) {
    initialize(api);

    api.onObjectInteraction("Altar", { "Craft-rune": handleCraftRunes });
    api.onObjectInteraction("Blood Altar", { Bind: handleCraftRunes });

    for (const tier of POUCH_TIERS) {
      api.onItemAction(tier.name, {
        Fill: handlePouchStore,
        Check: handlePouchCheck,
        Empty: handlePouchWithdraw,
      });
    }

    for (const talisman of TALISMANS.values()) {
      api.onItemAction(talisman.name, { Locate: handleTalismanLocate });
    }

    for (const npcName of RUNE_ESSENCE_TELEPORT_NPCS) {
      api.onNpcInteraction(npcName, { Teleport: handleRuneEssenceTeleport });
    }
    api.onNpcInteraction("Mage of Zamorak", { Teleport: handleZamorakTeleport });
    api.onCustomEvent("npc-dialogue:action", handleDialogueAction);

    for (const objectName of RIFT_OBJECT_NAMES) {
      api.onObjectInteraction(objectName, {
        "Exit-through": handleEnterRift,
        "Exit-through (Kourend)": handleEnterRift,
      });
    }

    for (const obstacle of ABYSS_OBSTACLES.values()) {
      api.onObjectInteraction(obstacle.objectName, {
        [obstacle.action]: handleAbyssObstacle,
      });
    }

    api.log("registered", {
      altars: RUNES_BY_ALTAR_ID.size,
      talismans: TALISMANS.size,
      rifts: RIFT_RUNES.size,
      pouches: POUCH_TIERS.length,
      abyssObstacles: ABYSS_OBSTACLES.size,
    });
  },
};
