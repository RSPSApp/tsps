/**
 * Eternal Sustenance (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic
 * Pacts' tier 6 relic: food is no longer used up when eaten. Food asks `onCanEat` before a bite
 * and says `food:eaten` after it; the inventory as it stood at the ask tells which slot the bite
 * came from, and that slot gets the food back whole (a cake's next slice, or a pie's dish, is
 * undone with it).
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;

/** The inventory's item ids when the player last asked to eat, per player. */
const before = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function ids(player) {
  return player.getInventory().getItems().map((item) => item?.getId?.() ?? -1);
}

/** `onCanEat`: remembers the inventory; never refuses. */
function remember({ player }) {
  if (active(player)) before.set(player, ids(player));
}

function eaten({ player, itemId }) {
  const snapshot = before.get(player);
  before.delete(player);
  if (!snapshot || !active(player)) return;
  const now = ids(player);
  const slot = snapshot.findIndex((id, index) => id === itemId && now[index] !== itemId);
  if (slot < 0) return;
  const inventory = player.getInventory();
  inventory.setItem(slot, new core.Item(itemId, 1));
  inventory.refreshItems();
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.eternalSustenance;
  api.onCanEat(remember);
  api.onCustomEvent("food:eaten", eaten);
};
