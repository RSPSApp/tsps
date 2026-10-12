const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const GEMS = new Map([
  [ItemIds.UNCUT_OPAL, { cut: ItemIds.OPAL, level: 1, xp: 15, animation: 890 }],
  [ItemIds.UNCUT_JADE, { cut: ItemIds.JADE, level: 13, xp: 20, animation: 891 }],
  [ItemIds.UNCUT_RED_TOPAZ, { cut: ItemIds.RED_TOPAZ, level: 16, xp: 25, animation: 892 }],
  [ItemIds.UNCUT_SAPPHIRE, { cut: ItemIds.SAPPHIRE, level: 20, xp: 50, animation: 888 }],
  [ItemIds.UNCUT_EMERALD, { cut: ItemIds.EMERALD, level: 27, xp: 68, animation: 889 }],
  [ItemIds.UNCUT_RUBY, { cut: ItemIds.RUBY, level: 34, xp: 85, animation: 887 }],
  [ItemIds.UNCUT_DIAMOND, { cut: ItemIds.DIAMOND, level: 43, xp: 108, animation: 886 }],
  [ItemIds.UNCUT_DRAGONSTONE, { cut: ItemIds.DRAGONSTONE, level: 55, xp: 138, animation: 885 }],
  [ItemIds.UNCUT_ONYX, { cut: ItemIds.ONYX, level: 67, xp: 168, animation: 2717 }],
  [ItemIds.UNCUT_ZENYTE, { cut: ItemIds.ZENYTE, level: 89, xp: 200, animation: 7185 }],
]);

/**
 * Wiki ('perfect' necklace/ring, Family Crest): a 'perfect' gold bar, a ruby and the
 * matching mould at a furnace, 40 Crafting; 75 XP necklace, 70 XP ring. The mould is
 * a tool and is kept.
 */
const PERFECT_JEWELLERY = [
  { name: "'perfect' ring", itemId: ItemIds.PERFECT_RING, mouldId: ItemIds.RING_MOULD, level: 40, xp: 70 },
  { name: "'perfect' necklace", itemId: ItemIds.PERFECT_NECKLACE, mouldId: ItemIds.NECKLACE_MOULD, level: 40, xp: 75 },
];

const FURNACE_NAMES = new Set(["Furnace", "Small furnace"]);

/**
 * Wiki (Crafting#Jewellery): a gold bar used on a furnace with a ring, necklace, amulet or
 * bracelet mould makes the plain gold piece, or the gem-set one when the matching cut gem
 * is carried too. The bar and the gem are used up; the mould is a tool and is kept.
 * Amulets are made unstrung, (u).
 *
 * Each product row is [itemId, Crafting level, XP], in the same order as JEWELLERY_GEMS.
 * ponytail: levels and XP are from the wiki's Crafting tables; opal, jade and red topaz
 * pieces, silver jewellery (holy and unholy symbols, tiaras) and the "make X" quantity prompt
 * are not here yet.
 */
const JEWELLERY_GEMS = [
  { name: "gold", gemId: null },
  { name: "sapphire", gemId: ItemIds.SAPPHIRE },
  { name: "emerald", gemId: ItemIds.EMERALD },
  { name: "ruby", gemId: ItemIds.RUBY },
  { name: "diamond", gemId: ItemIds.DIAMOND },
  { name: "dragonstone", gemId: ItemIds.DRAGONSTONE },
  { name: "onyx", gemId: ItemIds.ONYX },
  { name: "zenyte", gemId: ItemIds.ZENYTE },
];

