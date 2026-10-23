/**
 * "Clean" on a grimy herb (rsprox captures, normal worlds): the herb is swapped for its clean
 * one in the same slot, with one of four cleaning sounds and the spam-filtered message naming the
 * grimy herb. There is no delay: several clicks in one tick each clean a herb.
 */
const Common = require("./Common.Herblore");

/** The four herb cleaning sounds; live plays one at random each time. */
const CLEAN_SOUNDS = [3920, 3921, 3922, 3923];

function clean(event) {
  const { player, itemId, slot } = event;
  const herb = Common.herbFor(itemId);
  if (!herb) return false;
  if (!Common.canUseHerblore(player)) return true;
  const name = Common.core.ItemDefinition.forId(itemId).getName();
  if (Common.level(player) < herb.level) {
    player.sendMessage(`You need level ${herb.level} Herblore to clean the ${name}.`);
    return true;
  }
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId) return true;
  inventory.setItem(slot, new Common.core.Item(herb.cleanId, 1)).refreshItems();
  Common.sound(player, CLEAN_SOUNDS[Math.floor(Math.random() * CLEAN_SOUNDS.length)]);
  Common.spam(player, `You clean the ${name}.`);
  Common.addXp(player, herb.xp);
  return true;
}

module.exports = function attachCleaning(api) {
  api.onItemFirstAction(clean);
};
