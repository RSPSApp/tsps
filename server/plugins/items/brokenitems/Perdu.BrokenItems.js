"use strict";

/**
 * Perdu repairs, locks and unlocks the items in data/broken-items.json when they are used on
 * him (Wiki: Perdu, Transcript:Perdu, (l); docs/broken-items.md). He takes coins carried, or
 * from the bank ("You can pay me with cash you're carrying, or I can take payments from your
 * bank").
 *
 * Captured (rsprox, rev 224-232, before the Trouver rework): the lock and unlock lines, their
 * menus, the box when he unlocks, and that a lock swaps the item with no message. Not captured:
 * a repair. Its menu follows the one Bob's repairs show ("Repair that item: 51 coins.").
 */
const Common = require("./Common.BrokenItems");

const PERDU = "Perdu";

const LINE = {
  LOCK_NEEDS_PARCHMENT: "I can lock that item so that it won't vanish if you die in deep Wilderness, but I'll need a Trouver parchment.",
  LOCK_OFFER: (cost) => `I can lock that item so that it won't vanish if you die in deep Wilderness. It'll cost you ${Common.formatCoins(cost)} coins and a Trouver parchment.`,
  FEROX: "You'll find her in Ferox Enclave, where people play a game called Last Man Standing. Bring the parchment here, then show me the item again.",
  LOCKED: (refund) => `I've locked that item to you so that it won't vanish if you're killed in deep Wilderness. I can unlock it again, returning your parchment and ${Common.formatCoins(refund)} coins.`,
  PARCHMENT: "If you want me to lock an item to you so that it won't vanish if you're killed in deep Wilderness, show me the item.",
  NO_LOCK_NEEDED: "You don't need me to lock that item, it won't vanish if you die in deep Wilderness.",
  COINS: "I can see you have some money. Weird flex, but okay.",
  CANT_HELP: "I can't help you with that item - it's not the kind of thing I could lock or repair, if you were hoping for me to do that sort of thing.",
};
const BOX = {
  FEROX: "Perdu tells you about a merchant in Ferox Enclave who sells special scrolls called Trouver Parchments.",
  UNLOCKED: "Perdu unlocks your item and returns the parchment and some money.",
};
/** Ours (not captured). */
const MESSAGE = {
  NO_COINS: "You don't have enough coins to pay for that.",
  NO_SPACE: "You don't have enough inventory space.",
};
/** Perdu's chathead animations for each line (rsprox). */
const EXPRESSION = {
  LOCK_NEEDS_PARCHMENT: "chatsad2",
  LOCK_OFFER: "chatquiz3",
  FEROX: "chathap3",
  LOCKED: "chathap3",
  PARCHMENT: "chathap3",
  CANT_HELP: "chatsad3",
};

function core() {
  return Common.getCore();
}

function coinsId() {
  return core().ItemIdentifiers.COINS;
}

function expression(name) {
  return name ? core().CacheDefinitions.getSeqId(name) ?? undefined : undefined;
}

function npcLine(index, npcId, text, animation) {
  return new (core().NpcDialogue)(index, npcId, text, PERDU, expression(animation));
}

/** Perdu's lines in order, then `prompt` (a menu) if given. */
function talk(player, npcId, lines, prompt) {
  const builder = new (core().DialogueChainBuilder)();
  lines.forEach((line, index) => {
    builder.add(line.box != null
      ? new (core().ItemStatementDialogue)(index, line.box, line.text)
      : npcLine(index, npcId, line.text, line.expression));
  });
  if (prompt) builder.add(new (core().ActionDialogue)(lines.length, { execute: prompt }));
  player.getDialogueManager().startDialogues(builder);
}

function bankWithCoins(player) {
  const tab = core().Bank.getTabForItem(player, coinsId());
  return tab == null || tab < 0 ? null : player.getBank(tab);
}

/** Takes `fee` coins from the inventory, or else the bank. False, and nothing taken, when neither covers it. */
function pay(player, fee) {
  if (fee <= 0) return true;
  const inventory = player.getInventory();
  if (inventory.getAmount(coinsId()) >= fee) {
    inventory.deleteNumber(coinsId(), fee);
    return true;
  }
  const bank = bankWithCoins(player);
  if (bank && bank.getAmount(coinsId()) >= fee) {
    bank.deleteNumber(coinsId(), fee);
    bank.refreshItems();
    return true;
  }
  return false;
}

function canPay(player, fee) {
  if (player.getInventory().getAmount(coinsId()) >= fee) return true;
  return (bankWithCoins(player)?.getAmount(coinsId()) ?? 0) >= fee;
}

/** The inventory slot holding `itemId`: `slot` while it still does, else the first one. -1 if none. */
function slotOf(player, itemId, slot) {
  const items = player.getInventory().getItems();
  if (items[slot]?.getId() === itemId) return slot;
  return items.findIndex((item) => item?.getId() === itemId);
}

/** Turns the item in `slot` into `newId` where it lies, keeping its charges and other metadata. */
function swap(player, slot, newId) {
  player.getInventory().getItems()[slot].setId(newId);
}

/** Every inventory slot whose item `test` accepts, as { slot, id }. */
function slotsWhere(player, test) {
  const found = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (item && item.getId() > 0 && test(item.getId())) found.push({ slot, id: item.getId() });
  });
  return found;
}

// ------------------------------------------------------------------ repair

function repairSlot(player, { slot, id }) {
  const at = slotOf(player, id, slot);
  if (at < 0) return false;
  if (!pay(player, Common.repairFee(id))) {
    player.sendMessage(MESSAGE.NO_COINS);
    return false;
  }
  swap(player, at, Common.lookup(id).form.repairsTo);
  return true;
}