const JEWELLERY_TYPES = [
  {
    name: "ring",
    mouldId: ItemIds.RING_MOULD,
    products: [
      [ItemIds.GOLD_RING, 5, 15],
      [ItemIds.SAPPHIRE_RING, 20, 40],
      [ItemIds.EMERALD_RING, 27, 55],
      [ItemIds.RUBY_RING, 34, 70],
      [ItemIds.DIAMOND_RING, 43, 85],
      [ItemIds.DRAGONSTONE_RING, 55, 100],
      [ItemIds.ONYX_RING_2, 67, 115],
      [ItemIds.ZENYTE_RING_2, 89, 150],
    ],
  },
  {
    name: "necklace",
    mouldId: ItemIds.NECKLACE_MOULD,
    products: [
      [ItemIds.GOLD_NECKLACE, 6, 20],
      [ItemIds.SAPPHIRE_NECKLACE, 22, 55],
      [ItemIds.EMERALD_NECKLACE, 29, 60],
      [ItemIds.RUBY_NECKLACE, 40, 75],
      [ItemIds.DIAMOND_NECKLACE, 56, 90],
      [ItemIds.DRAGON_NECKLACE, 72, 105],
      [ItemIds.ONYX_NECKLACE_2, 82, 120],
      [ItemIds.ZENYTE_NECKLACE_2, 92, 165],
    ],
  },
  {
    name: "amulet",
    mouldId: ItemIds.AMULET_MOULD,
    products: [
      [ItemIds.GOLD_AMULET_U_, 8, 30],
      [ItemIds.SAPPHIRE_AMULET_U_, 24, 65],
      [ItemIds.EMERALD_AMULET_U_, 31, 70],
      [ItemIds.RUBY_AMULET_U_, 50, 85],
      [ItemIds.DIAMOND_AMULET_U_, 70, 100],
      [ItemIds.DRAGONSTONE_AMULET_U_, 80, 150],
      [ItemIds.ONYX_AMULET_U_, 90, 165],
      [ItemIds.ZENYTE_AMULET_U_, 98, 180],
    ],
  },
  {
    name: "bracelet",
    mouldId: ItemIds.BRACELET_MOULD,
    products: [
      [ItemIds.GOLD_BRACELET, 7, 25],
      [ItemIds.SAPPHIRE_BRACELET, 23, 60],
      [ItemIds.EMERALD_BRACELET, 30, 65],
      [ItemIds.RUBY_BRACELET, 42, 80],
      [ItemIds.DIAMOND_BRACELET, 58, 95],
      [ItemIds.DRAGONSTONE_BRACELET, 74, 110],
      [ItemIds.ONYX_BRACELET, 84, 125],
      [ItemIds.ZENYTE_BRACELET_2, 95, 180],
    ],
  },
];

/**
 * Wiki (Crafting#Jewellery, amulet stringing): a ball of wool used on an unstrung amulet
 * strings it, 4 XP and no level requirement; the wool and the (u) amulet are used up.
 */
const STRING_AMULET_XP = 4;
const STRUNG_AMULETS = new Map([
  [ItemIds.GOLD_AMULET_U_, ItemIds.GOLD_AMULET],
  [ItemIds.SAPPHIRE_AMULET_U_, ItemIds.SAPPHIRE_AMULET_2],
  [ItemIds.EMERALD_AMULET_U_, ItemIds.EMERALD_AMULET_2],
  [ItemIds.RUBY_AMULET_U_, ItemIds.RUBY_AMULET_2],
  [ItemIds.DIAMOND_AMULET_U_, ItemIds.DIAMOND_AMULET_2],
  [ItemIds.DRAGONSTONE_AMULET_U_, ItemIds.DRAGONSTONE_AMULET],
  [ItemIds.ONYX_AMULET_U_, ItemIds.ONYX_AMULET_2],
  [ItemIds.ZENYTE_AMULET_U_, ItemIds.ZENYTE_AMULET_2],
]);

/** The furnace smelting animation, used for jewellery as well. */
const FURNACE_ANIMATION = new Animation(899);

/** A multi-choice chatbox prompt holds this many options; longer lists page through "More...". */
const MAX_PROMPT_OPTIONS = 5;

const POTTERY_WHEEL_ANIMATION = new Animation(883);

