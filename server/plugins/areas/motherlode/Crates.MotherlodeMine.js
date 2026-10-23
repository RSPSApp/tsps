/**
 * Motherlode Mine: the six crates round the machine, three with a hammer and three with a bronze
 * pickaxe (Wiki: Crate (old), Transcript:Crate (old); rsprox capture, docs/motherlode-mine.md).
 *
 * Searching one without its item puts the item in the inventory, on arrival, with an item box:
 * "You've found a hammer. How handy.". With one already carried, it's the game message every
 * other old crate gives: "You search the crate but find nothing.".
 */

/** By tile: the item each crate holds. (3756, 5668) and (3758, 5671) follow the Wiki's map pins. */
const CRATES = new Map([
  ["3752,5674", "hammer"],
  ["3756,5668", "hammer"],
  ["3752,5664", "hammer"],
  ["3758,5671", "bronzePickaxe"],
  ["3755,5665", "bronzePickaxe"],
  ["3753,5659", "bronzePickaxe"],
]);
const FOUND = { hammer: "You've found a hammer. How handy.", bronzePickaxe: "You've found a bronze pickaxe. How handy." };
const NOTHING = "You search the crate but find nothing.";
/** Ours (not captured). */
const NO_SPACE = "You don't have enough inventory space.";

let core = null;

function init(api) {
  core = api.core;
}

function itemId(item) {
  const I = core.ItemIdentifiers;
  return item === "hammer" ? I.HAMMER : I.BRONZE_PICKAXE;
}

function search({ player, location }) {
  const item = CRATES.get(`${location.x},${location.y}`);
  if (!item || location.z !== 0) return false;
  const id = itemId(item);
  const inventory = player.getInventory();
  if (inventory.contains(id)) {
    player.sendMessage(NOTHING);
    return true;
  }
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  inventory.add(new core.Item(id, 1), true);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, id, FOUND[item])));
  return true;
}

module.exports = { CRATES, init, search };
