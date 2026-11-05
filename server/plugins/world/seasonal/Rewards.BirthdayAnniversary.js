"use strict";

// Wiki 25th Anniversary event, Rewards: the helmet, two tabards, the 5x5 hat and two
// noted half full wine jugs, once per account; Diango keeps the cosmetics retrievable.
const Data = require("./Data.BirthdayAnniversary");
const Progress = require("./Progress.BirthdayAnniversary");

function items(api) {
  const I = api.core.ItemIdentifiers;
  return Data.REWARDS.map(name => new api.core.Item(I[name], 1));
}
function jugs(api) { return new api.core.Item(api.core.ItemIdentifiers.HALF_FULL_WINE_JUG_2, Data.WINE_JUGS); }
/** Slots the whole reward still needs: four cosmetics, and the jug note unless it stacks. */
function slotsNeeded(api, player) {
  const inventory = player.getInventory();
  return Data.REWARDS.length + (inventory.getAmount(jugs(api).getId()) > 0 ? 0 : 1);
}
function missingSlots(api, player) { return Math.max(0, slotsNeeded(api, player) - player.getInventory().getFreeSlots()); }
function unlock(api, player) {
  const names = api.core.CacheDefinitions.getObjNames();
  const request = { player, items: items(api).map(item => names.get(item.getId())), accepted: false };
  api.emitCustomEvent("holiday-rewards:unlock", request);
  if (!request.accepted) api.log("25th Anniversary rewards are not in Diango's holiday catalogue", { items: request.items });
}
function grant(api, { player }) {
  if (Progress.rewarded(player) || !Progress.complete(player)) return;
  const inventory = player.getInventory(), all = [...items(api), jugs(api)];
  // All or nothing: a full inventory leaves the reward waiting with Wizard Gary.
  if (missingSlots(api, player) > 0 || all.some(item => inventory.getAddableAmount(item) !== item.getAmount())) return;
  Progress.markRewarded(player);
  for (const item of all) inventory.addItem(item);
  Progress.advance(api, player, "rewarding", "complete");
  unlock(api, player);
}
/**
 * After the window, a player who finished but never had room for the hand-out keeps the
 * cosmetics through Diango. The reward is then settled, so a reopened window cannot hand
 * out a second set on top of Diango's (the jugs are not Diango items and are not reissued).
 */
function settle(api, { player }) {
  if (!Progress.complete(player) || Progress.rewarded(player)) return;
  Progress.markRewarded(player);
  Progress.advance(api, player, "rewarding", "complete");
  unlock(api, player);
}
function space(api, request) { request.needed = missingSlots(api, request.player); }

module.exports = { grant, settle, space, slotsNeeded, missingSlots };