/**
 * Wiki (Crafting#Pottery): soft clay is shaped on a potter's wheel and the unfired piece
 * fired in a pottery oven, which has no Crafting level requirement. Pot, pie dish and bowl
 * are the free-to-play recipes the skill table gives (The Golem and Dragon Slayer I need
 * soft clay and an unfired bowl).
 * ponytail: firing always succeeds; the crack chance below level 14 can be added with the
 * wiki's success curve if failing pottery ever matters.
 */
const POTTERY = [
  { name: "pot", unfiredId: ItemIds.UNFIRED_POT, firedId: ItemIds.POT, level: 1, shapingXp: 6.3, firingXp: 6.3 },
  { name: "pie dish", unfiredId: ItemIds.UNFIRED_PIE_DISH, firedId: ItemIds.PIE_DISH, level: 7, shapingXp: 15, firingXp: 10 },
  { name: "bowl", unfiredId: ItemIds.UNFIRED_BOWL, firedId: ItemIds.BOWL, level: 8, shapingXp: 18, firingXp: 15 },
];

const POTTERY_BY_UNFIRED = new Map(POTTERY.map((recipe) => [recipe.unfiredId, recipe]));

/**
 * Wiki (Soft clay): a container of water (bucket, bowl, jug, vial) on clay makes soft clay
 * and leaves the empty container in the inventory.
 */
const WATER_CONTAINERS = new Map([
  [ItemIds.BUCKET_OF_WATER, ItemIds.BUCKET],
  [ItemIds.BOWL_OF_WATER, ItemIds.BOWL],
  [ItemIds.JUG_OF_WATER, ItemIds.JUG],
  [ItemIds.VIAL_OF_WATER, ItemIds.VIAL],
]);

const POTTER_WHEEL_NAMES = new Set(["Potter's Wheel", "Potter's wheel"]);
const POTTERY_OVEN_NAMES = new Set(["Pottery Oven"]);

let pluginApi;

function cutGem(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const hasChisel =
    usedItemId === ItemIds.CHISEL || usedWithItemId === ItemIds.CHISEL;
  if (!hasChisel) {
    return;
  }

  const uncutId =
    usedItemId === ItemIds.CHISEL ? usedWithItemId : usedItemId;
  const gem = GEMS.get(uncutId);
  if (!gem) {
    return;
  }

  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < gem.level) {
    player.sendMessage(
      `You need a Crafting level of at least ${gem.level} to cut this gem.`
    );
    event.handled = true;
    return;
  }

  if (!player.getInventory().contains(uncutId)) {
    event.handled = true;
    return;
  }

  player.performAnimation(new Animation(gem.animation));
  Sounds.sendSound(player, Sound.GEM_CUTTING);
  player.getInventory().deleteNumber(uncutId, 1);
  player.getInventory().addItem(new Item(gem.cut, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, gem.xp);
  event.handled = true;
}

function craftPerfectJewellery(player, recipe) {
  const inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < recipe.level) {
    player.sendMessage(`You need a Crafting level of at least ${recipe.level} to craft this.`);
    return;
  }
  if (!inventory.contains(ItemIds.PERFECT_GOLD_BAR) || !inventory.contains(ItemIds.RUBY) || !inventory.contains(recipe.mouldId)) {
    return;
  }
  inventory.deleteNumber(ItemIds.PERFECT_GOLD_BAR, 1);
  inventory.deleteNumber(ItemIds.RUBY, 1);
  inventory.addItem(new Item(recipe.itemId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, recipe.xp);
  player.sendMessage(`You craft a ${recipe.name}.`);
}

/**
 * Wiki (Glassblowing): a glassblowing pipe used on molten glass shapes an
 * unpowered orb, 46 Crafting, 52.5 XP; the pipe is kept. Legends' Quest needs
 * one for the trial magic gate.
 */
const GLASSBLOWING = [
  { name: "unpowered orb", itemId: ItemIds.UNPOWERED_ORB, level: 46, xp: 52.5 },
];

