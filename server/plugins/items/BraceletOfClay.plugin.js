"use strict";

/**
 * Bracelet of clay (members). https://oldschool.runescape.wiki/w/Bracelet_of_clay and
 * https://oldschool.runescape.wiki/w/Soft_clay_rocks: worn, it turns mined clay into soft clay and
 * gives two soft clay per success at the soft clay rocks. One bracelet softens 28 clay, its charges
 * belong to the player rather than the bracelet, and it crumbles when they are used up.
 * The Wiki's worn Check is not in the rev 241 cache (no worn option params on the item), so the
 * client never offers it. The crumble line's wording is ours: no capture or Wiki transcript records it.
 */

const CHARGES_ATTRIBUTE = "bracelet-of-clay:charges";
const MAX_CHARGES = 28;

let core;

function wearsBracelet(player) {
  const worn = player.getEquipment().get(core.Equipment.HANDS_SLOT);
  return worn?.getId?.() === core.ItemIdentifiers.BRACELET_OF_CLAY;
}

function chargesLeft(player) {
  const value = player.getAttribute(CHARGES_ATTRIBUTE);
  return Number.isInteger(value) ? Math.max(0, Math.min(MAX_CHARGES, value)) : MAX_CHARGES;
}

function spendCharge(player) {
  const left = chargesLeft(player) - 1;
  if (left > 0) {
    player.setAttribute(CHARGES_ATTRIBUTE, left);
    return;
  }
  player.setAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
  player.getEquipment().set(core.Equipment.HANDS_SLOT, new core.Item(-1));
  player.getEquipment().refreshItems();
  player.sendMessage("Your bracelet of clay crumbles to dust.");
}

/** "mining:ore-yield": clay is mined as soft clay, and a soft clay rock gives one more. */
function oreYield(request) {
  const { player } = request;
  const I = core.ItemIdentifiers;
  if (!wearsBracelet(player)) return;
  if (request.oreId === I.CLAY) request.oreId = I.SOFT_CLAY;
  else if (request.oreId === I.SOFT_CLAY && request.rock === "Soft clay rocks") request.amount += 1;
  else return;
  request.spend = () => spendCharge(player);
}

module.exports = {
  name: "BraceletOfClay",
  members: true,
  register(api) {
    core = api.core;
    api.persistAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
    api.onCustomEvent("mining:ore-yield", oreYield);
  },
  _test: { oreYield, chargesLeft, CHARGES_ATTRIBUTE, MAX_CHARGES },
};
