"use strict";

/**
 * The raid's Herblore: cleaning its herbs and mixing its gourd potions.
 *
 * Wiki (Chambers of Xeric, Herblore; Golpar, Buchu leaf, Noxifer):
 * - Cleaning golpar, buchu and noxifer needs Herblore 47, 52 and 60, for 1, 2 and 3 XP.
 * - A clean herb, its second ingredient and a water-filled gourd make a 4-dose potion; overloads
 *   are noxifer and an elder, twisted and kodai potion of a strength (no gourd).
 * - Golpar with stinkhorn mushroom, cicely or endarkened juice: elder, twisted or kodai.
 *   Buchu: revitalisation, prayer enhance or Xeric's aid. Noxifer with cicely: antipoison.
 * - The strength made is the best the Herblore level allows (weak / normal / strong levels below);
 *   an overload made from stronger potions than the level allows comes out weaker.
 * Not on the Wiki, and no capture cleans a herb or mixes a potion (the raid potions in them are
 *   all boss drops): mixing is a make-X choice of every potion the inventory allows, one each
 *   tick (anim 363, sound 2608), cleaning one every 2 ticks (sound 3923); the messages.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Supplies = require("./Supplies.ChambersOfXeric");

const WATER_GOURD = 20801;
const SECONDARY = { STINKHORN: 20910, ENDARKENED: 20911, CICELY: 20912 };
const HERBS = [
  { name: "golpar", grimy: 20904, clean: 20905, level: 47, xp: 1 },
  { name: "buchu leaf", grimy: 20907, clean: 20908, level: 52, xp: 2 },
  { name: "noxifer", grimy: 20901, clean: 20902, level: 60, xp: 3 },
];
const GRIMY_NAMES = HERBS.map((herb) => `Grimy ${herb.name}`);
const HERB_BY_GRIMY = new Map(HERBS.map((herb) => [herb.grimy, herb]));
const [GOLPAR, BUCHU, NOXIFER] = HERBS;

/** Each potion by strength: [weak, normal, strong] 4-dose ids, levels and XP (Wiki). */
const GOLPAR_TIERS = { levels: [47, 59, 70], xp: [6.5, 10, 13] };
const BUCHU_TIERS = { levels: [52, 65, 78], xp: [13.5, 20, 26.5] };
const POTIONS = [
  { name: "elder potion", herb: GOLPAR, secondary: SECONDARY.STINKHORN, ids: [20916, 20920, 20924], ...GOLPAR_TIERS },
  { name: "twisted potion", herb: GOLPAR, secondary: SECONDARY.CICELY, ids: [20928, 20932, 20936], ...GOLPAR_TIERS },
  { name: "kodai potion", herb: GOLPAR, secondary: SECONDARY.ENDARKENED, ids: [20940, 20944, 20948], ...GOLPAR_TIERS },
  { name: "revitalisation potion", herb: BUCHU, secondary: SECONDARY.STINKHORN, ids: [20952, 20956, 20960], ...BUCHU_TIERS },
  { name: "prayer enhance potion", herb: BUCHU, secondary: SECONDARY.CICELY, ids: [20964, 20968, 20972], ...BUCHU_TIERS },
  { name: "xeric's aid potion", herb: BUCHU, secondary: SECONDARY.ENDARKENED, ids: [20976, 20980, 20984], ...BUCHU_TIERS },
  { name: "antipoison", herb: NOXIFER, secondary: SECONDARY.CICELY, ids: [25757, 25761, 25765], levels: [60, 75, 90], xp: [13.5, 20, 26.5] },
];
const OVERLOAD = { name: "overload", herb: NOXIFER, ids: [20988, 20992, 20996], levels: [60, 75, 90], xp: [33.5, 50, 66.5] };
const [ELDER, TWISTED, KODAI] = POTIONS;
const INGREDIENTS = new Set([WATER_GOURD, ...Object.values(SECONDARY), ...HERBS.map((herb) => herb.clean),
  ...[ELDER, TWISTED, KODAI].flatMap((potion) => potion.ids)]);

/** The strongest strength (0-2) a Herblore level makes of a potion, or -1. */
function tierFor(potion, level) {
  let tier = -1;
  potion.levels.forEach((needed, index) => {
    if (level >= needed) tier = index;
  });
  return tier;
}

/**
 * What an inventory can mix now: [{ potion, tier, take: [ids] }]. An overload takes the
 * strongest set of three it has, made no stronger than the level allows.
 */
