"use strict";

// Native recordings1058 (elite) and3931 (master): inventory141 is displayed on
// opening; inventory93 receives those items when the reward screen is closed.
const PENDING_ATTRIBUTE = "treasure-trails:pending-casket-rewards";
const REWARD_INTERFACE = 73;
const settling = new WeakSet();
let core;

function initialize(coreApi) { core = coreApi; }

/** All entries are already resolved/validated by the tier's preparation step. */
function queue(player, drops) {
  const pending = player.getAttribute(PENDING_ATTRIBUTE) ?? [];
  player.setAttribute(PENDING_ATTRIBUTE, [...pending, ...drops.map(drop => ({
    id: drop.creditId, amount: drop.amount, stackable: drop.stackable,
  }))]);
}

function settle({ player }) {
  if (settling.has(player) || !(player.getAttribute(PENDING_ATTRIBUTE)?.length)) return;
  // A departing player's overflow would land on the ground unattended; keep it saved for login.
  if (core?.World?.getRemovePlayerQueue?.().includes(player)) return;
  settling.add(player);
  try {
    let pending = player.getAttribute(PENDING_ATTRIBUTE) ?? [];
    while (pending.length) {
      const first = pending[0];
      const amount = first.stackable ? first.amount : 1;
      // Keep the existing casket overflow policy: inventory first, remainder
      // owned on the ground. Advance the saved obligation only after delivery.
      player.getInventory().forceAdd(player, new core.Item(first.id, amount));
      pending = first.amount > amount
        ? [{ ...first, amount: first.amount - amount }, ...pending.slice(1)]
        : pending.slice(1);
      player.setAttribute(PENDING_ATTRIBUTE, pending);
    }
    player.getInventory().refreshItems();
  } finally {
    settling.delete(player);
  }
}

function closed(event) {
  if (event.interfaceId === REWARD_INTERFACE) settle(event);
}

module.exports = {
  name: "CasketRewardScreen",
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.persistAttribute(PENDING_ATTRIBUTE, []);
    api.onCustomEvent("interface:closed", closed);
    // A screen open at logout is saved unsettled; login delivers it while the player is present.
    api.onPlayerLogin(settle);
  },
  queue, settle, closed, initialize, PENDING_ATTRIBUTE,
};
