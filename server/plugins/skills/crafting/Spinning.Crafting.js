/**
 * Spinning wheels and looms.
 *
 * rsprox captures (recording 3467, rev 235; 1105, Leagues, for a one-product menu; 69, 89, 1718
 * for older menus): the wheel's Spin option opens skillmulti mode 16, "What would you like to
 * spin?" ("How many would you like to spin?" with one product), with what the carried
 * materials make. On the choice tick human_spinningwheel_60, sound 2590 and the wheel's own
 * animation start, and from the second tick one item is spun every 2 ticks, all three replayed
 * with each. The loom's Weave option opens mode 35, "How many would you like to weave?";
 * farming_useloom and sound 2587 start on the choice tick and an item is woven every 3 ticks
 * from the third. Neither sends a message.
 *
 * Wiki (Crafting#Spinning, Crafting#Weaving): products, materials, levels and XP, in
 * data/crafting.json. Using a material on the wheel or loom opens the same menu.
 */
const Shared = require("./Shared.Crafting");

const SPIN_MENU_TITLE = "What would you like to spin?";
const SPIN_ONE_MENU_TITLE = "How many would you like to spin?";
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

function locationSnapshot(location) {
  if (!location || !["getX", "getY", "getZ"].every((method) => typeof location[method] === "function")) return null;
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

function stationSnapshot(station) {
  if (!station || typeof station.getId !== "function" || typeof station.getLocation !== "function") return null;
  const location = locationSnapshot(station.getLocation());
  const stationObjectId = station.getId();
  if (!Number.isInteger(stationObjectId) || !location) return null;
  return { stationObjectId, location };
}

function stationContext(player, station) {
  const stationData = stationSnapshot(station);
  const startLocation = locationSnapshot(player.getLocation?.());
  const teleportSerial = player.getTeleportSerial?.();
  if (!stationData || !startLocation || !Number.isInteger(teleportSerial)) return null;
  return { ...stationData, startLocation, teleportSerial, area: player.getArea?.() ?? null };
}

function remainsAtStation(player, context) {
  if (!context) return true;
  const location = locationSnapshot(player.getLocation?.());
  return location != null
    && player.getTeleportSerial?.() === context.teleportSerial
    && (player.getArea?.() ?? null) === context.area
    && location.x === context.startLocation.x
    && location.y === context.startLocation.y
    && location.z === context.startLocation.z;
}

function canGrantAfterConsumption(player, recipe, material) {
  const inventory = player.getInventory();
  if (typeof inventory.getCopiedItems !== "function" || typeof Shared.getCore().Inventory !== "function") return true;
  const preview = new (Shared.getCore().Inventory)(player).setItems(inventory.getCopiedItems());
  preview.deleted(material, recipe.amount, false);
  const output = new (Shared.getCore().Item)(recipe.itemId, 1);
  return preview.getAddableAmount(output) >= 1;
}

/**
 * Makes one item. A spun one is announced as "crafting:spun" { player, itemId, amount }, so a
 * carried bow string spool (Fletching) can take spun bow strings.
 */
function makeOne(player, recipe, spinning, provenance) {
  const material = carriedMaterial(player, recipe);
  if (material === undefined || !remainsAtStation(player, provenance) || !canGrantAfterConsumption(player, recipe, material)) return false;
  player.getInventory().deleteNumber(material, recipe.amount);
  player.getInventory().addItem(new (Shared.getCore().Item)(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  const action = {
    inputItemIds: [material],
    inputs: [{ itemId: material, amount: recipe.amount }],
    outputItemId: recipe.itemId,
    ...(provenance ? { stationObjectId: provenance.stationObjectId, location: provenance.location } : {}),
  };
  if (spinning) Shared.getApi().emitCustomEvent("crafting:spun", { player, itemId: recipe.itemId, amount: 1, ...action });
  Shared.getApi().emitCustomEvent("skills:produced", { player, skill: Shared.getCore().Skill.CRAFTING, itemId: recipe.itemId, amount: 1, xp: recipe.xp, kind: spinning ? "spinning" : "weaving", materials: null, ...action });
  return true;
}

function start(player, station, recipe, amount, spinning, provenance = stationContext(player, station)) {
  if (!remainsAtStation(player, provenance)) return;
  if (Shared.craftingLevel(player) < recipe.level) {
    // ponytail: not captured; the live text may differ.
    player.sendMessage(`You need a Crafting level of ${recipe.level} to make ${Shared.withArticle(Shared.itemName(recipe.itemId).toLowerCase())}.`);
    return;
  }
  const tables = data();
  Shared.startMaking(player, spinning ? {
    amount, startTick: 0, firstTick: 2, interval: 2, animation: tables.spinningAnimation, sound: tables.spinningSound, kind: "spinning",
    onAnimate: () => player.getPacketSender().sendObjectAnimation(station, tables.wheelAnimation),
    has: () => remainsAtStation(player, provenance) && carriedMaterial(player, recipe) !== undefined,
    make: () => makeOne(player, recipe, true, provenance),
  } : {
    amount, startTick: 0, firstTick: 3, interval: 3, animation: tables.weavingAnimation, sound: tables.weavingSound, kind: "weaving",
    has: () => remainsAtStation(player, provenance) && carriedMaterial(player, recipe) !== undefined,
    make: () => makeOne(player, recipe, false, provenance),
  });
}

function openMenu(player, station, spinning) {
  const provenance = stationContext(player, station);
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
    title: spinning ? (recipes.length === 1 ? SPIN_ONE_MENU_TITLE : SPIN_MENU_TITLE) : WEAVE_MENU_TITLE,
    mode: spinning ? SPIN_MENU_MODE : WEAVE_MENU_MODE,
    items: recipes,
    maxAmount: Math.max(...recipes.map((recipe) =>
      Math.floor(Math.max(...recipe.materials.map((id) => inventory.getAmount(id))) / recipe.amount))),
    choose: (recipe, amount) => start(player, station, recipe, amount, spinning, provenance),
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
