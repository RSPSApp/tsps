"use strict";

/**
 * The Alchemist's outfit's Change option (Wiki: Alchemist's outfit,
 * https://oldschool.runescape.wiki/w/Alchemist%27s_outfit; docs/mastering-mixology.md).
 *
 * The prescription goggles, labcoat and pants each have a second look (the goggles focused or
 * unfocused, the labcoat and pants with an apron). Change, in the inventory only, swaps the piece
 * for its other look in the same slot, says "You adjust the style of your <name>." and plays the
 * equip_fun sound (rsprox recording 4210). Both looks are the same item otherwise: the goggles'
 * secondary saving works in either (Goggles.Mixology.js).
 */

const Shared = require("./Shared.Mixology");

const STYLES = Shared.DATA.outfitStyles;

let partners = null;

/** Each look's id to its other look's id. */
function partnerMap() {
  if (partners) return partners;
  const { CacheDefinitions } = Shared.core();
  partners = new Map();
  for (const [first, second] of STYLES.pairs) {
    const a = CacheDefinitions.getObjId(first), b = CacheDefinitions.getObjId(second);
    if (a == null || b == null) continue;
    partners.set(a, b);
    partners.set(b, a);
  }
  return partners;
}

function change(event) {
  const { player, itemId, slot } = event;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  const other = partnerMap().get(Number(itemId));
  if (other == null || !item || item.getId() !== Number(itemId)) return false;
  const name = Shared.core().CacheDefinitions.getItem(item.getId()).name;
  item.setId(other);
  inventory.refreshItems();
  player.sendMessage(STYLES.message.replace("{name}", name));
  Shared.sound(player, STYLES.sound);
  return true;
}

module.exports = function attachOutfit(api) {
  // Both looks of each piece share its name, so one name hook covers the pair.
  for (const name of ["Prescription goggles", "Alchemist labcoat", "Alchemist pants"]) {
    api.onItemAction(name, { Change: change });
  }
};

module.exports.change = change;
