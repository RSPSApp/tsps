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
  let deposited = false;
  inventory.getItems().forEach((item, slot) => {
    if (!item || item.getId() <= 0 || !isRune(item)) return;
    Bank.deposit(player, item.getId(), slot, item.getAmount(), true);
    deposited = true;
  });
  if (!deposited) {
    player.sendMessage("You have no runes to deposit into the pool.");
    return true;
  }
  Shared.animate(player, "human_leverdown_walkmerge");
  player.sendMessage("You deposit all of your runes into the pool.");
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
  attach(api) {
    api.onObjectInteraction("Deposit Pool", { "Deposit-runes": depositRunes, "Deposit-items": depositItems });
    api.onCanBankItem(refuseGameItems);
  },
};
