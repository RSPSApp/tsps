/**
 * Nettle tea's pours: a bowl of nettle tea (or milky nettle tea) into an empty cup or a porcelain
 * cup, and a bucket of milk into the tea in a bowl or either cup. Wiki (Nettle tea, Cup of tea
 * (nettle), Porcelain cup: "works like a normal teacup"). As the rsprox capture of Ghosts Ahoy
 * (20261112T092603, ticks 373-383) pours into the porcelain cup: a tick after the use, no line, no
 * XP, sound 2401, the brew in the cup's (or the tea's, for milk) slot and the emptied bowl or
 * bucket in the other's slot.
 * Nettle-water and its boiling are cooking.json rows (Recipes.Cooking.js, Cookers.Cooking.js).
 * See docs/cooking.md.
 */
const Common = require("./Common.Cooking");
const FreeToPlay = require("../../modes/FreeToPlay.plugin");

const LIQUID_SOUND = 2401;
const POUR_DELAY_TICKS = 1;

/** [poured, into, emptied, made]: `made` takes `into`'s slot, `emptied` takes `poured`'s. */
const POURS = [
  ["bowl_nettletea", "cup_empty", "bowl_empty", "cup_of_nettletea"],
  ["bowl_nettletea_milky", "cup_empty", "bowl_empty", "cup_of_nettletea_milky"],
  ["bowl_nettletea", "chinacup_empty", "bowl_empty", "chinacup_of_nettletea"],
  ["bowl_nettletea_milky", "chinacup_empty", "bowl_empty", "chinacup_of_nettletea_milky"],
  ["bucket_milk", "bowl_nettletea", "bucket_empty", "bowl_nettletea_milky"],
  ["bucket_milk", "cup_of_nettletea", "bucket_empty", "cup_of_nettletea_milky"],
  ["bucket_milk", "chinacup_of_nettletea", "bucket_empty", "chinacup_of_nettletea_milky"],
];

let pours = null;

function pourList() {
  pours ??= POURS.map((row) => row.map((name) => Common.gameval("obj", name)));
  return pours;
}

function pourFor(firstId, secondId) {
  return pourList().find(([poured, into]) => (firstId === poured && secondId === into) || (firstId === into && secondId === poured)) ?? null;
}

function slotOf(event, itemId) {
  if (event.usedItemId === itemId && event.usedItemSlot >= 0) return event.usedItemSlot;
  if (event.usedWithItemId === itemId && event.usedWithItemSlot >= 0) return event.usedWithItemSlot;
  return event.player.getInventory().getSlotForItemId(itemId);
}

function pour(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const found = pourFor(usedItemId, usedWithItemId);
  if (!found) return;
  event.handled = true;
  if (!Common.core.WorldDefinition.isMembersWorld()) {
    player.sendMessage(FreeToPlay.ITEM_MESSAGE);
    return;
  }
  const [poured, into] = found;
  const pouredSlot = slotOf(event, poured);
  const intoSlot = slotOf(event, into);
  const { TaskManager, CountdownTask } = Common.core;
  // A tick after the use, like the combine (Ghosts Ahoy capture: input 373, response 374; milk 382, 383).
  TaskManager.submit(new CountdownTask(player, POUR_DELAY_TICKS, () => pourNow(player, found, pouredSlot, intoSlot)));
}

/** The pour itself, if both items are still in their slots. */
function pourNow(player, [poured, into, emptied, made], pouredSlot, intoSlot) {
  if (!player.isRegistered?.()) return;
  const inventory = player.getInventory();
  const items = inventory.getItems();
  if (pouredSlot < 0 || intoSlot < 0 || items[pouredSlot]?.getId() !== poured || items[intoSlot]?.getId() !== into) return;
  const { Item, Sound, Sounds } = Common.core;
  inventory.setItem(intoSlot, new Item(made, 1, items[intoSlot].getMeta?.()));
  inventory.setItem(pouredSlot, new Item(emptied, 1, items[pouredSlot].getMeta?.()));
  inventory.refreshItems();
  Sounds.sendSound(player, new Sound(LIQUID_SOUND, 1, 0, 0));
}

module.exports = Object.assign(function attachNettleTea(api) {
  api.onItemOnItem(pour, { noted: false });
}, { _test: { pour } });
