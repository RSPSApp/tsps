/**
 * Eternal Sustenance (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic
 * Pacts' tier 6 relic: food is no longer used up when eaten. Food asks `onCanEat` before a bite
 * and says `food:eaten` after it; the inventory as it stood at the ask tells which slot the bite
 * came from, and that slot gets the food back whole (a cake's next slice, or a pie's dish, is
 * undone with it, as is a cocktail glass left in another, earlier free slot).
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

function eaten({ player, itemId, meta }) {
  const snapshot = before.get(player);
  before.delete(player);
  if (!snapshot || !active(player)) return;
  const now = ids(player);
  const slot = snapshot.findIndex((id, index) => id === itemId && now[index] !== itemId);
  if (slot < 0) return;
  const inventory = player.getInventory();
  // The food comes back as it was: a preset copy (PvP presets) keeps its untradeable/unbankable/preset meta.
  inventory.setItem(slot, new core.Item(itemId, 1, meta ? JSON.parse(JSON.stringify(meta)) : undefined));
  // A leftover that went to another slot (a cocktail's glass takes the first free slot, docs/food.md)
  // is undone too: every slot the bite filled is empty again.
  now.forEach((id, index) => {
    if (index !== slot && snapshot[index] < 0 && id >= 0) inventory.setItem(index, new core.Item(-1, 0));
  });
  inventory.refreshItems();
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.eternalSustenance;
  api.onCanEat(remember);
  api.onCustomEvent("food:eaten", eaten);
};
