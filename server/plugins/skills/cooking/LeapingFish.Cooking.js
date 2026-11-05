/**
 * Cutting leaping fish with a knife, the only source of roe and caviar (Wiki, quoting Mod Ash:
 * Leaping trout, Leaping salmon, Leaping sturgeon, Roe, Caviar and Fish offcuts):
 * - every cut uses up one fish. A successful cut gives roe (caviar for sturgeon), static Cooking
 *   XP and, on a further roll, fish offcuts; a failed cut gives nothing;
 * - trout: roe 1/150 at Cooking 1, rising linearly to 99/150 at 99, offcuts 1/2, 10 XP;
 *   salmon: roe 1/80 at Cooking 1, rising linearly to certain at 80, offcuts 3/4, 10 XP;
 *   sturgeon: caviar at the salmon's rates, offcuts 5/6, 15 XP;
 * - the first cut happens on the knife use and the rest follow automatically every 3 ticks
 *   (changelog 16 November 2022). Using the knife again cuts at once, so re-using it is faster,
 *   but only one fish is cut per tick.
 * The rsprox recordings have leaping fish caught and dropped, never cut, and the Wiki gives no
 * message or animation, so a cut plays and says nothing. Offcuts with no room fall to the floor
 * (unconfirmed).
 */
const Common = require("./Common.Cooking");

/** The game tick of the player's last cut, so repeated knife uses cut one fish per tick. */
const LAST_CUT_TICK_ATTRIBUTE = "cooking:leaping-fish-cut-tick";
/** Ticks between automatic cuts (Wiki footnote on Roe and Fish offcuts). */
const AUTO_CUT_TICKS = 3;

/** By leaping fish gameval: what a successful cut gives, the roe chance's denominator and cap, offcut odds and XP. */
const FISH = {
  brut_spawning_trout: { product: "brut_roe", per: 150, offcuts: [1, 2], xp: 10 },
  brut_spawning_salmon: { product: "brut_roe", per: 80, offcuts: [3, 4], xp: 10 },
  brut_sturgeon: { product: "brut_caviar", per: 80, offcuts: [5, 6], xp: 15 },
};

let fishById = null;

function fishTable() {
  if (fishById) return fishById;
  fishById = new Map(Object.entries(FISH).map(([fish, row]) => [Common.gameval("obj", fish), {
    ...row, fishId: Common.gameval("obj", fish), productId: Common.gameval("obj", row.product),
  }]));
  return fishById;
}

/** The leaping fish this knife use is on, or null. */
function fishFor(event) {
  const { usedItemId, usedWithItemId } = event;
  const knives = Common.knives();
  const fish = fishTable();
  if (knives.has(usedItemId) && fish.has(usedWithItemId)) return fish.get(usedWithItemId);
  if (knives.has(usedWithItemId) && fish.has(usedItemId)) return fish.get(usedItemId);
  return null;
}

/** The chance a cut gives roe or caviar at this Cooking level: level/150 for trout, level/80 (capped) otherwise. */
function roeChance(fish, level) {
  return Math.min(1, Math.max(1, level) / fish.per);
}

/** Whether a knife is still carried: dropping it does not stop the automatic cutting. */
function hasKnife(inventory) {
  return [...Common.knives()].some((id) => inventory.contains(id));
}

/** Cuts one fish: the fish goes, and on a success the roe or caviar, any offcuts and the XP come. */
function cutOne(player, fish, random = Math.random) {
  const { Item, Skill, World } = Common.core;
  const inventory = player.getInventory();
  if (!inventory.contains(fish.fishId) || !hasKnife(inventory)) return false;
  player.setAttribute(LAST_CUT_TICK_ATTRIBUTE, World.getProcessCycle());
  inventory.deleteNumber(fish.fishId, 1);
  if (random() >= roeChance(fish, Common.level(player))) return true;
  inventory.addItem(new Item(fish.productId, 1));
  const [numerator, denominator] = fish.offcuts;
  if (random() < numerator / denominator) {
    inventory.forceAdd(player, new Item(Common.gameval("obj", "brut_fish_cuts"), 1));
  }
  Common.addXp(player, fish.xp);
  Common.api.emitCustomEvent("skills:produced", {
    player, skill: Skill.COOKING, itemId: fish.productId, amount: 1, xp: fish.xp, kind: "leaping-fish",
  });
  return true;
}

/** Cuts the same kind of fish every 3 ticks until none are left, a walk or a click stops it. */
function autoCut(player, fish) {
  let wait = AUTO_CUT_TICKS;
  Common.run(player, () => {
    if (--wait > 0) return true;
    wait = AUTO_CUT_TICKS;
    return cutOne(player, fish) && player.getInventory().contains(fish.fishId);
  });
}

function cut(event) {
  const fish = fishFor(event);
  if (!fish || !Common.core.WorldDefinition.isMembersWorld()) return;
  event.handled = true;
  const { player } = event;
  if (player.getAttribute(LAST_CUT_TICK_ATTRIBUTE) === Common.core.World.getProcessCycle()) return;
  Common.core.TaskManager.cancelTasks(player.getIndex());
  if (cutOne(player, fish) && player.getInventory().contains(fish.fishId)) autoCut(player, fish);
}

module.exports = Object.assign(function attachLeapingFish(api) {
  api.onItemOnItem(cut, { noted: false });
}, { _test: { roeChance, cutOne, fishTable } });