function blowGlass(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const ids = new Set([usedItemId, usedWithItemId]);
  if (!ids.has(ItemIds.GLASSBLOWING_PIPE) || !ids.has(ItemIds.MOLTEN_GLASS)) return;
  const recipe = GLASSBLOWING[0];
  event.handled = true;
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < recipe.level) {
    player.sendMessage(`You need a Crafting level of at least ${recipe.level} to make this.`);
    return;
  }
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.MOLTEN_GLASS)) return;
  inventory.deleteNumber(ItemIds.MOLTEN_GLASS, 1);
  inventory.addItem(new Item(recipe.itemId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, recipe.xp);
  player.sendMessage(`You shape the glass into an ${recipe.name}.`);
}

/** Using a 'perfect' gold bar on a furnace, with a ruby and a mould, makes the jewellery. */
function handlePerfectJewellery(event) {
  const { player, object, itemId } = event;
  if (itemId !== ItemIds.PERFECT_GOLD_BAR) return;
  if (!FURNACE_NAMES.has(object?.getDefinition?.()?.getName?.())) return;

  const inventory = player.getInventory();
  const recipes = PERFECT_JEWELLERY.filter(
    (recipe) => inventory.contains(recipe.mouldId) && inventory.contains(ItemIds.RUBY)
  );
  if (recipes.length === 0) return;

  event.handled = true;
  if (recipes.length === 1) {
    craftPerfectJewellery(player, recipes[0]);
    return;
  }
  // Both moulds carried: let the player choose, as the OSRS jewellery interface does.
  pluginApi.sendMultiChatboxPrompt(
    player,
    "What would you like to make?",
    recipes[0].name,
    () => craftPerfectJewellery(player, recipes[0]),
    recipes[1].name,
    () => craftPerfectJewellery(player, recipes[1])
  );
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Shows `choices` ({ label, run }) in a chatbox prompt. A list longer than the prompt holds
 * is split into pages, the last slot of each page being "More...".
 */
function promptChoice(player, title, choices, start = 0) {
  const hasMore = choices.length - start > MAX_PROMPT_OPTIONS;
  const page = choices.slice(start, hasMore ? start + MAX_PROMPT_OPTIONS - 1 : undefined);
  const options = page.flatMap((choice) => [choice.label, choice.run]);
  if (hasMore) {
    options.push("More...", () => promptChoice(player, title, choices, start + page.length));
  }
  pluginApi.sendMultiChatboxPrompt(player, title, ...options);
}

function craftGoldJewellery(player, type, gemIndex) {
  const gem = JEWELLERY_GEMS[gemIndex];
  const [itemId, level, xp] = type.products[gemIndex];
  const inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < level) {
    player.sendMessage(`You need a Crafting level of at least ${level} to craft this.`);
    return;
  }
  if (
    !inventory.contains(ItemIds.GOLD_BAR) ||
    !inventory.contains(type.mouldId) ||
    (gem.gemId !== null && !inventory.contains(gem.gemId))
  ) {
    return;
  }
  player.performAnimation(FURNACE_ANIMATION);
  inventory.deleteNumber(ItemIds.GOLD_BAR, 1);
  if (gem.gemId !== null) {
    inventory.deleteNumber(gem.gemId, 1);
  }
  inventory.addItem(new Item(itemId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, xp);
  const name = `${gem.name} ${type.name}`;
  player.sendMessage(`You make ${/^[aeiou]/.test(name) ? "an" : "a"} ${name}.`);
}

/** Second step: pick plain gold or any gem carried that the player's level allows. */
function chooseGoldJewelleryGem(player, type) {
  const inventory = player.getInventory();
  const level = player.getSkillManager().getCurrentLevel(Skill.CRAFTING);
  const available = JEWELLERY_GEMS
    .map((gem, index) => ({ gem, index }))
    .filter(({ gem }) => gem.gemId === null || inventory.contains(gem.gemId));
  const craftable = available.filter(({ index }) => level >= type.products[index][1]);
  if (craftable.length === 0) {
    const lowest = Math.min(...available.map(({ index }) => type.products[index][1]));
    player.sendMessage(`You need a Crafting level of at least ${lowest} to make a ${type.name}.`);
    return;
  }
  if (craftable.length === 1) {
    craftGoldJewellery(player, type, craftable[0].index);
    return;
  }
  promptChoice(
    player,
    `What kind of ${type.name} would you like to make?`,
    craftable.map(({ gem, index }) => ({
      label: capitalize(`${gem.name} ${type.name}`),
      run: () => craftGoldJewellery(player, type, index),
    }))
  );
}

/** A gold bar used on a furnace, with a mould (and optionally a cut gem), makes jewellery. */
function handleGoldJewellery(event) {
  const { player, object, itemId } = event;
  if (itemId !== ItemIds.GOLD_BAR) return;
  if (!FURNACE_NAMES.has(object?.getDefinition?.()?.getName?.())) return;

  const inventory = player.getInventory();
  const types = JEWELLERY_TYPES.filter((type) => inventory.contains(type.mouldId));
  if (types.length === 0) return;

  event.handled = true;
  if (types.length === 1) {
    chooseGoldJewelleryGem(player, types[0]);
    return;
  }
  promptChoice(
    player,
    "What would you like to make?",
    types.map((type) => ({
      label: capitalize(type.name),
      run: () => chooseGoldJewelleryGem(player, type),
    }))
  );
}

/** A ball of wool used on an unstrung amulet, in either order. */
function stringAmulet(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const unstrungId = usedItemId === ItemIds.BALL_OF_WOOL ? usedWithItemId : usedItemId;
  const woolId = usedItemId === ItemIds.BALL_OF_WOOL ? usedItemId : usedWithItemId;
  const strungId = STRUNG_AMULETS.get(unstrungId);
  if (woolId !== ItemIds.BALL_OF_WOOL || strungId === undefined) return;

  event.handled = true;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.BALL_OF_WOOL) || !inventory.contains(unstrungId)) return;
  inventory.deleteNumber(ItemIds.BALL_OF_WOOL, 1);
  inventory.deleteNumber(unstrungId, 1);
  inventory.addItem(new Item(strungId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, STRING_AMULET_XP);
  player.sendMessage("You put some string on the amulet.");
}