function mixable(player) {
  const level = Shared.level(player, "HERBLORE");
  const has = (id) => Shared.has(player, id);
  const recipes = [];
  for (const potion of POTIONS) {
    const tier = tierFor(potion, level);
    if (tier >= 0 && has(potion.herb.clean) && has(potion.secondary) && has(WATER_GOURD)) {
      recipes.push({ potion, tier, outcome: potion.ids[tier], take: [potion.herb.clean, potion.secondary, WATER_GOURD] });
    }
  }
  const cap = tierFor(OVERLOAD, level);
  if (cap >= 0 && has(NOXIFER.clean)) {
    for (let set = 2; set >= 0; set--) {
      const inputs = [ELDER, TWISTED, KODAI].map((potion) => potion.ids[set]);
      if (!inputs.every(has)) continue;
      const tier = Math.min(set, cap);
      recipes.push({ potion: OVERLOAD, tier, outcome: OVERLOAD.ids[tier], take: [NOXIFER.clean, ...inputs] });
      break;
    }
  }
  return recipes;
}

function itemName(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.()?.toLowerCase() ?? "item";
}

// ---------------------------------------------------------------- cleaning

function cleanOne(player, herb) {
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex((item) => item?.getId() === herb.grimy);
  if (slot < 0) return false;
  if (Shared.level(player, "HERBLORE") < herb.level) {
    player.sendMessage(`You need a Herblore level of at least ${herb.level} to clean a ${herb.name}.`);
    return false;
  }
  inventory.setItem(slot, new (Shared.core().Item)(herb.clean, 1)).refreshItems();
  Shared.sound(player, 3923);
  Shared.addXp(player, "HERBLORE", herb.xp);
  player.sendMessage(`You clean the ${herb.name}.`);
  return true;
}

function cleanHerbs(event) {
  const { player, itemId } = event;
  const herb = HERB_BY_GRIMY.get(itemId);
  if (!herb || !cleanOne(player, herb)) return true;
  Shared.action(player, { first: 2, interval: 2, step: () => cleanOne(player, herb) });
  return true;
}

// ---------------------------------------------------------------- mixing

function mixOne(player, outcome) {
  const recipe = mixable(player).find((entry) => entry.outcome === outcome);
  if (!recipe) {
    const potion = [...POTIONS, OVERLOAD].find((entry) => entry.ids.includes(outcome));
    player.sendMessage(`You don't have the ingredients to mix ${potion ? `a ${potion.name}` : "that"}.`);
    return false;
  }
  for (const id of recipe.take) player.getInventory().delete(id, 1);
  Shared.give(player, recipe.outcome);
  Shared.animate(player, 363);
  Shared.sound(player, 2608);
  Shared.addXp(player, "HERBLORE", recipe.potion.xp[recipe.tier]);
  const others = recipe.take.slice(1).filter((id) => id !== WATER_GOURD).map(itemName);
  const joined = others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0];
  player.sendMessage(`You mix your ${recipe.potion.herb.name} together with your ${joined} into a potion perfectly!`);
  Supplies.credit(player, recipe.outcome);
  return true;
}

function mix(player) {
  const recipes = mixable(player);
  if (recipes.length === 0) return false;
  const { CreationMenu } = Shared.core();
  const outcomes = recipes.map((recipe) => recipe.outcome);
  player.getPacketSender().sendCreationMenu(new CreationMenu("What would you like to make?", outcomes, {
    execute(outcome, amount) {
      let left = Math.max(1, amount);
      if (!mixOne(player, outcome) || --left <= 0) return;
      Shared.action(player, { first: 1, interval: 1, step: () => mixOne(player, outcome) && --left > 0 });
    },
  }));
  return true;
}

function itemOnItem(event) {
  const { player, usedItemId, usedWithItemId } = event;
  if (event.handled || !INGREDIENTS.has(usedItemId) || !INGREDIENTS.has(usedWithItemId)) return;
  if (mix(player)) event.handled = true;
}

module.exports = function registerCoxHerblore(api) {
  Shared.bind(api);
  for (const name of GRIMY_NAMES) api.onItemAction(name, { Clean: cleanHerbs });
  api.onItemOnItem(itemOnItem);
};

Object.assign(module.exports, { HERBS, POTIONS, OVERLOAD, mixable, tierFor, mixOne });
