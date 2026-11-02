/**
 * Soft clay, the potter's wheel and the pottery oven.
 *
 * Wiki (Crafting#Pottery): soft clay is shaped on a potter's wheel and the unfired piece
 * fired in a pottery oven, which has no Crafting level requirement. One soft clay shapes four
 * unfired cups. One Small Favour teaches pot lids.
 * rsprox captures 3121, 1757, 1858, 1098: quantity menus and delayed shaping/firing, the
 * shaping and oven lines on the spam channel, and a message box naming the pottery when an oven
 * choice isn't carried. 1692, 73, 86, 1098: the soft clay line.
 * See docs/crafting.md for source details and the unconfirmed cup crack rate.
 */
const Shared = require("./Shared.Crafting");

const POTTER_WHEEL_NAMES = new Set(["Potter's Wheel", "Potter's wheel"]);
const POTTERY_OVEN_NAMES = new Set(["Pottery Oven"]);

const SOFT_CLAY_MESSAGE = "You mix the clay and water.<br>You now have some soft workable clay.";

const SHAPE_MENU_MODE = 0;
const FIRE_MENU_MODE = 9;

let tables = null;

/** The pottery recipes and water containers from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation, Sound } = Shared.getCore();
  const { pottery } = Shared.DATA;
  const recipes = pottery.recipes.map((recipe) => ({
    ...recipe, unfiredId: Shared.itemId(recipe.unfired), firedId: Shared.itemId(recipe.fired),
  }));
  return tables = {
    pottery: recipes,
    byUnfired: new Map(recipes.map((recipe) => [recipe.unfiredId, recipe])),
    // Wiki (Soft clay): a container of water on clay makes soft clay and leaves it empty.
    waterContainers: new Map(pottery.waterContainers.map(([full, empty]) => [Shared.itemId(full), Shared.itemId(empty)])),
    wheelAnimation: new Animation(pottery.seq),
    ovenAnimation: new Animation(pottery.ovenSeq),
    wheelSound: new Sound(pottery.sound, 1, 0, 0),
    ovenSound: new Sound(pottery.ovenSound, 1, 0, 0),
  };
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Shared.getCore().ChatType.SPAM, text);
}

/** Using a container of water on clay softens it and returns the empty container. */
function makeSoftClay(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const { ItemIds: I, Item } = Shared.getCore();
  const { waterContainers } = data();
  const waterId = waterContainers.has(usedItemId) ? usedItemId : usedWithItemId;
  const clayId = usedItemId === I.CLAY ? usedItemId : usedWithItemId;
  if (!waterContainers.has(waterId) || clayId !== I.CLAY) return;

  const inventory = player.getInventory();
  if (!inventory.contains(I.CLAY) || !inventory.contains(waterId)) {
    event.handled = true;
    return;
  }
  inventory.deleteNumber(I.CLAY, 1);
  inventory.deleteNumber(waterId, 1);
  inventory.addItem(new Item(I.SOFT_CLAY, 1));
  inventory.addItem(new Item(waterContainers.get(waterId), 1));
  spam(player, SOFT_CLAY_MESSAGE);
  event.handled = true;
}

