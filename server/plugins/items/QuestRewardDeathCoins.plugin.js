"use strict";

/**
 * Untradeable quest rewards with combat stats that are bought from an NPC (the barrelchest anchor, barrows gloves)
 * turn into coins for the killer on a PvP death (https://oldschool.runescape.wiki/w/Items_Kept_on_Death): the item is
 * lost, and its coin value drops for the killer as the rest of the loot does (an Ironman killer's go to the victim,
 * PlayerDeathTask.lootOwner). Kept items stay kept, and a PvM death leaves the item to the grave like any other
 * untradeable.
 */
const { PlayerDeathTask } = require("../../src/main/typescript/elvarg/game/task/impl/PlayerDeath");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const DATA = require("./data/quest-reward-death-coins.json");

const COINS = 995;

/**
 * Item id -> coins a PvP death turns it into. By id, not name: the broken barrelchest anchor and other copies of
 * these items share their names but are worth nothing.
 */
const COINS_BY_ID = new Map(DATA.items.map((entry) => {
  const id = ItemIdentifiers[entry.item];
  if (typeof id !== "number") throw new Error(`quest-reward-death-coins.json: unknown item ${entry.item}`);
  return [id, entry.coins];
}));

/** The coins `item` becomes on a PvP death, or 0 when it is not one of these items. */
function deathCoins(item) {
  if (!item || item.isTradeable()) return 0;
  return COINS_BY_ID.get(item.getId()) ?? 0;
}

function toCoinsOnPvpDeath(event, api) {
  const { player, killer, item } = event;
  if (event.kept || event.shouldDropItems === false || !killer || killer === player) return;
  // A preset copy was never paid for: it does not turn into coins, or every free preset would mint them.
  if (item.isPresetItem?.() === true || item.isUntradeable?.() === true) return;
  const coins = deathCoins(item);
  if (coins <= 0) return;
  event.handled = true;
  if (!event.location) return;
  const { Item, ItemOnGroundManager } = api.core;
  ItemOnGroundManager.registerLocation(PlayerDeathTask.lootOwner(player, killer), new Item(COINS, coins), event.location);
}

module.exports = {
  name: "QuestRewardDeathCoins",
  description: "Turns the barrelchest anchor and barrows gloves into coins for the killer on a PvP death.",
  members: true,
  _test: { deathCoins, COINS_BY_ID },
  register(api) {
    api.onPlayerDeathItemDrop((event) => toCoinsOnPvpDeath(event, api));
  },
};
