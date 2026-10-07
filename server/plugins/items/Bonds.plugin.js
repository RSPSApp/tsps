const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Old school bond (13190) trades; any transfer turns it into the untradeable
// variant (13192). The cache already carries both names, examines, options and
// the 1 gp price on the untradeable copy; only the behaviour lives here.
const TRADEABLE_BOND = ItemIdentifiers.OLD_SCHOOL_BOND;
const UNTRADEABLE_BOND = ItemIdentifiers.OLD_SCHOOL_BOND_UNTRADEABLE_;
const BOND_IDS = new Set([TRADEABLE_BOND, UNTRADEABLE_BOND]);
const COINS = ItemIdentifiers.COINS;
const MEMBERSHIP_ATTRIBUTE = "bond-membership-expiry";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERT_RATE = 0.1;
// Wiki: 14 days for 1 bond, 29 for 2, 45 for 3, 12 months for 20.
const REDEEM_PACKAGES = [
  { bonds: 1, days: 14 },
  { bonds: 2, days: 29 },
  { bonds: 3, days: 45 },
  { bonds: 20, days: 365 },
];
const GE_OFFER_CONFIRMED = "ge:offer-confirmed";
const GE_OFFER_COLLECTED = "ge:offer-collected";

let pluginApi;

function convertFee() {
  // Wiki: 10% of the tradeable bond's Grand Exchange value, paid in coins.
  return Math.max(1, Math.floor(ItemDefinition.forId(TRADEABLE_BOND).getGrandExchangeValue() * CONVERT_RATE));
}

function bondCount(player) {
  const inventory = player.getInventory();
  return inventory.getAmount(TRADEABLE_BOND) + inventory.getAmount(UNTRADEABLE_BOND);
}

function consumeBonds(player, amount) {
  const inventory = player.getInventory();
  let remaining = amount;
  for (const id of [UNTRADEABLE_BOND, TRADEABLE_BOND]) {
    const take = Math.min(remaining, inventory.getAmount(id));
    if (take > 0) {
      inventory.deleteNumber(id, take);
      remaining -= take;
    }
  }
  inventory.refreshItems();
}

function redeem(player, bonds, days) {
  if (bondCount(player) < bonds) {
    player.sendMessage("You do not have enough bonds.");
    return;
  }
  consumeBonds(player, bonds);
  const now = Date.now();
  const current = Number(player.getAttribute(MEMBERSHIP_ATTRIBUTE)) || 0;
  const expiry = Math.max(now, current) + days * DAY_MS;
  player.setAttribute(MEMBERSHIP_ATTRIBUTE, expiry);
  const total = Math.ceil((expiry - now) / DAY_MS);
  player.sendMessage(
    `You redeem ${bonds} bond${bonds === 1 ? "" : "s"} for ${days} days of membership. You have ${total} days of membership remaining.`
  );
}

function showRedeemOptions(event) {
  const player = event.player;
  const held = bondCount(player);
  const options = [];
  for (const pkg of REDEEM_PACKAGES) {
    if (held < pkg.bonds) continue;
    options.push(
      `${pkg.days} days (${pkg.bonds} bond${pkg.bonds === 1 ? "" : "s"})`,
      () => redeem(player, pkg.bonds, pkg.days)
    );
  }
  options.push("Cancel", () => {});
  pluginApi.sendMultiChatboxPrompt(player, "Redeem your bond", ...options);
}

function redeemBond(event) {
  showRedeemOptions(event);
}

/** Spends `amount` coins from the inventory, then the bank (2025 convert update). */
function spendCoins(player, amount) {
  const inventory = player.getInventory();
  const carried = inventory.getAmount(COINS);
  if (carried >= amount) {
    inventory.deleteNumber(COINS, amount);
    inventory.refreshItems();
    return true;
  }
  const bank = player.getBank(Bank.getTabForItem(player, COINS));
  if (carried + bank.getAmount(COINS) < amount) {
    return false;
  }
  inventory.deleteNumber(COINS, carried);
  bank.deleteNumber(COINS, amount - carried);
  inventory.refreshItems();
  bank.refreshItems();
  return true;
}

