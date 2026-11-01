/**
 * Larcenist (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 5
 * relic: every pickpocket succeeds, the coin pouch limit is ten times as high, pickpockets and
 * stall thefts repeat themselves, stalls never run out for the relic's owner, and what both give
 * is noted and multiplied by 10 (coins as ten pouches; an item that neither stacks nor notes, and
 * a clue, once: as the other Thieving relics).
 * Not here: guards that never catch a stall thief, and the tenfold Varlamore house valuables
 * (Thieving asks no hook for either).
 */
const Common = require("./Common.LeagueRelics");

let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function pickpocketTarget(request) {
  if (!request.target || !active(request.player)) return;
  request.alwaysSucceeds = true;
  request.pouchLimit *= effect.pouchLimitMultiplier;
}

function loot(request) {
  if (active(request.player)) request.loot = Common.multipliedLoot(request.loot, effect.lootMultiplier);
}

function again(request) {
  if (active(request.player)) request.again = true;
}

function keepStall(request) {
  if (active(request.player)) request.handled = true;
}

/** The stall's item, just handed over, comes noted and ten times over. */
function stallLoot({ player, method, itemId }) {
  if (method !== "stall" || !Number.isInteger(itemId) || !active(player) || !Common.multipliable(itemId)) return;
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return;
  const noted = Common.noted(itemId);
  const amount = effect.lootMultiplier;
  if (noted === itemId) {
    inventory.adds(itemId, amount - 1);
    return;
  }
  inventory.deleteNumber(itemId, 1);
  inventory.adds(noted, amount);
}

module.exports = function attach(api) {
  effect = Common.data.effects.larcenist;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:done", again);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
  api.onCustomEvent("thieving:success", stallLoot);
};
