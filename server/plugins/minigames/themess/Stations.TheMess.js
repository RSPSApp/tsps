"use strict";

/**
 * The Mess's stations: the two cupboards, the sink, the meat table, the clay oven and the
 * buffet tables, plus the kitchen's refuse messages (Ewesey's lines from the Wiki transcript).
 *
 * The sink has no menu op in the cache, so bowls are filled by using them on it; the oven's
 * Cook op cooks the first servery cookable in the inventory one at a time, and food is used
 * on it one at a time as the Wiki strategy describes. Cupboard searches open the chatbox
 * choice instead of replicating interface 242 (HOSIDIUS_SERVERY), which the server does not
 * drive.
 */

const Shared = require("./Shared.TheMess");
const Recipes = require("./Recipes.TheMess");

const { ITEM, DISH, DISH_BY_ITEM, OBJECT } = Shared;

const FOOD_ITEMS = new Set([
  ITEM.FLOUR, ITEM.PASTRY_DOUGH, ITEM.RAW_MEAT, ITEM.PIE_SHELL, ITEM.UNCOOKED_PIE,
  ITEM.MEAT_PIE, ITEM.PIZZA_BASE, ITEM.TOMATO, ITEM.INCOMPLETE_PIZZA, ITEM.CHEESE,
  ITEM.UNCOOKED_PIZZA, ITEM.PLAIN_PIZZA, ITEM.PINEAPPLE, ITEM.PINEAPPLE_CHUNKS,
  ITEM.PINEAPPLE_PIZZA, ITEM.COOKED_MEAT, ITEM.POTATO, ITEM.STEW_POTATO, ITEM.STEW_MEAT,
  ITEM.UNCOOKED_STEW, ITEM.STEW,
]);
const UTENSIL_ITEMS = new Set([ITEM.DISH, ITEM.BOWL, ITEM.BOWL_OF_WATER, ITEM.KNIFE]);

const FOOD_STOCK = [
  ["Servery flour.", ITEM.FLOUR],
  ["Servery pineapple.", ITEM.PINEAPPLE],
  ["Servery potato.", ITEM.POTATO],
  ["Servery cheese.", ITEM.CHEESE],
  ["Servery tomato.", ITEM.TOMATO],
];
const UTENSIL_STOCK = [
  ["Servery dish.", ITEM.DISH],
  ["Bowl.", ITEM.BOWL],
  ["Knife.", ITEM.KNIFE],
];

// --- Searching the cupboards.

function chooseStock(player, stock) {
  const pairs = [];
  for (const [text, id] of stock) pairs.push(text, () => Recipes.give(player, id));
  Shared.api().sendMultiChatboxPrompt(player, "What would you like to take?", ...pairs);
}

function searchFood({ player }) {
  chooseStock(player, FOOD_STOCK);
}

function searchUtensils({ player }) {
  chooseStock(player, UTENSIL_STOCK);
}

// --- Meat table and sink.

function takeMeat({ player }) {
  Recipes.give(player, ITEM.RAW_MEAT);
}