function convertBond(event) {
  const { player, item, slot } = event;
  if (!item || item.getId() !== UNTRADEABLE_BOND) {
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId?.() !== UNTRADEABLE_BOND) {
    return;
  }
  const fee = convertFee();
  if (!spendCoins(player, fee)) {
    player.sendMessage(
      `You need ${fee.toLocaleString("en-US")} coins to convert this bond into a tradeable bond.`
    );
    return;
  }
  inventory.setItem(slot, new Item(TRADEABLE_BOND)).refreshItems();
  player.sendMessage(
    `You convert the bond into a tradeable bond for ${fee.toLocaleString("en-US")} coins.`
  );
}

/** Turns up to `count` tradeable bonds in `container` into untradeable ones. */
function convertHeldBonds(container, count) {
  let remaining = count;
  const items = container.getItems();
  for (let slot = 0; slot < items.length && remaining > 0; slot++) {
    const item = items[slot];
    if (item?.getId?.() !== TRADEABLE_BOND) {
      continue;
    }
    const amount = item.getAmount();
    const converted = Math.min(remaining, amount);
    if (converted === amount) {
      container.setItem(slot, new Item(UNTRADEABLE_BOND, amount));
      remaining -= converted;
    }
  }
  container.refreshItems();
}

function protectBondDrop(event) {
  if (!BOND_IDS.has(event.itemId)) {
    return;
  }
  event.player.sendMessage("This object cannot be dropped or destroyed.");
  event.handled = true;
}

function keepBondOnDeath(event) {
  if (BOND_IDS.has(event.item?.getId?.())) {
    event.keep = true;
  }
}

function donateBond(event) {
  const { player, target, item } = event;
  if (!item || !BOND_IDS.has(item.getId())) {
    return;
  }
  // Wiki: an untradeable bond cannot be donated.
  if (item.getId() !== TRADEABLE_BOND) {
    player.sendMessage("You cannot donate an untradeable bond.");
    return;
  }
  if (target.getInventory().getFreeSlots() < 1) {
    player.sendMessage(`${target.getUsername()} does not have enough inventory space.`);
    return;
  }
  player.getInventory().deleteNumber(TRADEABLE_BOND, 1).refreshItems();
  target.getInventory().adds(UNTRADEABLE_BOND, 1);
  player.sendMessage(`You give ${target.getUsername()} a bond.`);
  target.sendMessage(`${player.getUsername()} gives you a bond.`);
  event.handled = true;
}

/** Wiki: a traded bond becomes untradeable for whoever receives it. */
function convertTradedBonds(event) {
  let received = 0;
  for (const item of event.received ?? []) {
    if (item?.getId?.() === TRADEABLE_BOND) {
      received += item.getAmount();
    }
  }
  if (received > 0) {
    convertHeldBonds(event.player.getInventory(), received);
  }
}

/** Grand Exchange: an untradeable bond cannot be listed for sale. */
function vetoUntradeableSale(event) {
  if (!event?.sell || event.itemId !== UNTRADEABLE_BOND) {
    return;
  }
  event.accepted = false;
  event.player.sendMessage("You cannot sell an untradeable bond on the Grand Exchange.");
}

/** Grand Exchange: a bond bought from an offer arrives untradeable. */
function convertCollectedBond(event) {
  if (event?.itemId !== TRADEABLE_BOND || !event.container) {
    return;
  }
  convertHeldBonds(event.container, event.amount);
}

module.exports = {
  name: "Bonds",
  register(api) {
    pluginApi = api;
    api.persistAttribute(MEMBERSHIP_ATTRIBUTE);
    api.onItemAction("Old school bond", { Redeem: redeemBond });
    api.onItemAction("Old school bond (untradeable)", { Redeem: redeemBond, Convert: convertBond });
    api.onItemDropPolicy(protectBondDrop);
    api.onShouldKeepItemOnDeath(keepBondOnDeath);
    api.onItemOnPlayer(donateBond);
    api.onTradeCompleted(convertTradedBonds);
    api.onCustomEvent(GE_OFFER_CONFIRMED, vetoUntradeableSale);
    api.onCustomEvent(GE_OFFER_COLLECTED, convertCollectedBond);
  },
};
