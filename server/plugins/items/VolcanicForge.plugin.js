/**
 * The Volcanic Forge at the Blighted Volcano (https://oldschool.runescape.wiki/w/Volcanic_Forge),
 * object 26755, on two tiles at 3366,3937 and 3367,3937 in the Wilderness:
 *
 * - Using a shard on the forge with all three shards of that set in the pack forges the ward and
 *   consumes them (https://oldschool.runescape.wiki/w/Odium_ward#Creation: "When all three shards
 *   are present in the player's inventory, they must travel to the Volcanic Forge ... to forge the
 *   ward.").
 * - "You forge the shield pieces together in the chambers of fire and are blown back by the intense
 *   heat." — the Wiki's wording, verbatim.
 *
 * The forge has no options of its own, so a use is the only way in.
 *
 * Not implemented: the animation, and the step off the tile the message describes. The Wiki's
 * infobox declares no animation, the object's own config carries no sequence, and the only evidence
 * is the low-resolution gif on the page, which shows an arms-out pose then the player on a
 * neighbouring tile. Naming an id from that would be inventing one, so the forge is silent on the
 * client and the ward appears in the pack.
 *
 * A use without all three shards does nothing: the Wiki documents the message only alongside
 * forging, so a half set is left to the default "Nothing interesting happens" rather than sending a
 * line that says the pieces were forged.
 */
/** The forge's cache (gameval) name; its display name is "Volcanic Forge". */
const FORGE_LOC = "wilderness_volcanoforge";
const FORGE_MESSAGE = "You forge the shield pieces together in the chambers of fire and are blown back by the intense heat.";

let api = null;
let cachedSets = null;

/** The ward each shard set forges, from the cache's item identifiers. */
function buildShardSets(identifiers) {
  return [
    {
      ward: identifiers.ODIUM_WARD,
      shards: [identifiers.ODIUM_SHARD_1, identifiers.ODIUM_SHARD_2, identifiers.ODIUM_SHARD_3],
    },
    {
      ward: identifiers.MALEDICTION_WARD,
      shards: [
        identifiers.MALEDICTION_SHARD_1,
        identifiers.MALEDICTION_SHARD_2,
        identifiers.MALEDICTION_SHARD_3,
      ],
    },
  ];
}

/** The sets in use, built once from the connected core. */
const shardSets = () => (cachedSets ??= buildShardSets(api.core.ItemIdentifiers));

/** The set this item is a shard of, or null. */
function setFor(itemId, sets = shardSets()) {
  return sets.find((set) => set.shards.includes(itemId)) ?? null;
}

/**
 * The set a use forges: the item must be a shard, and all three of its set must be in the pack.
 * Null otherwise, so the use falls through untouched.
 */
function forgeSetFor(itemId, inventory, sets = shardSets()) {
  const set = setFor(itemId, sets);
  if (!set) return null;
  return set.shards.every((shard) => (inventory?.getAmount?.(shard) ?? 0) > 0) ? set : null;
}

const isForge = (object) => object?.getId?.() === api.core.CacheDefinitions.getLocId(FORGE_LOC);

/** Using a shard of a complete set on the forge forges the ward. */
function itemOnForge(event) {
  if (event.handled || !isForge(event.object)) return;
  const inventory = event.player.getInventory();
  const set = forgeSetFor(event.itemId, inventory);
  if (!set) return;
  event.handled = true;
  for (const shard of set.shards) inventory.deleteNumber(shard, 1);
  inventory.adds(set.ward, 1);
  inventory.refreshItems();
  event.player.sendMessage(FORGE_MESSAGE);
}

module.exports = {
  name: "VolcanicForge",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onItemOnObject(itemOnForge);
  },
  _test: { FORGE_MESSAGE, FORGE_LOC, buildShardSets, setFor, forgeSetFor },
};
