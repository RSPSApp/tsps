/**
 * Cutting gems and amethyst with a chisel.
 *
 * rsprox captures (recordings 1875, 2246, 4211): a chisel on an uncut gem opens skillmulti mode
 * 12, "How many gems would you like to cut?", offering the gem up to the number carried. The
 * first gem is cut on the tick after the choice and one more every 2 ticks, each with the
 * gem's cutting animation, sound 2586 and "You cut the diamond.". A semi-precious gem can be
 * smashed instead: "You mis-hit the chisel and smash the jade to pieces!", a crushed gem and
 * sound 2589 as well.
 *
 * Wiki (Crafting#Gems, Crushed gem, Jeweller's chisel): levels and XP; the crush chance is the
 * skilling curve between the Wiki's low and high values, and a Jeweller's chisel adds 20% to it
 * and has a 10% chance to cut a second gem at once. Wiki (Amethyst): one amethyst makes 15 bolt
 * tips, 15 arrowtips, 5 javelin tips or 8 dart tips for 60 XP, 2 ticks each.
 */
const Shared = require("./Shared.Crafting");

const GEM_MENU_TITLE = "How many gems would you like to cut?";
const GEM_MENU_MODE = 12;
const AMETHYST_MENU_TITLE = "What would you like to make?";
const AMETHYST_MENU_MODE = 0;
const GEM_CUTTING_SOUND = 2586;
const GEM_CRUSHED_SOUND = 2589;
const JEWELLERS_CHISEL_SUCCESS_BONUS = 0.2;
const JEWELLERS_CHISEL_DOUBLE_CHANCE = 0.1;

let tables = null;

/** The gem and amethyst recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { ItemIds: I, Animation, Sound } = Shared.getCore();
  const { gems, amethyst } = Shared.DATA;
  return tables = {
    chisels: new Set([I.CHISEL, I.JEWELLERS_CHISEL]),
    gems: new Map(gems.recipes.map((gem) => {
      const uncut = Shared.itemId(gem.uncut);
      return [uncut, { ...gem, uncut, cut: Shared.itemId(gem.cut), animation: new Animation(gem.seq), crush: gem.crush ?? null }];
    })),
    amethyst: amethyst.recipes.map((recipe) => ({ ...recipe, itemId: Shared.itemId(recipe.item) })),
    amethystAnimation: new Animation(amethyst.seq),
    cuttingSound: new Sound(GEM_CUTTING_SOUND, 1, 0, 0),
    crushedSound: new Sound(GEM_CRUSHED_SOUND, 1, 0, 0),
  };
}

/** The OSRS skilling success curve: low at level 1, high at 99, out of 256. */
function cutChance(level, { low, high }) {
  const clamped = Math.min(Math.max(level, 1), 99);
  return (1 + Math.floor(low * (99 - clamped) / 98 + high * (clamped - 1) / 98 + 0.5)) / 256;
}

function chiselOf(player) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  return inventory.contains(I.JEWELLERS_CHISEL) ? I.JEWELLERS_CHISEL : inventory.contains(I.CHISEL) ? I.CHISEL : null;
}

/** The chisel and the other item of a chisel use, or null when it isn't one. */
function chiselPair(event) {
  const { chisels } = data();
  if (chisels.has(event.usedItemId)) return event.usedWithItemId;
  if (chisels.has(event.usedWithItemId)) return event.usedItemId;
  return null;
}

function gemName(gem) {
  return Shared.itemName(gem.cut).toLowerCase();
}

