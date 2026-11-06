"use strict";

/**
 * Death fees.
 *
 * A grave (the client's gravestone_generic_window_set works out the same bands): items worth
 * less than 100,000 coins are free; the rest cost 1,000, 10,000 or 100,000 coins each, by value
 * band (under 1m, under 10m, 10m and up), 500,000 at most in all. Ironmen pay half.
 *
 * Death's Office (Wiki: Death's Office): 5% of the value of each item worth 100,000 or more,
 * nothing for the rest; ironmen pay half.
 *
 * Paying (Wiki: Death's Coffer; Death: "Cash is always acceptable. Also, a gravestone can take it
 * directly from your bank"): the Coffer first, then the coins carried, then the bank.
 */
const Common = require("./Common.Gravestones");
const Storage = require("./Storage.Gravestones");

const FREE_UNDER = 100000;
const BANDS = [
  { from: 10000000, fee: 100000 },
  { from: 1000000, fee: 10000 },
  { from: FREE_UNDER, fee: 1000 },
];
const FEE_CAP = 500000;
const OFFICE_PERCENT = 5;

function discount(fee, iron) {
  return iron ? Math.floor(fee / 2) : fee;
}

/** The existing GE buy quote for tradeable items; preserve cache value for the rest. */
function feeValue(id) {
  const definition = Common.definition(id);
  return definition.isTradeable() && definition.hasGrandExchangeValue()
    ? Math.max(0, definition.getGrandExchangeValue()) : Common.value(id);
}

function isPaid(id) {
  return feeValue(id) >= FREE_UNDER;
}

function graveFee(records, iron) {
  let total = 0;
  for (const { id, amount } of records) {
    const band = BANDS.find(({ from }) => feeValue(id) >= from);
    if (band) total += discount(band.fee * amount, iron);
  }
  return Math.min(total, discount(FEE_CAP, iron));
}

/**
 * The gravestone_feethreshold_* varbit for `threshold`: one past the first slot worth less, or 0
 * when none is. The client counts the slots before it as the pricier band.
 */
function threshold(records, under) {
  const index = records.findIndex(({ id }) => feeValue(id) < under);
  return index < 0 ? 0 : index + 1;
}

function sendThresholds(player, records) {
  Common.setVarbit(player, "under100k", threshold(records, FREE_UNDER));
  Common.setVarbit(player, "under1m", threshold(records, 1000000));
  Common.setVarbit(player, "under10m", threshold(records, 10000000));
}

function officeFee(id, iron) {
  const worth = feeValue(id);
  if (worth < FREE_UNDER) return 0;
  return discount(Math.floor((worth * OFFICE_PERCENT) / 100), iron);
}

function bankTabWithCoins(player) {
  const { Bank } = Common.core();
  const tab = Bank.getTabForItem(player, Common.COINS);
  return tab == null || tab < 0 ? null : player.getBank(tab);
}

/**
 * Takes `fee` coins from one source that covers it: "coffer", "inventory" or "bank". Null, and
 * nothing taken, when none does. UNVERIFIED: whether live combines sources when none covers the
 * fee alone (the Wiki names them one at a time).
 */
function pay(player, fee) {
  if (fee <= 0) return "free";
  const coffer = Storage.coffer(player);
  if (coffer >= fee) {
    Storage.setCoffer(player, coffer - fee);
    return "coffer";
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(Common.COINS) >= fee) {
    inventory.deleteNumber(Common.COINS, fee);
    inventory.refreshItems();
    return "inventory";
  }
  const bank = bankTabWithCoins(player);
  if (bank && bank.getAmount(Common.COINS) >= fee) {
    bank.deleteNumber(Common.COINS, fee);
    bank.refreshItems();
    return "bank";
  }
  return null;
}

const SOURCE_TEXT = { coffer: "Death's Coffer", inventory: "your inventory", bank: "your bank" };

/**
 * "Payment has been taken from your bank: 1,000 x Coins" (a grave) and "...: 5,227 coins" (the
 * office), from live. UNVERIFIED: the Coffer and inventory wordings, the bank one reworded.
 */
function paymentMessage(source, fee, office = false) {
  const amount = Common.formatCoins(fee);
  return `Payment has been taken from ${SOURCE_TEXT[source]}: ${amount}${office ? " coins" : " x Coins"}`;
}

module.exports = { FREE_UNDER, feeValue, isPaid, graveFee, threshold, sendThresholds, officeFee, pay, paymentMessage };
