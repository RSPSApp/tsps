"use strict";

/**
 * Crystal saw (members), https://oldschool.runescape.wiki/w/Crystal_saw. Carried in the inventory it
 * lets the player build furniture "up to 3 levels higher" than their Construction level: only
 * builds that need a saw and a hammer, not rooms nor garden plants, and flatpacks made at a
 * workbench too. It has 28 charges, 56 with the medium Western Provinces Diary; one is spent per
 * piece that needed the boost (none when the level already meets it), and with none left the saw
 * reverts to its seed, which the singing bowl turns back into a saw (EyesOfGlouphrie's
 * "crystal-saw:made").
 *
 * Check: "Your saw has # charges left." (rsprox captures: recordings 260 (rev 229) and 310
 * (rev 230), 5 attempts, a game message on the click's tick).
 *
 * The charges belong to the player, not the saw (it is one untradeable item, and a fresh saw starts
 * full). Ours: the count left is the diary's maximum less the charges used, so completing the
 * medium diary adds 28 to a saw in use; the line shown when the saw reverts to its seed is not
 * captured nor on the Wiki; the Check line keeps "charges" for one charge too.
 *
 * Construction asks "construction:level-boost" `{ player, buildable, boost }` and, when a build
 * went through only thanks to the boost, emits "construction:level-boost-used" `{ player, buildable }`.
 */

const CHARGES_USED_ATTRIBUTE = "crystal-saw:charges-used";
const BASE_CHARGES = 28;
const DIARY_CHARGES = 56;
const LEVEL_BOOST = 3;

let api;
let core;

function maxCharges(player) {
  const request = { player, diary: "western", tier: "medium", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true ? DIARY_CHARGES : BASE_CHARGES;
}

function chargesLeft(player) {
  const used = player.getAttribute(CHARGES_USED_ATTRIBUTE);
  const max = maxCharges(player);
  return Math.max(0, max - (Number.isInteger(used) && used > 0 ? used : 0));
}

function carriesSaw(player) {
  return player.getInventory().contains(core.ItemIdentifiers.CRYSTAL_SAW);
}

function check({ player, item }) {
  if (item?.getId?.() !== core.ItemIdentifiers.CRYSTAL_SAW) return false;
  player.sendMessage(`Your saw has ${chargesLeft(player)} charges left.`);
  return true;
}

/** "construction:level-boost": +3 while the saw is in the inventory with a charge left. */
function levelBoost(request) {
  const { player } = request;
  if (!carriesSaw(player) || chargesLeft(player) < 1) return;
  request.boost = Math.max(Number(request.boost) || 0, LEVEL_BOOST);
}

/** The seed takes the saw's slot. */
function revertToSeed(player) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(core.ItemIdentifiers.CRYSTAL_SAW);
  if (slot < 0) return;
  player.setAttribute(CHARGES_USED_ATTRIBUTE, 0);
  inventory.setItem(slot, new core.Item(core.ItemIdentifiers.CRYSTAL_SAW_SEED, 1));
  inventory.refreshItems();
  player.sendMessage("Your crystal saw has run out of charges and reverts to a seed."); // Ours: uncaptured
}

/** "construction:level-boost-used": the saw spends a charge, and reverts to its seed on the last. */
function boostUsed({ player }) {
  if (!carriesSaw(player) || chargesLeft(player) < 1) return;
  const used = player.getAttribute(CHARGES_USED_ATTRIBUTE);
  player.setAttribute(CHARGES_USED_ATTRIBUTE, (Number.isInteger(used) && used > 0 ? used : 0) + 1);
  if (chargesLeft(player) < 1) revertToSeed(player);
}

/** A seed sung into a saw (EyesOfGlouphrie's singing bowl) starts with every charge. */
function sawMade({ player }) {
  player.setAttribute(CHARGES_USED_ATTRIBUTE, 0);
}

module.exports = {
  name: "CrystalSaw",
  description: "Crystal saw: an invisible +3 Construction boost from the inventory for saw-and-hammer furniture, 28 charges (56 with the medium Western Provinces Diary), Check.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CHARGES_USED_ATTRIBUTE, 0);
    api.onItemAction("Crystal saw", { Check: check });
    api.onCustomEvent("construction:level-boost", levelBoost);
    api.onCustomEvent("construction:level-boost-used", boostUsed);
    api.onCustomEvent("crystal-saw:made", sawMade);
  },
  _test: { check, levelBoost, boostUsed, sawMade, chargesLeft, CHARGES_USED_ATTRIBUTE },
};
