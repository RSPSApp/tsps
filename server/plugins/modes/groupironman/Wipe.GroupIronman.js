"use strict";

/**
 * Which items a leaver who stays a ranked Group Ironman loses (Wiki, Group Ironman Mode: Leaving a
 * group): every tradeable item, and of the untradeable ones
 * - reward caskets (scroll boxes are kept);
 * - untradeable forms of normally tradeable items: imbued items (the Wiki's tests: Slayer helm (i),
 *   Magic shortbow (i)), items with an ornament kit ("(or)", Mystic lava staff (or)) and degraded
 *   Barrows equipment ("... 100" to "... 0"), when the item without that mark is tradeable.
 * Untradeables otherwise stay (quest items, capes, pets). The other places that keep items (the
 * looting bag, the rune pouch's runes, coffers, the seed vault) clear themselves on
 * "group-ironman:wipe-tradeables".
 */

const Common = require("./Common.GroupIronman");

const REWARD_CASKET = /^reward casket\b/i;
const IMBUED = / ?\(i\)$/i;
/** Marks an untradeable form carries; the item without them is the tradeable original. */
const FORM_MARKS = [/ ?\(or\)$/i, / (100|75|50|25|0)$/];

let tradeableNames = null;

function definition(id) {
  return Common.api.core.ItemDefinition.forId(id);
}

/** Lower-case names of every tradeable, unnoted item in the cache (built once). */
function tradeable(name) {
  if (!tradeableNames) {
    tradeableNames = new Set();
    const count = Common.api.core.CacheDefinitions.getCounts().items;
    for (let id = 0; id < count; id++) {
      const item = definition(id);
      if (item?.isTradeable?.() && !item.isNoted?.()) tradeableNames.add(String(item.getName?.() ?? "").toLowerCase());
    }
  }
  return tradeableNames.has(name.toLowerCase());
}

/** Whether a ranked leaver loses this item. */
function lost(item) {
  if (!item || item.getId() <= 0 || item.getAmount() <= 0) return false;
  if (item.isTradeable?.() === true) return true;
  const name = String(definition(item.getId())?.getName?.() ?? "");
  if (REWARD_CASKET.test(name) || IMBUED.test(name)) return true;
  return FORM_MARKS.some((mark) => mark.test(name) && tradeable(name.replace(mark, "")));
}

module.exports = { lost };
