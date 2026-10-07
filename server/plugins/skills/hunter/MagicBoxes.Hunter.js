"use strict";

const { H, exchange } = require("./Context.Hunter");

function use(event) {
  const I = H.core.ItemIdentifiers, pair = [event.usedItemId, event.usedWithItemId];
  const box = pair.find(id => [I.IMP_IN_A_BOX_2_, I.IMP_IN_A_BOX_1_].includes(id));
  if (!box) return;
  event.handled = true;
  const { player } = event, itemId = pair[0] === box ? pair[1] : pair[0];
  if ([I.MAGIC_BOX, I.IMP_IN_A_BOX_2_, I.IMP_IN_A_BOX_1_].includes(itemId)) { player.sendMessage("The imp refuses to bank that."); return; }
  if (player.getWildernessLevel() > 30) { player.sendMessage("The imp refuses to bank from this deep in the Wilderness."); return; }
  const slot = player.getInventory().getItems().findIndex(item => item?.getId() === itemId);
  if (slot < 0 || !player.getInventory().contains(box)) return;
  const next = box === I.IMP_IN_A_BOX_2_ ? I.IMP_IN_A_BOX_1_ : I.MAGIC_BOX;
  if (!exchange(player, [[box, 1]], [[next, 1]], false)) return;
  const before = player.getInventory().getAmount(itemId);
  H.core.Bank.deposit(player, itemId, slot, player.getInventory().get(slot).getAmount(), true);
  if (player.getInventory().getAmount(itemId) >= before) return;
  exchange(player, [[box, 1]], [[next, 1]]);
  player.sendMessage(next === I.MAGIC_BOX ? "The imp banks your item and escapes." : "The imp banks your item. It will deliver one more item or stack.");
}

function explain({ player }) {
  player.sendMessage("Use an imp-in-a-box on an inventory item to send that item or stack to your bank.");
  return true;
}

function release({ player, itemId }) {
  const I = H.core.ItemIdentifiers;
  if (![I.IMP_IN_A_BOX_2_, I.IMP_IN_A_BOX_1_].includes(itemId)) return false;
  if (exchange(player, [[itemId, 1]], [[I.MAGIC_BOX, 1]])) player.sendMessage("You release the imp.");
  return true;
}

module.exports = { use, explain, release };
