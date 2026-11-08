"use strict";

const { CountdownTask, ItemIdentifiers, Skill, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Tea (rsprox captures, Wiki): a full kettle (filled at a sink, WaterSources) on a stove says
// "You place the kettle over the fire." and shows the stove's kettle loc; "The kettle boils." with
// synth 935 eight ticks later, and Take-kettle gives a hot kettle ("The kettle has not boiled yet."
// before then). Tea leaves in a teapot: "You add the leaves to the teapot."; the hot kettle on it:
// "You pour the water into the teapot." (a pot of tea (4); "You should add tea leaves to the teapot
// first." without them); the pot into a cup: "You pour some tea."; milk makes it milky. Drinking is
// the Potions plugin's (the Construction boost and the captured drinking messages); cups of tea
// vanish when their drinker leaves the house (Wiki).
const KETTLE = Ids.obj("poh_kettle_empty");
const HOT_KETTLE = Ids.obj("poh_kettle_boiled");
const FULL_KETTLE = Ids.obj("poh_kettle_water");
const TEA_LEAVES = Ids.obj("poh_tea_leaves");
const MILK = ItemIdentifiers.BUCKET_OF_MILK;
const EMPTY_BUCKET = ItemIdentifiers.BUCKET;
const TEA_COOKING_LEVEL = 20;
const BOIL_SOUND = 935;
const BOIL_TICKS = 8;
// Stove furniture -> its loc with a kettle on (poh_stove_<n>_kettle); the plain firepit has none.
const KETTLE_LOCS = Object.fromEntries(Object.entries({
  FIREPIT_WITH_HOOK: 2, FIREPIT_WITH_POT: 3, SMALL_OVEN: 4, LARGE_OVEN: 5, STEEL_RANGE: 6, FANCY_RANGE: 7,
}).map(([key, stove]) => [key, Ids.loc(`poh_stove_${stove}_kettle`)]));
// poh_teapot_<material>_{empty,leaves,4..1} and poh_<material>cup_{empty,tea,tea_milky}.
const SETS = [
  ["clay", "clay"], ["porcelain", "china"], ["giltporcelain", "giltchina"],
].map(([pot, cup]) => ({
  empty: Ids.obj(`poh_teapot_${pot}_empty`), leaves: Ids.obj(`poh_teapot_${pot}_leaves`),
  pots: [1, 2, 3, 4].map((portions) => Ids.obj(`poh_teapot_${pot}_${portions}`)),
  cup: Ids.obj(`poh_${cup}cup_empty`), tea: Ids.obj(`poh_${cup}cup_tea`), milky: Ids.obj(`poh_${cup}cup_tea_milky`),
}));
const TEA_CUPS = SETS.flatMap(set => [set.tea, set.milky]);

/** furniture -> { boiled } for kettles on stoves */
const kettles = new WeakMap();

function stoveAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture && furniture.hotspotKey === "STOVE" ? { house, furniture } : null;
}

function kettleOnStove(event) {
  if (event.itemId !== FULL_KETTLE) return false;
  const found = stoveAt(event);
  if (!found) return false;
  const { house, furniture } = found;
  const loc = KETTLE_LOCS[furniture.buildableKey];
  if (!loc || kettles.has(furniture)) return false;
  const player = event.player;
  player.getInventory().delete(FULL_KETTLE, 1);
  player.sendMessage("You place the kettle over the fire.");
  const kettle = { boiled: false };
  kettles.set(furniture, kettle);
  furniture.displayObjectId = loc;
  house.redrawFurniture();
  TaskManager.submit(new CountdownTask(house, BOIL_TICKS, () => {
    if (kettles.get(furniture) !== kettle) return;
    kettle.boiled = true;
    for (const occupant of house.getPlayers()) {
      if (!occupant.getLocation().isWithinDistance(player.getLocation(), 16)) continue;
      occupant.getPacketSender().sendSound(BOIL_SOUND, 0, 0);
      occupant.sendMessage("The kettle boils.");
    }
  }));
  return true;
}

function takeKettle(event) {
  const found = stoveAt(event);
  const kettle = found && kettles.get(found.furniture);
  if (!kettle) return false;
  const player = event.player;
  if (!kettle.boiled) return player.sendMessage("The kettle has not boiled yet."), true;
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space."), true;
  kettles.delete(found.furniture);
  delete found.furniture.displayObjectId;
  found.house.redrawFurniture();
  player.getInventory().adds(HOT_KETTLE, 1);
  return true;
}

function swap(player, from, to) {
  player.getInventory().delete(from, 1);
  player.getInventory().adds(to, 1);
}

function canPrepareTea(player) {
  if (player.getSkillManager().getCurrentLevel(Skill.COOKING) >= TEA_COOKING_LEVEL) return true;
  player.sendMessage(`You need a Cooking level of ${TEA_COOKING_LEVEL} to make tea.`);
  return false;
}

/** Item on item: leaves into a teapot, hot water onto the leaves, tea into a cup, milk into tea. */
function brew(event) {
  const player = event.player;
  const ids = [event.usedItemId, event.usedWithItemId];
  const has = (id) => ids.includes(id);
  const other = (id) => (ids[0] === id ? ids[1] : ids[0]);
  let done = false;
  for (const set of SETS) {
    if (has(TEA_LEAVES) && has(set.empty)) {
      if (!canPrepareTea(player)) { event.handled = true; return; }
      player.getInventory().delete(TEA_LEAVES, 1);
      swap(player, set.empty, set.leaves);
      player.sendMessage("You add the leaves to the teapot.");
      done = true;
    } else if (has(HOT_KETTLE) && has(set.leaves)) {
      if (!canPrepareTea(player)) { event.handled = true; return; }
      swap(player, HOT_KETTLE, KETTLE);
      swap(player, set.leaves, set.pots[3]);
      player.sendMessage("You pour the water into the teapot.");
      done = true;
    } else if (has(HOT_KETTLE) && has(set.empty)) {
      player.sendMessage("You should add tea leaves to the teapot first.");
      done = true;
    } else if (has(MILK) && has(set.tea)) {
      swap(player, MILK, EMPTY_BUCKET);
      swap(player, set.tea, set.milky);
      done = true;
    }
    if (done) break;
    const pot = set.pots.find(has);
    const cups = pot !== undefined && SETS.find(cupSet => cupSet.cup === other(pot));
    if (cups) {
      const left = set.pots.indexOf(pot);
      swap(player, pot, left === 0 ? set.empty : set.pots[left - 1]);
      swap(player, cups.cup, cups.tea);
      player.sendMessage("You pour some tea.");
      done = true;
      break;
    }
  }
  if (done) event.handled = true;
}

/** House.leftHouse: cups of tea don't leave the house. */
function leftWithTea(player) {
  for (const cup of TEA_CUPS) {
    const amount = player.getInventory().getAmount(cup);
    if (amount) player.getInventory().delete(cup, amount);
  }
}

function attachTea(api) {
  api.onItemOnObject((event) => { if (kettleOnStove(event)) event.handled = true; }, { noted: false });
  for (const name of ["Firepit with hook", "Firepit with pot", "Small oven", "Large oven", "Steel range", "Fancy range"]) {
    api.onObjectInteraction(name, { "Take-kettle": takeKettle });
  }
  api.onItemOnItem(brew);
}

Object.assign(module.exports, { attachTea, leftWithTea });
