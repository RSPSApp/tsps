"use strict";
const { PlayerDeathTask } = require("../../../src/main/typescript/elvarg/game/task/impl/PlayerDeath");

/**
 * What a PvP death does to the breakable items it doesn't protect (Wiki: Items Kept on Death,
 * (broken), (l)). A PvP death is one in the Wilderness to a player killer; anywhere else, or
 * to a monster, nothing breaks and the item goes to the grave like any other untradeable.
 *
 * - Up to level 20 Wilderness, the item stays with the victim in its broken form.
 * - Above level 20, a lockable item is lost unless locked; a locked one becomes mangled.
 *   Items Perdu can't lock break as below level 20.
 * - The killer gets the repair cost in coins, or 500,000 for a mangled item.
 *
 * Protected items never break. Before one breaks, `broken-items:pvp-death` { player, killer, item, location, shouldDropItems }
 * is emitted with the item still in its original form.
 */
const Common = require("./Common.BrokenItems");

const DEEP_WILDERNESS_LEVEL = 20;

function isPvpDeath(player, killer) {
  return killer != null && killer !== player && Common.getCore().Wilderness.isIn(player);
}

function wildernessLevel(player) {
  const location = player.getLocation();
  return Number(Common.getCore().Wilderness.levelAt(location.getX(), location.getY())) || 0;
}

function dropCoins(event, amount) {
  if (amount <= 0 || !event.location) return;
  const { Item, ItemIdentifiers, ItemOnGroundManager } = Common.getCore();
  const owner = PlayerDeathTask.lootOwner(event.player, event.killer);
  ItemOnGroundManager.registerLocation(owner, new Item(ItemIdentifiers.COINS, amount), event.location);
}

function breakOnPvpDeath(event) {
  const { player, killer, item } = event;
  if (event.kept || !isPvpDeath(player, killer)) return;
  // A preset or meta-untradeable copy (Presets.PvpMode tags them) was never paid for: it does not break into
  // its repair cost, or every free preset would mint coins for whoever kills its wearer.
  if (item.isPresetItem?.() === true || item.isUntradeable?.() === true) return;
  const found = Common.lookup(item.getId());
  if (!found || found.entry.ownDeathRules || found.entry.repairCost == null) return;
  const { entry, form } = found;
  if (form.kind !== "unlocked" && form.kind !== "locked") return;
  // Before the item changes: content that keeps state with it (Dizana's max cape's stored ammo) sees what it was.
  Common.getApi().emitCustomEvent("broken-items:pvp-death", { player, killer, item, location: event.location, shouldDropItems: event.shouldDropItems });
  const deep = entry.lockable && wildernessLevel(player) > DEEP_WILDERNESS_LEVEL;
  if (deep && form.kind === "locked" && form.mangledId != null) {
    item.setId(form.mangledId);
    dropCoins(event, Common.DATA.mangledRepairCost);
  } else if (deep && form.kind === "unlocked") {
    item.setId(-1);
    event.handled = true;
    dropCoins(event, Common.repairCost(entry));
  } else if (form.brokenId != null) {
    // An item with no broken form in the cache (a plain ancient sceptre) is left as it is.
    item.setId(form.brokenId);
    dropCoins(event, Common.repairCost(entry));
  }
}

function attach(api) {
  api.onPlayerDeathItemDrop(breakOnPvpDeath);
}

module.exports = attach;
module.exports.breakOnPvpDeath = breakOnPvpDeath;