function takeMeatX({ player }) {
  player.setEnteredAmountAction({
    execute: (amount) => {
      const count = Math.min(Math.floor(Number(amount)) || 0, player.getInventory().getFreeSlots());
      if (count > 0) Recipes.give(player, ITEM.RAW_MEAT, count);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt("How much raw meat would you like to take?");
}

function fillBowl({ player }) {
  if (!Recipes.consume(player, ITEM.BOWL)) return false;
  player.performAnimation(new (Shared.core().Animation)(832));
  Recipes.give(player, ITEM.BOWL_OF_WATER);
  player.sendMessage("You fill the bowl with water.");
  return true;
}

// --- Depositing back into the cupboards.

function deposit(player, objectId, itemId) {
  const allowed = objectId === OBJECT.UTENSIL_CUPBOARD ? UTENSIL_ITEMS.has(itemId) : FOOD_ITEMS.has(itemId);
  if (!allowed) return false;
  const inventory = player.getInventory();
  const amount = inventory.getAmount(itemId);
  if (amount <= 0) return false;
  inventory.deleteNumber(itemId, amount);
  player.sendMessage(amount > 1 ? "You put the items back in the cupboard." : "You put the item back in the cupboard.");
  return true;
}

// --- The oven.

function cookFromOven({ player }) {
  for (const recipe of Recipes.COOKS) {
    if (player.getInventory().contains(recipe.raw)) {
      Recipes.cook(player, recipe);
      return;
    }
  }
}

// --- The buffet tables.

const WRONG_INGREDIENT = "They're not going to eat anything you've got there. Make them meat pies, stew or pineapple pizza.";
const WRONG_FOOD = "They're not going to eat that. Make them meat pies, stew or pineapple pizza.";

function serve(player, itemId) {
  const dish = DISH_BY_ITEM.get(itemId);
  if (!dish) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return false;
  const session = Shared.sessionOf(player);
  const xp = Shared.xpFor(dish, session.appreciation[dish.key]);
  inventory.deleteNumber(itemId, 1);
  Shared.applyServe(session, dish);
  player.getSkillManager().addExperiences(Shared.core().Skill.COOKING, xp);
  Shared.syncHud(player, session);
  player.sendMessage(`You serve the ${dish.name}.`);
  return true;
}

function serveFromTable({ player }) {
  const present = Object.values(DISH).filter((dish) => player.getInventory().contains(dish.id));
  if (present.length === 0) return;
  if (present.length === 1) {
    serve(player, present[0].id);
    return;
  }
  const pairs = [];
  for (const dish of present) pairs.push(`Serve a ${dish.name}.`, () => serve(player, dish.id));
  Shared.api().sendMultiChatboxPrompt(player, "What would you like to serve?", ...pairs);
}

function wrongDish(player, itemId) {
  player.sendMessage(Shared.SERVERY_ITEM_IDS.has(itemId) ? WRONG_INGREDIENT : WRONG_FOOD);
}

// --- Using an item on a station.

function useOnObject(event) {
  const { player, objectId, itemId } = event;
  switch (objectId) {
    case OBJECT.SINK:
      if (itemId !== ITEM.BOWL) return;
      event.handled = true;
      fillBowl(event);
      return;
    case OBJECT.CLAY_OVEN: {
      const recipe = Recipes.COOK_BY_RAW.get(itemId);
      if (!recipe) return; // the oven cooks only servery food
      event.handled = true;
      Recipes.cook(player, recipe);
      return;
    }
    case OBJECT.BUFFET_TABLE:
      event.handled = true;
      if (DISH_BY_ITEM.has(itemId)) serve(player, itemId);
      else wrongDish(player, itemId);
      return;
    case OBJECT.FOOD_CUPBOARD:
    case OBJECT.UTENSIL_CUPBOARD:
      event.handled = true;
      deposit(player, objectId, itemId);
      return;
    default:
  }
}

// --- Eating servery food.

function refuseEat(event) {
  if (event.option !== "Eat" || !Shared.SERVERY_ITEM_IDS.has(event.itemId)) return;
  event.handled = true;
  event.player.sendMessage("Hey, that's not for you!");
}

function canEat(event) {
  if (Shared.SERVERY_ITEM_IDS.has(event.itemId)) event.allow = false;
}

// --- Ewesey's transcript conditions.

function eweseyCondition({ npcId, player, text }) {
  if (npcId !== Shared.core().NpcIdentifiers.EWESEY) return null;
  if (text === "With less than 20 Cooking:") return Shared.level(player) < 20;
  if (text === "With at least 20 Cooking:") return Shared.level(player) >= 20;
  // Kourend favour was removed from the game; the Wiki change note drops the requirement.
  if (/does not have enough Hosidius Favour/i.test(text)) return false;
  if (/has enough Hosidius Favour/i.test(text)) return true;
  return null;
}

// --- The Mess's HUD and cleanup.

function enterMess({ player }) {
  Shared.openHud(player, Shared.sessionOf(player));
}

function leaveMess({ player }) {
  Shared.cleanUp(player);
}

function logout({ player }) {
  Shared.cleanUp(player);
}

function disconnect({ player }) {
  Shared.forget(player);
}

module.exports = function registerStations(api) {
  api.onObjectInteraction("Food cupboard", { Search: searchFood });
  api.onObjectInteraction("Utensil cupboard", { Search: searchUtensils });
  api.onObjectInteraction("Meat table", { Take: takeMeat, "Take-X": takeMeatX });
  api.onObjectInteraction("Buffet table", { Serve: serveFromTable });
  api.onObjectInteraction("Clay oven", { Cook: cookFromOven });
  api.onItemOnObject(useOnObject, { noted: false });
  api.onItemOnItem(Recipes.combine, { noted: false });
  api.onItemAction(refuseEat);
  api.onCanEat(canEat);
  api.onNpcDialogueCondition(eweseyCondition);
  api.onZoneEnter(Shared.MESS_ZONE, enterMess);
  api.onZoneExit(Shared.MESS_ZONE, leaveMess);
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(disconnect);
  api.onServerStartup(Shared.startDecay);
  api.onServerShutdown(Shared.stopDecay);
};

module.exports._test = {
  searchFood,
  searchUtensils,
  takeMeat,
  takeMeatX,
  fillBowl,
  cookFromOven,
  deposit,
  serve,
  serveFromTable,
  useOnObject,
  refuseEat,
  canEat,
  eweseyCondition,
  enterMess,
  leaveMess,
};
