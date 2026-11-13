// Where blighted supplies work: the one rule shared by blighted food, blighted potions and the
// blighted spell sacks. The Wiki pages (Blighted super restore, Blighted manta ray,
// Blighted karambwan, Blighted anglerfish and each sack) give the same places, BLIGHTED_ITEM_PLACES.
// Ferox Enclave sits inside the levelled Wilderness strip, so the level check covers it.
// The client's own flag for it is varbit blighted_items_allowed, which BlightedSpellSacks syncs.
// The client's Item Stats tooltip imports this file for the places and the name rule, so it
// stays free of requires.
const BLIGHTED_ITEM_PLACES = Object.freeze([
  "Wilderness", "Ferox Enclave", "Mage Arena bank", "PvP worlds", "Castle Wars", "Clan Wars", "Soul Wars",
]);
const MAGE_ARENA_BANK_REGION = 10057; // The cave reached by magearena_lever_to_cellar (2539, 4712).
// Ours: the Bounty Hunter lobby and arena are kept from the sack rule this replaces.
const BLIGHTED_MINIGAMES = new Set(["Castle Wars", "Clan Wars", "Soul Wars", "BountyHunterLobby", "BountyHunterArena"]);

/**
 * Blighted supplies are every item the cache names "Blighted ..." (super restore, overload, food, sacks).
 * @param {string | undefined} name
 * @returns {boolean}
 */
function isBlightedItemName(name) {
  return /^Blighted /.test(name ?? "");
}

function isBlightedItem(core, itemId) {
  if (!core.CacheDefinitions.hasItem(itemId)) return false;
  return isBlightedItemName(core.CacheDefinitions.getItem(itemId)?.name);
}

function allowsBlightedItems(core, player) {
  const location = player.getLocation();
  return core.WorldDefinition.hasGlobalWorldTag("pvp") ||
    core.Wilderness.levelAt(location.getX(), location.getY()) > 0 ||
    (((location.getX() >> 6) << 8) | (location.getY() >> 6)) === MAGE_ARENA_BANK_REGION ||
    BLIGHTED_MINIGAMES.has(player.getArea?.()?.getName());
}

module.exports = { BLIGHTED_ITEM_PLACES, allowsBlightedItems, isBlightedItem, isBlightedItemName };