/**
 * Wiki (Silver sickle): a silver bar on a furnace with a sickle mould makes a
 * silver sickle, 18 Crafting, 50 XP. The mould is kept. Nature Spirit needs it.
 */
const SILVER_SICKLE_RECIPE = {
  itemId: ItemIds.SILVER_SICKLE,
  mouldId: ItemIds.SICKLE_MOULD,
  level: 18,
  xp: 50,
};

function handleSilverSickle(event) {
  const { player, object, itemId } = event;
  if (itemId !== ItemIds.SILVER_BAR) return;
  if (!FURNACE_NAMES.has(object?.getDefinition?.()?.getName?.())) return;
  const inventory = player.getInventory();
  if (!inventory.contains(SILVER_SICKLE_RECIPE.mouldId)) return;
  event.handled = true;
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < SILVER_SICKLE_RECIPE.level) {
    player.sendMessage(`You need a Crafting level of at least ${SILVER_SICKLE_RECIPE.level} to craft this.`);
    return;
  }
  if (!inventory.contains(ItemIds.SILVER_BAR)) return;
  inventory.deleteNumber(ItemIds.SILVER_BAR, 1);
  inventory.addItem(new Item(SILVER_SICKLE_RECIPE.itemId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, SILVER_SICKLE_RECIPE.xp);
  player.sendMessage("You craft a silver sickle.");
}

/** Using a container of water on clay softens it and returns the empty container. */
function makeSoftClay(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const waterId = WATER_CONTAINERS.has(usedItemId) ? usedItemId : usedWithItemId;
  const clayId = usedItemId === ItemIds.CLAY ? usedItemId : usedWithItemId;
  if (!WATER_CONTAINERS.has(waterId) || clayId !== ItemIds.CLAY) return;

  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.CLAY) || !inventory.contains(waterId)) {
    event.handled = true;
    return;
  }
  inventory.deleteNumber(ItemIds.CLAY, 1);
  inventory.deleteNumber(waterId, 1);
  inventory.addItem(new Item(ItemIds.SOFT_CLAY, 1));
  inventory.addItem(new Item(WATER_CONTAINERS.get(waterId), 1));
  event.handled = true;
}

