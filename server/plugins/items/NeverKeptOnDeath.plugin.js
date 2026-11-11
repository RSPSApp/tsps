"use strict";

/**
 * Untradeables that are never kept on death (https://oldschool.runescape.wiki/w/Items_Kept_on_Death#Items_that_are_never_kept):
 * the Chronicle, League trophies and the items with no ground state (the Flamtaer bag, Lunar
 * equipment, the Ring of Charos, Steel gauntlets and their enchanted forms, the magic butterfly
 * net). A PvP death destroys them unless they are kept: they are neither dropped for the killer
 * nor given back. Items with a death rule of their own (the rune pouch, bolt pouch, looting bag,
 * jar generator, salamanders) handle it in their own plugins.
 */
const DATA = require("./data/never-kept-on-death.json");

const NAMES = new Set([
  ...DATA.items,
  ...DATA.leagueTrophies.leagues.flatMap((league) => DATA.leagueTrophies.tiers.map((tier) => `${league} ${tier} trophy`)),
].map((name) => name.toLowerCase()));

function isNeverKept(item) {
  const definition = item?.getDefinition?.();
  if (!definition || item.isTradeable()) return false;
  return NAMES.has(String(definition.getName() ?? "").toLowerCase());
}

function lostOnPvpDeath(event) {
  const { player, killer, item } = event;
  if (event.kept || event.shouldDropItems === false || !killer || killer === player) return;
  if (isNeverKept(item)) event.handled = true;
}

module.exports = {
  name: "NeverKeptOnDeath",
  description: "Destroys the untradeables that are never kept on death (League trophies, the Chronicle, items with no ground state) on a PvP death, instead of giving them back.",
  members: true,
  _test: { isNeverKept, NAMES },
  register(api) {
    api.onPlayerDeathItemDrop(lostOnPvpDeath);
  },
};
