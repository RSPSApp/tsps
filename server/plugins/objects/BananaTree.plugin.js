/**
 * Wild banana trees (Musa Point, Ape Atoll): https://oldschool.runescape.wiki/w/Banana_tree
 *
 * "Pick" takes one banana and steps the tree down a stage: 2073 (full) -> 2074 -> 2075
 * -> 2076 -> 2077 -> 2078 (empty, "Search"). The tree reverts to the stage it was
 * spawned at 500 ticks (5 minutes) after the most recent pick.
 * Messages and timing follow Lost City's banana_tree.rs2 (oploc1,_banana_tree).
 */
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const FULL_TREE_ID = 2073;
const EMPTY_TREE_ID = 2078;
const REGROW_TICKS = 500;

let ObjectManager;
let TaskManager;

// tile key -> { original: GameObject, generation: number }
const PICKED_TREES = new Map();

function tileKey(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

function replaceTree(current, newId) {
  const replacement = new GameObject(
    newId,
    current.getLocation().clone(),
    current.getType(),
    current.getFace(),
    current.getPrivateArea()
  );
  ObjectManager.deregister(current, true);
  ObjectManager.register(replacement, true);
  return replacement;
}

class BananaTreeRegrowTask extends Task {
  constructor(key, generation, stage) {
    super(REGROW_TICKS);
    this.key = key;
    this.generation = generation;
    this.stage = stage;
  }

  execute() {
    this.stop();
    const state = PICKED_TREES.get(this.key);
    // A later pick restarted the timer.
    if (!state || state.generation !== this.generation) return;
    PICKED_TREES.delete(this.key);
    const current = MapObjects.get(this.stage.getId(), this.stage.getLocation(), this.stage.getPrivateArea());
    if (current) ObjectManager.deregister(current, true);
    ObjectManager.register(state.original, true);
  }
}

function pickBanana(event) {
  const { player, object } = event;
  const id = object?.getId?.();
  if (!(id >= FULL_TREE_ID && id < EMPTY_TREE_ID)) return false;
  event.handled = true;

  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough room in your inventory.");
    return true;
  }

  const key = tileKey(object.getLocation());
  const state = PICKED_TREES.get(key) ?? { original: object, generation: 0 };
  state.generation++;
  PICKED_TREES.set(key, state);

  const stage = replaceTree(object, id + 1);
  TaskManager.submit(new BananaTreeRegrowTask(key, state.generation, stage));

  player.getInventory().adds(ItemIdentifiers.BANANA, 1);
  player.sendMessage("You pick a banana.");
  return true;
}

function searchEmptyTree(event) {
  if (event.object?.getId?.() !== EMPTY_TREE_ID) return false;
  event.handled = true;
  event.player.sendMessage("There are no bananas left on the tree.");
  return true;
}

module.exports = {
  name: "BananaTree",
  register(api) {
    ObjectManager = api.getObjectManager();
    TaskManager = api.getTaskManager();
    api.onObjectInteraction("Banana tree", { Pick: pickBanana, Search: searchEmptyTree });
  },
};
