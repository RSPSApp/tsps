/**
 * The Forgotten lockbox (Wiki: Forgotten lockbox): Yama's 1/33 unique, opened from the inventory
 * for one of the Wiki table's rewards. The table and its messages are in data/yama.json.
 */
const Common = require("./Common.Yama");

const LOCKBOX_NAME = "Forgotten lockbox";

/** One entry by its weight out of the table's total (403). */
function rollLockbox() {
  const { entries } = Common.data.lockbox;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** Open: consumes the lockbox and gives its one reward. */
function openLockbox({ player, itemId }) {
  if (itemId !== Common.data.lockbox.item) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(Common.data.lockbox.item)) return true;
  inventory.delete(Common.data.lockbox.item, 1);
  const reward = rollLockbox();
  // forceAdd keeps the whole reward: a stack at MAX_STACK_AMOUNT drops the overflow.
  inventory.forceAdd(player, new Common.core.Item(reward.itemId, reward.amount));
  // Wiki Transcript:Forgotten lockbox: each reward line is an item box ({{tbox}}) with its item.
  const { DialogueChainBuilder, ItemStatementDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, reward.itemId, reward.message)));
  return true;
}

function attachLockbox(api) {
  api.onItemAction(LOCKBOX_NAME, { Open: openLockbox });
}

module.exports = { attachLockbox, rollLockbox, openLockbox };