function craftUnfired(player, recipe) {
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.SOFT_CLAY)) return;
  player.performAnimation(POTTERY_WHEEL_ANIMATION);
  inventory.deleteNumber(ItemIds.SOFT_CLAY, 1);
  inventory.addItem(new Item(recipe.unfiredId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, recipe.shapingXp);
}

/** Wheel Use (or soft clay used on it): shape one soft clay into an unfired item. */
function usePotterWheel(event) {
  const { player } = event;
  event.handled = true;
  if (!player.getInventory().contains(ItemIds.SOFT_CLAY)) {
    player.sendMessage("You need soft clay to make pottery.");
    return;
  }
  const craftingLevel = player.getSkillManager().getCurrentLevel(Skill.CRAFTING);
  const recipes = POTTERY.filter((recipe) => craftingLevel >= recipe.level);
  if (recipes.length === 1) {
    craftUnfired(player, recipes[0]);
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    player,
    "What would you like to make?",
    ...recipes.flatMap((recipe) => [recipe.name, () => craftUnfired(player, recipe)])
  );
}

function firePottery(player, recipe) {
  const inventory = player.getInventory();
  if (!inventory.contains(recipe.unfiredId)) return;
  inventory.deleteNumber(recipe.unfiredId, 1);
  inventory.addItem(new Item(recipe.firedId, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, recipe.firingXp);
}

/** Oven Fire (or an unfired item used on it): fire one unfired item, no level needed. */
function usePotteryOven(event) {
  const { player } = event;
  event.handled = true;
  const inventory = player.getInventory();
  const recipes = POTTERY.filter((recipe) => inventory.contains(recipe.unfiredId));
  if (recipes.length === 0) {
    player.sendMessage("You have no unfired pottery to fire.");
    return;
  }
  if (recipes.length === 1) {
    firePottery(player, recipes[0]);
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    player,
    "What would you like to fire?",
    ...recipes.flatMap((recipe) => [recipe.name, () => firePottery(player, recipe)])
  );
}

/** Soft clay on a wheel, unfired pottery on a pottery oven. */
function handlePotteryItemOnObject(event) {
  const objectName = event.object?.getDefinition?.()?.getName?.();
  if (POTTER_WHEEL_NAMES.has(objectName) && event.itemId === ItemIds.SOFT_CLAY) {
    usePotterWheel(event);
  } else if (POTTERY_OVEN_NAMES.has(objectName) && POTTERY_BY_UNFIRED.has(event.itemId)) {
    event.handled = true;
    firePottery(event.player, POTTERY_BY_UNFIRED.get(event.itemId));
  }
}

module.exports = {
  name: "Crafting",
  register(api) {
    pluginApi = api;
    api.onItemOnItem(cutGem, { noted: false });
    api.onItemOnItem(makeSoftClay, { noted: false });
    api.onItemOnItem(blowGlass, { noted: false });
    api.onItemOnItem(stringAmulet, { noted: false });
    api.onItemOnObject(handlePerfectJewellery, { noted: false });
    api.onItemOnObject(handleGoldJewellery, { noted: false });
    api.onItemOnObject(handleSilverSickle, { noted: false });
    api.onItemOnObject(handlePotteryItemOnObject, { noted: false });
    api.onObjectInteraction("Potter's Wheel", { Use: usePotterWheel });
    api.onObjectInteraction("Potter's wheel", { Use: usePotterWheel });
    api.onObjectInteraction("Pottery Oven", { Fire: usePotteryOven });
    api.log("registered", {
      gems: GEMS.size,
      perfectJewellery: PERFECT_JEWELLERY.length,
      goldJewellery: JEWELLERY_TYPES.length * JEWELLERY_GEMS.length,
      strungAmulets: STRUNG_AMULETS.size,
      pottery: POTTERY.length,
    });
  },
};