"use strict";

// Every random event reward goes through here. Live hands each item over on its own: what
// fits joins the inventory, the rest is placed under the player for three hours (obj_add
// despawn=18000), owner-only; tradeable items turn public after the usual 100 ticks and
// untradeable ones never do. Each item gets its own reward message. See SOURCES.md.
const LIFETIME_TICKS = 3 * 60 * 60 * 1000 / 600;
const HIGHLIGHT = "<col=ff0000>";

// A reward joins the inventory whole or not at all: add() clamps a stack at its maximum, so a
// stack too full for the whole amount sends the reward to the ground instead.
function fits(inventory, item) {
  return inventory.getAddableAmount(item) >= item.getAmount();
}

/**
 * Gives `rewards` (ids, or `{ id, amount }`) to `player`. `alwaysPrivate` keeps a dropped
 * tradeable item owner-only too, as the Strange Plant's fruit is.
 */
function give(api, player, rewards, { alwaysPrivate = false } = {}) {
  const inventory = player.getInventory();
  for (const reward of rewards) {
    const item = new api.core.Item(typeof reward === "number" ? reward : reward.id,
      typeof reward === "number" ? 1 : reward.amount ?? 1);
    const definition = item.getDefinition();
    const amount = `${HIGHLIGHT}${item.getAmount()}</col> x ${HIGHLIGHT}${definition.getName()}</col>`;
    api.emitCustomEvent("collection-log:obtain", { player, itemId: item.getId(), amount: item.getAmount() });
    if (fits(inventory, item)) {
      inventory.addItem(item);
      player.sendMessage(`Your reward is: ${amount}.`);
      continue;
    }
    api.getItemOnGroundManager().registerLocation(player, item, player.getLocation().clone(), undefined, {
      goesGlobal: !alwaysPrivate && definition.isTradeable(),
      despawnDelay: LIFETIME_TICKS,
    });
    player.sendMessage(`Your reward is: ${amount} - it has been placed ${HIGHLIGHT}on the ground</col>.`);
  }
}

/**
 * Unlocks the first emote varbit of `varbits` (cache names) not already unlocked, through the
 * Emotes plugin, and returns its name; undefined when all of them already are.
 */
function unlockEmote(api, player, varbits) {
  for (const varbit of varbits) {
    const request = { player, varbit, unlocked: false };
    api.emitCustomEvent("emotes:unlock", request);
    if (request.unlocked) return varbit;
  }
  return undefined;
}

module.exports = { give, unlockEmote, LIFETIME_TICKS };
