"use strict";

/**
 * Items that are never kept on death (https://oldschool.runescape.wiki/w/Items_Kept_on_Death#Items_that_are_never_kept):
 * the clue box, the Chronicle, League trophies, the degraded amulet of the damned and the items with no ground state
 * (the Flamtaer bag, Lunar equipment with its staff, the Ring of Charos, Steel gauntlets and their enchanted forms, the
 * magic butterfly net). The Wiki gives no PvP qualifier for them: an unsafe death, PvP or PvM, destroys them even if
 * they are the most valuable items or Protect Item is on. They take no kept slot, are not dropped for a killer, go to
 * no grave and are not given back. Items with a death rule of their own (the rune pouch, bolt pouch, looting bag,
 * jar generator, salamanders) handle it in their own plugins.
 */
const DATA = require("./data/never-kept-on-death.json");

const NAMES = new Set([
  ...DATA.items,
  ...DATA.leagueTrophies.leagues.flatMap((league) => DATA.leagueTrophies.tiers.map((tier) => `${league} ${tier} trophy`)),
].map((name) => name.toLowerCase()));

function isNeverKept(item) {
  const definition = item?.getDefinition?.();
  if (!definition) return false;
  return NAMES.has(String(definition.getName() ?? "").toLowerCase());
}

/** Never one of the kept items, however valuable. */
function neverKept(event) {
  if (isNeverKept(event.item)) event.keep = false;
}

/** Destroyed on any unsafe death: not dropped, not to the grave, not given back. */
function lostOnDeath(event) {
  if (event.kept || event.shouldDropItems === false) return;
  if (isNeverKept(event.item)) event.handled = true;
}

module.exports = {
  name: "NeverKeptOnDeath",
  description: "Destroys the items that are never kept on death (the clue box, League trophies, the Chronicle, items with no ground state) on an unsafe death, instead of keeping, dropping or graving them.",
  members: true,
  _test: { isNeverKept, NAMES },
  register(api) {
    api.onShouldKeepItemOnDeath(neverKept);
    api.onPlayerDeathItemDrop(lostOnDeath);
  },
};
