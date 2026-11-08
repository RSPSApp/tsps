let core = null;

/**
 * Wiki (Spirit flakes, Fishing enhancers): carried spirit flakes give a 50% chance to catch an extra
 * fish, for no additional experience, and the effect stacks with Rada's blessing. "Players will
 * always lose a flake per fish caught, regardless of whether they get a single or double catch."
 */
const EXTRA_FISH_CHANCE = 0.5;

function attach(api) {
  core = api.core;
}

/**
 * Uses up one carried flake for a landed fish; true when there was one. Flakes in a tackle box are
 * not used: the Wiki does not say they are.
 */
function consumeFlake(player) {
  const flakes = core.ItemIdentifiers.SPIRIT_FLAKES;
  const inventory = player.getInventory();
  if (!inventory.contains(flakes)) return false;
  inventory.deleteNumber(flakes, 1);
  return true;
}

module.exports = { attach, consumeFlake, EXTRA_FISH_CHANCE };
