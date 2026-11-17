"use strict";

/**
 * The Deposit Pool, and the game's items that can't be banked.
 *
 * rsprox captures (rev 241):
 * - Deposit-runes: human_leverdown_walkmerge and every rune goes to the bank, "You deposit all of
 *   your runes into the pool."; with none, "You have no runes to deposit into the pool."
 * - Deposit-items opens the deposit box (bank_depositbox); the game's items are refused there and
 *   at the Bank Chest: "A magical force prevents you from banking this item!"
 */

const Shared = require("./Shared.GuardiansOfTheRift");

const RUNE_NAME = /^[A-Z][a-z]+ rune$/;
let gameItemIds = null;

function isRune(item) {
  const definition = Shared.core().ItemDefinition.forId(item.getId());
  return Boolean(definition?.isStackable?.()) && RUNE_NAME.test(definition?.getName?.() ?? "");
}

function depositRunes({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_depositchest")) return false;
  const { Bank } = Shared.core();
  const inventory = player.getInventory();
  const runes = inventory.getItems().filter((item) => item && item.getId() > 0 && isRune(item));
  if (runes.length === 0) {
    player.sendMessage("You have no runes to deposit into the pool.");
    return true;
  }
  // The pool banks the runes, so it asks the bank's own vetoes first (an Ultimate Ironman can't bank: Wiki), as the
  // deposit box, leprechaun and imp box do; the veto says why.
  if (Shared.api().emitCanBank?.(player, "guardians-of-the-rift-pool") === false) return true;
  let deposited = false;
  let fullBank = null;
  inventory.getItems().forEach((item, slot) => {
    if (!item || item.getId() <= 0 || !isRune(item)) return;
    // A rune the bank has no room for stays put without a message each: the bank's full line is sent once below.
    const bank = player.getBank(Bank.getTabForItem(player, item.getId()));
    if (!bank.canTake(item)) {
      fullBank ??= bank;
      return;
    }
    const before = item.getAmount();
    Bank.deposit(player, item.getId(), slot, before, true);
    if ((inventory.getItems()[slot]?.getId() === item.getId() ? inventory.getItems()[slot].getAmount() : 0) < before) deposited = true;
  });
  fullBank?.full();
  if (deposited) Shared.animate(player, "human_leverdown_walkmerge");
  // The pool only claims every rune when none stayed behind; otherwise the bank has said why.
  if (deposited && !inventory.getItems().some((item) => item && item.getId() > 0 && isRune(item))) {
    player.sendMessage("You deposit all of your runes into the pool.");
  }
  return true;
}

function depositItems({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_depositchest")) return false;
  Shared.api().emitCustomEvent("bank:open-deposit-box", { player });
  return true;
}

function isGameItem(itemId) {
  gameItemIds ??= new Set(Shared.GAME_ITEMS.map(Shared.obj));
  return gameItemIds.has(itemId);
}

function refuseGameItems(event) {
  if (!isGameItem(event.item?.getId?.())) return;
  event.allow = false;
  event.player.sendMessage("A magical force prevents you from banking this item!");
}

module.exports = {
  _test: { depositRunes },
  attach(api) {
    api.onObjectInteraction("Deposit Pool", { "Deposit-runes": depositRunes, "Deposit-items": depositItems });
    api.onCanBankItem(refuseGameItems);
  },
};
