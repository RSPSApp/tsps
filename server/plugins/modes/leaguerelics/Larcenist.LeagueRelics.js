/**
 * Larcenist (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 5
 * relic: every pickpocket succeeds, the coin pouch limit is ten times as high, pickpockets and
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

function again(request) {
  if (active(request.player)) request.again = true;
}

function keepStall(request) {
  if (active(request.player)) request.handled = true;
}

/** The delivered plain bundle comes noted and ten times over, without consuming older metadata. */
function stallLoot({ player, method, itemId, amount = 1 }) {
  if (method !== "stall" || !Number.isInteger(itemId) || !Number.isSafeInteger(amount) || amount <= 0
      || !active(player) || !Common.multipliable(itemId)) return;
  const { Item, Inventory } = Common.core;
  const inventory = player.getInventory();
  const copies = inventory.getItems().map((item, slot) => ({ item, slot }))
    .filter(({ item }) => item.getId() === itemId && item.getMeta() == null);
  if (copies.reduce((sum, { item }) => sum + item.getAmount(), 0) < amount) return;
  const noted = Common.noted(itemId);
  const output = amount * effect.lootMultiplier;
  if (noted === itemId) {
    if (inventory.getAddableAmount(new Item(itemId, output - amount)) < output - amount) return inventory.full();
    inventory.adds(itemId, output - amount);
    return;
  }
  // A note may use a slot freed by its inputs. Preview on cloned items never refreshes the real inventory.
  const preview = new Inventory(player).setItems(inventory.getCopiedItems());
  let left = amount;
  const taken = [];
  for (const { item, slot } of copies) {
    const count = Math.min(left, item.getAmount());
    if (count <= 0) break;
    preview.deleteAtSlot(slot, count, false);
    taken.push({ slot, count });
    left -= count;
  }
  if (preview.getAddableAmount(new Item(noted, output)) < output) return inventory.full();
  for (const { slot, count } of taken) inventory.deleteAtSlot(slot, count);
  inventory.adds(noted, output);
}

function unseen(watch) {
  if (active(watch.player)) watch.unseen = true;
}

module.exports = function attach(api) {
  effect = Common.data.effects.larcenist;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:done", again);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
  api.onCustomEvent("thieving:success", stallLoot);
  api.onCustomEvent("thieving:stall-watch", unseen);
};
