/**
 * Larcenist (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 5
 * relic: every Thieving action succeeds, the coin pouch limit is ten times as high, pickpockets and
 * stall thefts repeat themselves, stalls never run out for the relic's owner, and what both give
 * is noted and multiplied by 10 (coins as ten pouches; an item that neither stacks nor notes, and
 * a clue, once: as the other Thieving relics). No guard (nor the stall's owner, whose shout sends
 * them) catches the relic's owner at a stall (`thieving:stall-watch`). A repeating pickpocket
 * follows the NPC as it wanders (Pickpocket.Thieving.js): recs 1104-1106 show an attempt every
 * 2 ticks with no clicks, hundreds in a row, until a click or the coin pouch limit.
 * Not here: the tenfold Varlamore house valuables (house thieving is not on the server).
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

/** Override only the chart roll; eligibility and other refusals stay with the stall. */
function succeeds(request) {
  if (active(request.player)) request.success = true;
}

function again(request) {
  if (request.kind === "stall" && request.object?.getDefinition()?.getName() === "Scimitar Stall") return;
  if (active(request.player)) request.again = true;
}

function keepStall(request) {
  if (active(request.player)) request.handled = true;
}

/** Deliver the complete noted bundle before plain-item capacity can truncate it. */
function stallLoot(request) {
  const { player, stall, itemId, amount } = request;
  // The Wiki excludes Magic's multiplier and Scimitar's multiplier/noting/auto-steal.
  if (request.handled || stall === "Magic Stall" || stall === "Scimitar Stall"
      || !Number.isInteger(itemId) || !Number.isSafeInteger(amount) || amount <= 0
      || !active(player) || !Common.multipliable(itemId)) return;
  const { Item } = Common.core;
  const inventory = player.getInventory();
  const output = new Item(Common.noted(itemId), amount * effect.lootMultiplier);
  if (inventory.getAddableAmount(output) < output.getAmount()) return inventory.full();
  inventory.addItem(output);
  request.handled = true;
}

function unseen(watch) {
  if (active(watch.player)) watch.unseen = true;
}

module.exports = function attach(api) {
  effect = Common.data.effects.larcenist;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:stall-roll", succeeds);
  api.onCustomEvent("thieving:done", again);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
  api.onCustomEvent("thieving:stall-reward", stallLoot);
  api.onCustomEvent("thieving:stall-watch", unseen);
};
