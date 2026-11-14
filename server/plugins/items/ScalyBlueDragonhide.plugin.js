"use strict";

/**
 * Scaly blue dragonhide (members), a blue dragon drop (https://oldschool.runescape.wiki/w/Scaly_blue_dragonhide).
 * docs/scaly-blue-dragonhide.md has the rsprox captures this follows.
 *
 * A knife used on the hide, either way round, scrapes it into 50 noted blue dragon scales, but only in
 * a bank ("You can only do this whilst in a bank.", Wiki). It is instant: one hide per use, no
 * animation or sound, and no experience. The first hide in the pack goes, whichever was clicked, and the
 * scales join any noted scales already carried, else take the first free slot (rsprox captures).
 */

const KNIFE = "Knife";
const HIDE = "Scaly blue dragonhide";
const SCALES = 50;

const SCRAPED = "You scrape the scales off of the dragonhide.";
const NOT_IN_BANK = "You can only do this whilst in a bank.";

let pluginApi;
let core;

function nearBank(player) {
  const query = { player, near: false };
  pluginApi.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

/** The knife on the hide, either way round. */
function knifeOnHide(event) {
  const I = core.ItemIdentifiers;
  const { player } = event;
  const usedIsHide = event.usedItemId === I.SCALY_BLUE_DRAGONHIDE;
  const hideSlot = usedIsHide ? event.usedItemSlot : event.usedWithItemSlot;
  if (!usedIsHide && event.usedWithItemId !== I.SCALY_BLUE_DRAGONHIDE) return;
  event.handled = true;
  const inventory = player.getInventory();
  if (inventory.getItems()[hideSlot]?.getId?.() !== I.SCALY_BLUE_DRAGONHIDE) return;
  if (!nearBank(player)) {
    player.sendMessage(NOT_IN_BANK);
    return;
  }
  const scales = new core.Item(core.ItemDefinition.forId(I.BLUE_DRAGON_SCALE).getNoteId(), SCALES);
  // rsprox 1000380 t4994-4996: the first hide goes, then the scales go to the stack or the first free slot.
  inventory.deleted(I.SCALY_BLUE_DRAGONHIDE, 1, false);
  inventory.add(scales, false);
  inventory.refreshItems();
  player.sendMessage(SCRAPED);
}

module.exports = {
  name: "ScalyBlueDragonhide",
  description: "Scaly blue dragonhide: a knife on it in a bank scrapes 50 noted blue dragon scales.",
  members: true,
  register(api) {
    pluginApi = api;
    core = api.core;
    api.onItemOnItem(KNIFE, HIDE, knifeOnHide, { noted: false });
  },
  _test: { knifeOnHide, SCALES, SCRAPED, NOT_IN_BANK },
};
