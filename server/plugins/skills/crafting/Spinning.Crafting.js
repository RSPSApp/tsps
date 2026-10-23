/**
 * Spinning wheels and looms.
 *
 * rsprox captures (recording 3467, rev 235; 69, 89, 1718 for older menus): the wheel's Spin
 * option opens skillmulti mode 16, "What would you like to spin?", with what the carried
 * materials make. On the tick after the choice human_spinningwheel_60, sound 2590 and the
 * wheel's own animation start, and from the third tick one item is spun every 2 ticks, all
 * three replayed with each. The loom's Weave option opens mode 35, "How many would you like to
 * weave?"; farming_useloom and sound 2587 start the tick after the choice and an item is woven
 * every 3 ticks from the fourth. Neither sends a message.
 *
 * Wiki (Crafting#Spinning, Crafting#Weaving): products, materials, levels and XP, in
 * data/crafting.json. Using a material on the wheel or loom opens the same menu.
 */
const Shared = require("./Shared.Crafting");

const SPIN_MENU_TITLE = "What would you like to spin?";
const SPIN_MENU_MODE = 16;
const WEAVE_MENU_TITLE = "How many would you like to weave?";
const WEAVE_MENU_MODE = 35;

// Cache names: most wheels are "Spinning wheel", a few "Spinning Wheel".
const SPINNING_WHEELS = new Set(["Spinning wheel", "Spinning Wheel"]);
const LOOM = "Loom";

let tables = null;

/** The spinning and weaving recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation, Sound } = Shared.getCore();
  const { spinning, weaving } = Shared.DATA;
  const recipe = (entry) => ({ ...entry, itemId: Shared.itemId(entry.item), materials: entry.materials.map(Shared.itemId) });
  return tables = {
    spinning: spinning.recipes.map(recipe),
    weaving: weaving.recipes.map(recipe),
    spinningAnimation: new Animation(spinning.seq),
    wheelAnimation: new Animation(spinning.wheelSeq),
    spinningSound: new Sound(spinning.sound, 1, 0, 0),
    weavingAnimation: new Animation(weaving.seq),
    weavingSound: new Sound(weaving.sound, 1, weaving.soundDelay, 0),
  };
}

/** The first of the recipe's materials carried in the amount one item needs, or undefined. */
function carriedMaterial(player, recipe) {
  return recipe.materials.find((id) => player.getInventory().getAmount(id) >= recipe.amount);
}

/**
 * Makes one item. A spun one is announced as "crafting:spun" { player, itemId, amount }, so a
 * carried bow string spool (Fletching) can take spun bow strings.
 */
function makeOne(player, recipe, spinning) {
  const material = carriedMaterial(player, recipe);
  if (material === undefined) return false;
  player.getInventory().deleteNumber(material, recipe.amount);
  player.getInventory().addItem(new (Shared.getCore().Item)(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  if (spinning) Shared.getApi().emitCustomEvent("crafting:spun", { player, itemId: recipe.itemId, amount: 1 });
  return true;
}

function start(player, station, recipe, amount, spinning) {
  if (Shared.craftingLevel(player) < recipe.level) {
    // ponytail: not captured; the live text may differ.
    player.sendMessage(`You need a Crafting level of ${recipe.level} to make ${Shared.withArticle(Shared.itemName(recipe.itemId).toLowerCase())}.`);
    return;
  }
  const tables = data();
  Shared.startMaking(player, spinning ? {
    amount, startTick: 1, firstTick: 3, interval: 2, animation: tables.spinningAnimation, sound: tables.spinningSound,
    onAnimate: () => player.getPacketSender().sendObjectAnimation(station, tables.wheelAnimation),
    has: () => carriedMaterial(player, recipe) !== undefined,
    make: () => makeOne(player, recipe, true),
  } : {
    amount, startTick: 1, firstTick: 4, interval: 3, animation: tables.weavingAnimation, sound: tables.weavingSound,
    has: () => carriedMaterial(player, recipe) !== undefined,
    make: () => makeOne(player, recipe, false),
  });
}

function openMenu(player, station, spinning) {
  const recipes = Shared.available(spinning ? data().spinning : data().weaving)
    .filter((recipe) => carriedMaterial(player, recipe) !== undefined);
  if (recipes.length === 0) {
    // ponytail: not captured; the live text may differ.
    player.sendMessage(spinning ? "You have nothing to spin." : "You have nothing to weave.");
    return;
  }
  const inventory = player.getInventory();
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: spinning ? SPIN_MENU_TITLE : WEAVE_MENU_TITLE,
    mode: spinning ? SPIN_MENU_MODE : WEAVE_MENU_MODE,
    items: recipes,
    maxAmount: Math.max(...recipes.map((recipe) =>
      Math.floor(Math.max(...recipe.materials.map((id) => inventory.getAmount(id))) / recipe.amount))),
    choose: (recipe, amount) => start(player, station, recipe, amount, spinning),
  });
}

function spin(event) {
  event.handled = true;
  openMenu(event.player, event.object, true);
}

function weave(event) {
  event.handled = true;
  openMenu(event.player, event.object, false);
}

/** A material used on a wheel or loom opens the same menu, when the station takes it. */
function handleMaterialOnStation(event) {
  const name = event.object?.getDefinition?.()?.getName?.();
  const spinning = SPINNING_WHEELS.has(name);
  if (!spinning && name !== LOOM) return;
  const recipes = Shared.available(spinning ? data().spinning : data().weaving);
  if (!recipes.some((recipe) => recipe.materials.includes(event.itemId))) return;
  event.handled = true;
  openMenu(event.player, event.object, spinning);
}

module.exports = function attach(api) {
  api.onObjectInteraction("Spinning wheel", { Spin: spin });
  api.onObjectInteraction("Spinning Wheel", { Spin: spin });
  api.onObjectInteraction(LOOM, { Weave: weave });
  api.onItemOnObject(handleMaterialOnStation, { noted: false });
};