function repairAll(player) {
  for (const target of slotsWhere(player, (id) => Common.repairFee(id) > 0)) {
    if (!repairSlot(player, target)) break;
  }
  player.getInventory().refreshItems();
}

function offerRepair(player, slot, itemId) {
  const all = slotsWhere(player, (id) => Common.repairFee(id) > 0);
  const total = all.reduce((sum, { id }) => sum + Common.repairFee(id), 0);
  const repairOne = () => {
    repairSlot(player, { slot, id: itemId });
    player.getInventory().refreshItems();
  };
  const options = [`Repair that item: ${Common.formatCoins(Common.repairFee(itemId))} coins.`, repairOne];
  if (all.length > 1) options.push(`Repair all items: ${Common.formatCoins(total)} coins.`, () => repairAll(player));
  options.push("Cancel.", () => {});
  Common.getApi().sendMultiChatboxPrompt(player, "What would you like to do?", ...options);
}

// ------------------------------------------------------------------ lock and unlock

function parchmentId() {
  return Common.idOf(Common.TROUVER_PARCHMENT);
}

function isLockable(id) {
  const found = Common.lookup(id);
  return found?.form.kind === "unlocked" && found.form.lockedId != null;
}

function lockSlot(player, { slot, id }) {
  const at = slotOf(player, id, slot);
  const inventory = player.getInventory();
  if (at < 0 || !inventory.contains(parchmentId())) return false;
  if (!pay(player, Common.DATA.lockCost)) {
    player.sendMessage(MESSAGE.NO_COINS);
    return false;
  }
  inventory.deleteNumber(parchmentId(), 1);
  swap(player, at, Common.lookup(id).form.lockedId);
  return true;
}

function lockAll(player) {
  for (const target of slotsWhere(player, isLockable)) {
    if (!lockSlot(player, target)) break;
  }
  player.getInventory().refreshItems();
}

function offerLock(player, npcId, slot, itemId) {
  if (!player.getInventory().contains(parchmentId())) {
    talk(player, npcId, [
      { text: LINE.LOCK_NEEDS_PARCHMENT, expression: EXPRESSION.LOCK_NEEDS_PARCHMENT },
      { box: parchmentId(), text: BOX.FEROX },
      { text: LINE.FEROX, expression: EXPRESSION.FEROX },
    ]);
    return;
  }
  const lockOne = () => {
    lockSlot(player, { slot, id: itemId });
    player.getInventory().refreshItems();
  };
  const options = [`Lock item (${Common.itemName(itemId)})`, lockOne];
  if (slotsWhere(player, isLockable).length > 1) options.push("Lock all available items", () => lockAll(player));
  options.push("Cancel", () => {});
  talk(player, npcId, [{ text: LINE.LOCK_OFFER(Common.DATA.lockCost), expression: EXPRESSION.LOCK_OFFER }],
    () => Common.getApi().sendMultiChatboxPrompt(player, "Select an option", ...options));
}

function unlock(player, slot, itemId) {
  const at = slotOf(player, itemId, slot);
  if (at < 0) return;
  const inventory = player.getInventory();
  const needed = 1 + (inventory.contains(coinsId()) ? 0 : 1);
  if (inventory.getFreeSlots() < needed) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return;
  }
  const unlockedId = Common.lookup(itemId).form.unlockedId;
  swap(player, at, unlockedId);
  inventory.adds(parchmentId(), 1);
  inventory.adds(coinsId(), Common.DATA.unlockRefund);
  inventory.refreshItems();
  player.getDialogueManager().startDialogues(new (core().DialogueChainBuilder)()
    .add(new (core().DoubleItemStatementDialogue)(0, unlockedId, parchmentId(), BOX.UNLOCKED)));
}

function offerUnlock(player, npcId, slot, itemId) {
  talk(player, npcId, [{ text: LINE.LOCKED(Common.DATA.unlockRefund), expression: EXPRESSION.LOCKED }],
    () => Common.getApi().sendMultiChatboxPrompt(player, `${Common.itemName(itemId)}: Unlock it?`,
      "Yes", () => unlock(player, slot, itemId),
      "No", () => {}));
}

// ------------------------------------------------------------------ using an item on Perdu

function useOnPerdu(event) {
  const { player, target, npcId, slot, itemId } = event;
  // The spawned Perdu is a multinpc: his name is on the variant the player sees.
  if (target?.getCurrentDefinition?.(player)?.getName?.() !== PERDU) return;
  event.handled = true;
  const found = Common.lookup(itemId);
  const kind = found?.form.kind;
  if (kind === "broken" || kind === "mangled") {
    offerRepair(player, slot, itemId);
  } else if (kind === "locked") {
    offerUnlock(player, npcId, slot, itemId);
  } else if (isLockable(itemId)) {
    offerLock(player, npcId, slot, itemId);
  } else if (kind === "unlocked") {
    talk(player, npcId, [{ text: LINE.NO_LOCK_NEEDED }]);
  } else if (itemId === parchmentId()) {
    talk(player, npcId, [{ text: LINE.PARCHMENT, expression: EXPRESSION.PARCHMENT }]);
  } else if (itemId === coinsId()) {
    talk(player, npcId, [{ text: LINE.COINS }]);
  } else {
    talk(player, npcId, [{ text: LINE.CANT_HELP, expression: EXPRESSION.CANT_HELP }]);
  }
}

function attach(api) {
  api.onItemOnNpc(useOnPerdu, { noted: false });
}

module.exports = attach;
module.exports._test = { useOnPerdu, pay, offerRepair, repairAll, lockSlot, lockAll, unlock };