/** The quest runtime owns the saved stage; recipe data declares the unlock. */
function recipeUnlocked(player, recipe) {
  if (!recipe.unlock) return true;
  const request = { player, key: recipe.unlock.quest, stage: 0 };
  Shared.getApi().emitCustomEvent("quest:get-stage", request);
  return request.stage >= recipe.unlock.stage;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = Shared.getCore();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function canShape(player, recipe) {
  return Shared.craftingLevel(player) >= recipe.level && recipeUnlocked(player, recipe);
}

/** Wiki's estimated statrandomlow/high (180/800): guaranteed from level 13. Cups unconfirmed. */
function firingChance(level) {
  const clamped = Math.max(1, Math.min(99, level));
  return Math.min(1, (1 + Math.floor(180 * (99 - clamped) / 98 + 800 * (clamped - 1) / 98 + 0.5)) / 256);
}

function makePottery(player, recipe, firing) {
  const { Item } = Shared.getCore();
  const inventory = player.getInventory();
  const input = firing ? recipe.unfiredId : Shared.getCore().ItemIds.SOFT_CLAY;
  if (!inventory.contains(input) || (!firing && !canShape(player, recipe))) return false;
  inventory.deleteNumber(input, 1);
  if (firing && recipe.cracks !== false && Math.random() >= firingChance(Shared.craftingLevel(player))) {
    return true; // Cracked pottery is destroyed, with no product or XP.
  }
  inventory.addItem(new Item(firing ? recipe.firedId : recipe.unfiredId, firing ? 1 : recipe.shaped ?? 1));
  Shared.addCraftingXp(player, firing ? recipe.firingXp : recipe.shapingXp);
  Shared.produced(player, firing ? recipe.firedId : recipe.unfiredId, firing ? 1 : recipe.shaped ?? 1, firing ? recipe.firingXp : recipe.shapingXp, "pottery");
  const message = firing ? recipe.removeMessage : recipe.shapeMessage;
  if (message) spam(player, message);
  return true;
}

/** Shaping: result at 2,5,...; firing: put at 0,7,... and remove at 6,13,... (rsprox 1757/1858). */
function startPottery(player, station, recipe, amount, firing) {
  if (!firing && !canShape(player, recipe)) return;
  Shared.stopCrafting(player);
  const { Task, ItemIds } = Shared.getCore();
  const input = firing ? recipe.unfiredId : ItemIds.SOFT_CLAY;
  const origin = player.getLocation().clone();
  const interval = Shared.actionInterval(player, "pottery", firing ? 7 : 3);
  const delay = interval - 1;
  const has = () => player.getInventory().contains(input) && (firing || canShape(player, recipe));
  if (!has()) {
    if (firing) statement(player, `You don't have any ${recipe.plural} which need firing.`);
    return;
  }
  const animate = () => {
    Shared.animate(player, firing ? data().ovenAnimation : data().wheelAnimation,
      firing ? data().ovenSound : data().wheelSound);
    if (firing && recipe.putMessage) spam(player, recipe.putMessage);
  };
  class PotteryTask extends Task {
    constructor() {
      super(1, player);
      this.ticks = 0;
      this.remaining = amount;
    }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getMovementQueue().size() > 0 ||
          player.getForceMovement() != null || player.getInterfaceId() !== -1 || !player.getLocation().equals(origin) ||
          player.getLocation().getDistance(station.getLocation()) > 2 || !has()) {
        this.stop();
        return;
      }
      const tick = ++this.ticks;
      if (firing && tick % interval === 0) animate();
      if (tick % interval !== delay) return;
      // Content may make several pieces in the one cycle ("skills:actions-per-cycle").
      const actions = Shared.actionsPerCycle(player, "pottery");
      for (let done = 0; done < actions; done++) {
        if (!makePottery(player, recipe, firing) || --this.remaining <= 0 || !has()) {
          this.stop();
          return;
        }
      }
      if (!firing) animate();
    }
    stop() {
      super.stop();
      if (player.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE) === this) {
        player.setAttribute(Shared.CRAFTING_TASK_ATTRIBUTE, null);
      }
    }
  }
  animate();
  const task = new PotteryTask();
  player.setAttribute(Shared.CRAFTING_TASK_ATTRIBUTE, task);
  Shared.getApi().getTaskManager().submit(task);
}

function openPotteryMenu({ player, object }, firing) {
  Shared.stopCrafting(player);
  const inventory = player.getInventory();
  // Both menus leave pot lids out until One Small Favour teaches them (recording 1098).
  const recipes = Shared.available(data().pottery).filter(recipe => recipeUnlocked(player, recipe));
  const maxAmount = firing ? Math.max(...recipes.map(recipe => inventory.getAmount(recipe.unfiredId))) :
    inventory.getAmount(Shared.getCore().ItemIds.SOFT_CLAY);
  if (maxAmount === 0) {
    if (firing) player.sendMessage("You have no unfired pottery to fire.");
    else statement(player, "You don't have anything suitable to craft with.");
    return;
  }
  Shared.openMakeMenu(player, {
    title: firing ? "What would you like to fire in the oven?" : "How many do you wish to make?",
    mode: firing ? FIRE_MENU_MODE : SHAPE_MENU_MODE,
    items: recipes.map(recipe => ({ ...recipe, itemId: recipe.unfiredId,
      label: (!firing && recipe.shapeLabel) || recipe.name[0].toUpperCase() + recipe.name.slice(1) })),
    maxAmount,
    choose: (recipe, amount) => startPottery(player, object, recipe, amount, firing),
  });
}

function usePotterWheel(event) {
  event.handled = true;
  openPotteryMenu(event, false);
}

function usePotteryOven(event) {
  event.handled = true;
  openPotteryMenu(event, true);
}

/** Soft clay on a wheel, unfired pottery on a pottery oven. */
function handlePotteryItemOnObject(event) {
  const objectName = event.object?.getDefinition?.()?.getName?.();
  const { byUnfired } = data();
  if (POTTER_WHEEL_NAMES.has(objectName) && event.itemId === Shared.getCore().ItemIds.SOFT_CLAY) {
    usePotterWheel(event);
  } else if (POTTERY_OVEN_NAMES.has(objectName) && byUnfired.has(event.itemId)) {
    usePotteryOven(event);
  }
}

module.exports = function attach(api) {
  api.onItemOnItem(makeSoftClay, { noted: false });
  api.onItemOnObject(handlePotteryItemOnObject, { noted: false });
  api.onObjectInteraction("Potter's Wheel", { Use: usePotterWheel });
  api.onObjectInteraction("Potter's wheel", { Use: usePotterWheel });
  api.onObjectInteraction("Pottery Oven", { Fire: usePotteryOven });
};
