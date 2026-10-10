"use strict";

/**
 * The Mess's recipe chains: item-on-item steps and the clay oven's transforms.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Mess and the servery item pages. Intermediate
 * steps cost no XP; the oven's low/high are the pages' skilling success charts, rolled with
 * the same formula Woodcutting.plugin.js uses (successes out of 256), and the dishes stop
 * burning at 53/58/68 (raw meat at 34; the chart alone reaches it there).
 *
 * The Wiki does not record what a burnt servery dish becomes; the generic burnt pie, stew,
 * pizza and meat stand in.
 */

const Shared = require("./Shared.TheMess");
const { ITEM } = Shared;

/** Pairs, either order, both consumed; `product` replaces them. */
const COMBINES = Object.freeze([
  { a: ITEM.PASTRY_DOUGH, b: ITEM.DISH, product: ITEM.PIE_SHELL, level: 20 },
  { a: ITEM.COOKED_MEAT, b: ITEM.PIE_SHELL, product: ITEM.UNCOOKED_PIE, level: 20 },
  { a: ITEM.PIZZA_BASE, b: ITEM.TOMATO, product: ITEM.INCOMPLETE_PIZZA, level: 65 },
  { a: ITEM.INCOMPLETE_PIZZA, b: ITEM.CHEESE, product: ITEM.UNCOOKED_PIZZA, level: 65 },
  { a: ITEM.COOKED_MEAT, b: ITEM.BOWL_OF_WATER, product: ITEM.STEW_MEAT, level: 25 },
  { a: ITEM.POTATO, b: ITEM.BOWL_OF_WATER, product: ITEM.STEW_POTATO, level: 25 },
  { a: ITEM.STEW_MEAT, b: ITEM.POTATO, product: ITEM.UNCOOKED_STEW, level: 25 },
  { a: ITEM.STEW_POTATO, b: ITEM.COOKED_MEAT, product: ITEM.UNCOOKED_STEW, level: 25 },
]);

/** Bowl of water + servery flour is both doughs; the Wiki strategy picks with 1 or 2. */
const FLOUR_WATER = Object.freeze({
  PASTRY: { product: ITEM.PASTRY_DOUGH, level: 20 },
  PIZZA: { product: ITEM.PIZZA_BASE, level: 65 },
});

/** Pineapple pizza: chunks on a plain pizza, 3 ticks and 5 XP (Wiki). */
const PINEAPPLE_PIZZA = Object.freeze({
  a: ITEM.PINEAPPLE_CHUNKS,
  b: ITEM.PLAIN_PIZZA,
  product: ITEM.PINEAPPLE_PIZZA,
  level: 65,
  xp: 5,
  ticks: 3,
});

/**
 * The oven's cookables. low/high are the Wiki skilling charts (out of 256 at levels 1/99),
 * xp and levels the recipe infoboxes; cooked meat burns until 34 like ordinary meat.
 */
const COOKS = Object.freeze([
  { raw: ITEM.RAW_MEAT, cooked: ITEM.COOKED_MEAT, burnt: ITEM.BURNT_MEAT, level: 1, xp: 1, low: 128, high: 512, stopBurn: 34, name: "servery raw meat" },
  { raw: ITEM.UNCOOKED_PIE, cooked: ITEM.MEAT_PIE, burnt: ITEM.BURNT_PIE, level: 20, xp: 3, low: 78, high: 412, stopBurn: 53, name: "servery uncooked pie" },
  { raw: ITEM.UNCOOKED_STEW, cooked: ITEM.STEW, burnt: ITEM.BURNT_STEW, level: 25, xp: 4, low: 68, high: 392, stopBurn: 58, name: "servery uncooked stew" },
  { raw: ITEM.UNCOOKED_PIZZA, cooked: ITEM.PLAIN_PIZZA, burnt: ITEM.BURNT_PIZZA, level: 65, xp: 5, low: 48, high: 352, stopBurn: 68, name: "servery uncooked pizza" },
]);
const COOK_BY_RAW = new Map(COOKS.map((cook) => [cook.raw, cook]));

function later(ticks, action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(0, ticks));
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function pairMatches(used, withItem, a, b) {
  return (used === a && withItem === b) || (used === b && withItem === a);
}

function refuseLevel(player, level) {
  player.sendMessage(`You need a Cooking level of at least ${level} to make this.`);
  return false;
}

/** Removes one of each id; false and no change unless all are held. */
function consume(player, ...ids) {
  const inventory = player.getInventory();
  for (const id of ids) if (!inventory.contains(id)) return false;
  for (const id of ids) inventory.deleteNumber(id, 1);
  return true;
}

function give(player, id, amount = 1) {
  player.getInventory().addItem(new (Shared.core().Item)(id, amount));
}

