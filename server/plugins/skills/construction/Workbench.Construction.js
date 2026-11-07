"use strict";

const { api, Animation, Item, Skill } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const Data = require("./Data.Construction");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");
const WORKBENCH = require("./data/workbench.json");

// rsprox captures: Work-at opens poh_furniture_creation_menu, laid out by its own script from the
// category enum; a category opens the furniture list (the build menu's interface, with flatpack
// mode on in script 1406) and a pick makes that furniture's flatpack.
const CATEGORY_INTERFACE = Ids.iface("poh_furniture_creation_menu");
const CATEGORY_LIST = (CATEGORY_INTERFACE << 16) | 2;
const CATEGORY_SCROLLBAR = (CATEGORY_INTERFACE << 16) | 3;
const CATEGORY_INIT_SCRIPT = 348;
const CATEGORY_ROWS = 48;
const FURNITURE_INTERFACE = Ids.iface("poh_furniture_creation");
const FURNITURE_LIST = (FURNITURE_INTERFACE << 16) | 2;
const ENTRY_SCRIPT = 1404;
const LIST_SCRIPT = 1406;
const OP1_EVENTS = 1 << 1;
const PAUSE_BUTTON_EVENTS = 1;
const BUILD_ANIMATION = Ids.seq("human_poh_build");

const FLATPACK_OF = new Map(WORKBENCH.categories.flatMap(category => category.flatpacks));
const FURNITURE_OF_FLATPACK = new Map(WORKBENCH.categories.flatMap(category => category.flatpacks.map(([key, item]) => [item, key])));
const benches = new WeakMap();

function workAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const limit = furniture && WORKBENCH.benches[furniture.buildableKey];
  if (!limit) return false;
  const sender = event.player.getPacketSender();
  sender.sendInterface(CATEGORY_INTERFACE);
  sender.sendClientScript(CATEGORY_INIT_SCRIPT, CATEGORY_LIST, CATEGORY_SCROLLBAR);
  sender.sendInterfaceFlagsRange(CATEGORY_LIST, 0, CATEGORY_ROWS, OP1_EVENTS);
  benches.set(event.player, { limit, house, choices: null });
  return true;
}

function openCategory(player, bench, index) {
  const category = WORKBENCH.categories[index];
  if (!category) return;
  bench.choices = category.flatpacks.map(([key]) => Data.BUILDABLE_BY_KEY.get(key)).filter(Boolean);
  const sender = player.getPacketSender();
  sender.sendInterface(FURNITURE_INTERFACE);
  benches.set(player, bench); // replacing the category menu closed it
  bench.choices.forEach((buildable, slot) => sender.sendClientScript(ENTRY_SCRIPT, slot + 1, buildable.menuRowId, buildable.level,
    House.furnitureCreationText(buildable), House.getBuildMaterials(player, bench.house, null, buildable) instanceof Map ? 1 : 0));
  sender.sendClientScript(LIST_SCRIPT, bench.choices.length, 1)
    .sendInterfaceFlagsRange(FURNITURE_LIST, 1, bench.choices.length, PAUSE_BUTTON_EVENTS);
}

function makeFlatpack(player, bench, buildable) {
  if (House.houseFor(player) !== bench.house) return;
  if (buildable.level > bench.limit) return player.sendMessage(`This workbench can only make furniture up to level ${bench.limit}.`);
  const materials = House.getBuildMaterials(player, bench.house, null, buildable);
  if (!(materials instanceof Map)) return Menu.refuse(player, materials);
  House.useMaterials(player, buildable, materials);
  player.performAnimation(new Animation(BUILD_ANIMATION));
  // Kept materials (a league fragment's planks) may leave no slot free: the flatpack then falls to the floor.
  player.getInventory().forceAdd(player, new Item(FLATPACK_OF.get(buildable.key), 1));
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, buildable.experience);
}

function interfaceClick(event) {
  const bench = benches.get(event.player);
  if (!bench) return;
  if (event.groupId === CATEGORY_INTERFACE && event.childId === 2) {
    event.handled = true;
    openCategory(event.player, bench, Math.floor((event.slot ?? event.action ?? 0) / 3));
  } else if (event.groupId === FURNITURE_INTERFACE && event.childId === 2 && bench.choices) {
    const buildable = bench.choices[(event.action ?? 0) - 1];
    if (!buildable) return;
    event.handled = true;
    benches.delete(event.player);
    event.player.getPacketSender().sendInterfaceRemoval();
    makeFlatpack(event.player, bench, buildable);
  }
}

/**
 * A flatpack used on a hotspot that takes it installs the furniture, in building mode. rsprox
 * captures (recording 2605, rev 229): it needs a hammer, plays the build animation with the hammer
 * sound, gives no XP and says nothing; a space that doesn't take it says "You can't place that there."
 */
function installFlatpack(event) {
  const key = FURNITURE_OF_FLATPACK.get(event.itemId);
  const house = key && House.houseFor(event.player);
  if (!house) return;
  const player = event.player;
  event.handled = true;
  if (!House.isBuildingMode(player)) return player.sendMessage("You must be in building mode to try installing furniture.");
  const target = house.getFurnitureTarget(event.location, event.objectId);
  const buildable = Data.BUILDABLE_BY_KEY.get(key);
  if (!target || !House.hotspotChoices(target.hotspotKey).includes(buildable)) return player.sendMessage("You can't place that there.");
  if (house.getFurnitureAtTarget(target)) {
    return player.sendMessage("This furniture cannot be upgraded. Remove the previous furniture if you wish to install a flatpack here.");
  }
  if (House.constructionLevel(player) < buildable.level) return player.sendMessage(`You need Construction level ${buildable.level} to build that.`);
  if (!House.hasHammer(player)) return player.sendMessage("You need a hammer in order to install flatpack furniture.");
  player.getInventory().delete(event.itemId, 1);
  House.hammer(player);
  house.setFurniture(target, buildable);
  House.rebuildHouse(player, house);
}

function closeBench({ player }) {
  benches.delete(player);
}

function attachWorkbench(api) {
  api.onObjectInteraction("Workbench", { "Work-at": workAt });
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("interface:close", closeBench);
  api.onItemOnObject(installFlatpack, { noted: false });
}

Object.assign(module.exports, { attachWorkbench, _test: { makeFlatpack, FLATPACK_OF } });
