/**
 * Dodgy Deals (https://oldschool.runescape.wiki/w/Dodgy_Deals_(Raging_Echoes_League)), Raging
 * Echoes' tier 2 relic: every Thieving check succeeds, a pickpocket's loot is noted and
 * multiplied by the NPCs of the same kind within 5 tiles (the Wiki's 11x11; coins by the pouch),
 * the coin pouch limit is tripled, pickpockets and stall thefts repeat themselves, and stalls
 * never run out for the relic's owner.
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

/** NPCs of the pickpocketed kind (the same name: a man is a man whatever his id) within reach, the target among them. */
function crowd(player, npc) {
  const name = npc?.getDefinition?.()?.getName?.();
  if (!name) return 1;
  const here = player.getLocation();
  return Math.max(1, player.getLocalNpcs().filter((other) => other.getDefinition?.()?.getName?.() === name && other.getHitpoints() > 0
    && other.getLocation().getZ() === here.getZ() && other.getLocation().isWithinDistance(here, effect.radius)).length);
}

/** Noted, and as many as the crowd (coins that many pouches; a clue, or an item that neither stacks nor notes, once). */
function loot(request) {
  if (active(request.player)) request.loot = Common.multipliedLoot(request.loot, crowd(request.player, request.npc));
}

/** Chart-based stalls ask before their failed roll can return. Other stall refusals stay with the producer. */
function succeeds(request) {
  if (active(request.player)) request.success = true;
}

function again(request) {
  if (active(request.player)) request.again = true;
}

function keepStall(request) {
  if (active(request.player)) request.handled = true;
}

module.exports = function attach(api) {
  effect = Common.data.effects.dodgyDeals;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:stall-roll", succeeds);
  api.onCustomEvent("thieving:done", again);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
};