/** Cuts one gem: crushed on a failed roll for semi-precious gems, sometimes two with a Jeweller's chisel. */
function cutOne(player, gem) {
  const { ItemIds: I, Item } = Shared.getCore();
  const { crushedSound } = data();
  const inventory = player.getInventory();
  if (!inventory.contains(gem.uncut) || chiselOf(player) === null) return false;
  const jewellers = chiselOf(player) === I.JEWELLERS_CHISEL;
  inventory.deleteNumber(gem.uncut, 1);
  if (gem.crush) {
    const chance = cutChance(Shared.craftingLevel(player), gem.crush) + (jewellers ? JEWELLERS_CHISEL_SUCCESS_BONUS : 0);
    if (Math.random() >= chance) {
      inventory.addItem(new Item(I.CRUSHED_GEM, 1));
      Shared.addCraftingXp(player, gem.crush.xp);
      Shared.animate(player, null, crushedSound);
      player.sendMessage(`You mis-hit the chisel and smash the ${gemName(gem)} to pieces!`);
      return true;
    }
  }
  inventory.addItem(new Item(gem.cut, 1));
  Shared.addCraftingXp(player, gem.xp);
  player.sendMessage(`You cut the ${gemName(gem)}.`);
  if (jewellers && inventory.contains(gem.uncut) && Math.random() < JEWELLERS_CHISEL_DOUBLE_CHANCE) {
    inventory.deleteNumber(gem.uncut, 1);
    inventory.addItem(new Item(gem.cut, 1));
    Shared.addCraftingXp(player, gem.xp);
  }
  return true;
}

function cutGem(event) {
  const { player } = event;
  const gem = data().gems.get(chiselPair(event));
  if (!gem || (gem.members && !Shared.isMembersWorld())) return;
  event.handled = true;

  if (Shared.craftingLevel(player) < gem.level) {
    // ponytail: not captured; the live text may differ.
    player.sendMessage(`You need a Crafting level of at least ${gem.level} to cut this gem.`);
    return;
  }
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: GEM_MENU_TITLE,
    mode: GEM_MENU_MODE,
    items: [{ itemId: gem.uncut }],
    maxAmount: player.getInventory().getAmount(gem.uncut),
    choose: (_item, amount) => Shared.startMaking(player, {
      amount, startTick: null, firstTick: 1, interval: 2, animation: gem.animation, sound: data().cuttingSound,
      has: () => player.getInventory().contains(gem.uncut) && chiselOf(player) !== null,
      make: () => cutOne(player, gem),
    }),
  });
}

function cutAmethyst(player, recipe) {
  const { ItemIds: I, Item } = Shared.getCore();
  const inventory = player.getInventory();
  if (!inventory.contains(I.AMETHYST) || chiselOf(player) === null) return false;
  inventory.deleteNumber(I.AMETHYST, 1);
  inventory.addItem(new Item(recipe.itemId, recipe.amount));
  Shared.addCraftingXp(player, recipe.xp);
  return true;
}

function startAmethyst(player, recipe, amount) {
  const I = Shared.getCore().ItemIds;
  if (Shared.craftingLevel(player) < recipe.level) {
    // ponytail: not captured; follows the glassblowing message.
    player.sendMessage(`You need level ${recipe.level} Crafting to make ${Shared.itemName(recipe.itemId).toLowerCase()}.`);
    return;
  }
  Shared.startMaking(player, {
    amount, startTick: null, firstTick: 1, interval: 2, animation: data().amethystAnimation,
    has: () => player.getInventory().contains(I.AMETHYST) && chiselOf(player) !== null,
    make: () => cutAmethyst(player, recipe),
  });
}

function handleAmethyst(event) {
  const { player } = event;
  const I = Shared.getCore().ItemIds;
  if (chiselPair(event) !== I.AMETHYST || !Shared.isMembersWorld()) return;
  event.handled = true;
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: AMETHYST_MENU_TITLE,
    mode: AMETHYST_MENU_MODE,
    items: data().amethyst,
    maxAmount: player.getInventory().getAmount(I.AMETHYST),
    choose: (recipe, amount) => startAmethyst(player, recipe, amount),
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(cutGem, { noted: false });
  api.onItemOnItem(handleAmethyst, { noted: false });
};

module.exports.cutChance = cutChance;