/** Water + flour: pastry dough below 65, a dough/pizza-base choice at 65+. */
function flourWater(player) {
  if (Shared.level(player) < FLOUR_WATER.PASTRY.level) {
    return refuseLevel(player, FLOUR_WATER.PASTRY.level);
  }
  if (Shared.level(player) >= FLOUR_WATER.PIZZA.level) {
    Shared.api().sendMultiChatboxPrompt(player, "What would you like to make?",
      "Servery pastry dough.", () => makeFlourWater(player, FLOUR_WATER.PASTRY.product),
      "Servery pizza base.", () => makeFlourWater(player, FLOUR_WATER.PIZZA.product));
    return true;
  }
  return makeFlourWater(player, FLOUR_WATER.PASTRY.product);
}

function makeFlourWater(player, product) {
  if (!consume(player, ITEM.BOWL_OF_WATER, ITEM.FLOUR)) return false;
  give(player, product);
  return true;
}

/** Chunks on a plain pizza; the 3-tick auto-create of the Wiki's recipe. */
function assemblePineapplePizza(player) {
  if (Shared.level(player) < PINEAPPLE_PIZZA.level) return refuseLevel(player, PINEAPPLE_PIZZA.level);
  if (!consume(player, PINEAPPLE_PIZZA.a, PINEAPPLE_PIZZA.b)) return false;
  give(player, PINEAPPLE_PIZZA.product);
  player.getSkillManager().addExperiences(Shared.core().Skill.COOKING, PINEAPPLE_PIZZA.xp);
  return true;
}

/** The Wiki's skilling success roll; stopBurn is a guaranteed success. */
function cookSuccess(recipe, level, random = Math.random) {
  if (level >= recipe.stopBurn) return true;
  const successes = 1
    + Math.floor((recipe.low * (99 - level)) / 98)
    + Math.floor((recipe.high * (level - 1)) / 98);
  return random() * 256 < successes;
}

/** Cooks one item; returns false (with a message) when the level is too low. */
function cook(player, recipe, random = Math.random) {
  const inventory = player.getInventory();
  if (!inventory.contains(recipe.raw)) return false;
  const cookingLevel = Shared.level(player);
  if (cookingLevel < recipe.level) {
    player.sendMessage(`You need a Cooking level of at least ${recipe.level} to cook this.`);
    return false;
  }
  inventory.deleteNumber(recipe.raw, 1);
  if (cookSuccess(recipe, cookingLevel, random)) {
    give(player, recipe.cooked);
    player.getSkillManager().addExperiences(Shared.core().Skill.COOKING, recipe.xp);
    player.sendMessage(`You cook the ${recipe.name}.`);
  } else {
    give(player, recipe.burnt);
    player.sendMessage(`You burn the ${recipe.name}.`);
  }
  return true;
}

/** Item-on-item: every servery pair, the knife-sliced pineapple and the pizza assembly. */
function combine(event) {
  const { player, usedItemId, usedWithItemId } = event;

  if (pairMatches(usedItemId, usedWithItemId, ITEM.KNIFE, ITEM.PINEAPPLE)) {
    event.handled = true;
    if (!consume(player, ITEM.PINEAPPLE)) return;
    give(player, ITEM.PINEAPPLE_CHUNKS);
    return;
  }

  if (pairMatches(usedItemId, usedWithItemId, ITEM.BOWL_OF_WATER, ITEM.FLOUR)) {
    event.handled = true;
    flourWater(player);
    return;
  }

  if (pairMatches(usedItemId, usedWithItemId, PINEAPPLE_PIZZA.a, PINEAPPLE_PIZZA.b)) {
    event.handled = true;
    if (Shared.level(player) < PINEAPPLE_PIZZA.level) {
      refuseLevel(player, PINEAPPLE_PIZZA.level);
      return;
    }
    later(PINEAPPLE_PIZZA.ticks, () => assemblePineapplePizza(player));
    return;
  }

  const recipe = COMBINES.find((step) => pairMatches(usedItemId, usedWithItemId, step.a, step.b));
  if (!recipe) return;
  event.handled = true;
  if (Shared.level(player) < recipe.level) {
    refuseLevel(player, recipe.level);
    return;
  }
  if (!consume(player, recipe.a, recipe.b)) return;
  give(player, recipe.product);
}

module.exports = {
  COMBINES,
  FLOUR_WATER,
  PINEAPPLE_PIZZA,
  COOKS,
  COOK_BY_RAW,
  later,
  pairMatches,
  consume,
  give,
  flourWater,
  makeFlourWater,
  assemblePineapplePizza,
  cookSuccess,
  cook,
  combine,
};
