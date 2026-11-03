// Old school bond (13190) trades; any transfer turns it into the untradeable
// variant (13192). The cache already carries both names, examines, options and
// the 1 gp price on the untradeable copy; only the behaviour lives here.
const TRADEABLE_BOND = 13190; // ItemID.OSRS_BOND
const UNTRADEABLE_BOND = 13192; // ItemID.OSRS_BOND_UNTRADEABLE
const BOND_IDS = new Set([TRADEABLE_BOND, UNTRADEABLE_BOND]);
const COINS = 995;
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

// The bond pouch (Account Management > Bond Pouch). Wiki: an account feature holding up to 100
// bonds of either kind. Interfaces and scripts from the cache: 861 bond_main (onLoad 1146),
// 863 bond_management (onLoad 1929), 862 bond_convert (onLoad 1139, a count dialog in 863:24).
const POUCH_ATTRIBUTES = {
  [TRADEABLE_BOND]: "bonds:pouch-tradeable",
  [UNTRADEABLE_BOND]: "bonds:pouch-untradeable",
};
const POUCH_QUANTITY_ATTRIBUTE = "bonds:pouch-quantity";
const POUCH_CAPACITY = 100;
const POUCH_FULL_MESSAGE = "Your bonds pouch is full. Please empty it before buying more.";
const ACCOUNT_INTERFACE = 109;
const BOND_MAIN_INTERFACE = 861;
const BOND_CONVERT_INTERFACE = 862;
const BOND_MANAGEMENT_INTERFACE = 863;
const uid = (group, child) => (group << 16) | child;
const BOND_POUCH_BUTTON = uid(ACCOUNT_INTERFACE, 37); // action "Bond Pouch"
const VIEW_BONDS_BUTTON = uid(BOND_MAIN_INTERFACE, 7); // script 1146: "View Your Bonds"
const BACK_BUTTON = uid(BOND_MANAGEMENT_INTERFACE, 2); // script 1929: "Buy or Redeem Bonds"
const CONVERT_BUTTON = uid(BOND_MANAGEMENT_INTERFACE, 23); // script 1929: "Convert"
const CONVERT_DIALOG_TARGET = uid(BOND_MANAGEMENT_INTERFACE, 24);
// Script 1930 builds a "Move to Inventory" and a "Move to Pouch" button per bond kind.
const MOVE_BUTTONS = new Map([
  [uid(BOND_MANAGEMENT_INTERFACE, 11), { id: TRADEABLE_BOND, toPouch: false }],
  [uid(BOND_MANAGEMENT_INTERFACE, 12), { id: TRADEABLE_BOND, toPouch: true }],
  [uid(BOND_MANAGEMENT_INTERFACE, 14), { id: UNTRADEABLE_BOND, toPouch: false }],
  [uid(BOND_MANAGEMENT_INTERFACE, 15), { id: UNTRADEABLE_BOND, toPouch: true }],
]);
// Script 2420: the 1 / 5 / All / X buttons set varbit 11795 to 0 / 1 / 2 / 3.
const QUANTITY_VARBIT = 11795;
const QUANTITY_BUTTONS = new Map([
  [uid(BOND_MANAGEMENT_INTERFACE, 17), 0],
  [uid(BOND_MANAGEMENT_INTERFACE, 18), 1],
  [uid(BOND_MANAGEMENT_INTERFACE, 19), 3],
  [uid(BOND_MANAGEMENT_INTERFACE, 20), 2],
]);
const QUANTITY_AMOUNTS = [1, 5, Infinity];
const QUANTITY_X = 3;
// Scripts 1277 / 1932 read the account-wide totals (inventory + bank + pouch) from these
// varps and subtract the pouch and inventory to show the bank; 1142 and 1145 read the
// convert fee (263) and the bank's coins (264); inventory 536 is the pouch's contents.
const TRADEABLE_TOTAL_VARP = 261;
const UNTRADEABLE_TOTAL_VARP = 262;
const CONVERT_FEE_VARP = 263;
const BANK_COINS_VARP = 264;
const POUCH_INVENTORY = 536; // InventoryID.BONDS_POUCH
const MAX_INT = 0x7fffffff;

let pluginApi;

function convertFee() {
  // Wiki: 10% of the tradeable bond's Grand Exchange value, paid in coins.
  return Math.max(1, Math.floor(pluginApi.core.ItemDefinition.forId(TRADEABLE_BOND).getGrandExchangeValue() * CONVERT_RATE));
}

function pouchAmount(player, id) {
  return Number(player.getAttribute(POUCH_ATTRIBUTES[id])) || 0;
}

function pouchTotal(player) {
  return pouchAmount(player, TRADEABLE_BOND) + pouchAmount(player, UNTRADEABLE_BOND);
}

// Redeeming draws on the inventory first, then the pouch (the redeem text counts both).
function bondCount(player) {
  const inventory = player.getInventory();
  return inventory.getAmount(TRADEABLE_BOND) + inventory.getAmount(UNTRADEABLE_BOND) + pouchTotal(player);
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
  for (const id of [UNTRADEABLE_BOND, TRADEABLE_BOND]) {
    const take = Math.min(remaining, pouchAmount(player, id));
    if (take > 0) {
      player.setAttribute(POUCH_ATTRIBUTES[id], pouchAmount(player, id) - take);
      remaining -= take;
    }
  }
  inventory.refreshItems();
  sendPouch(player);
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
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "bond-redemption" });
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
  const { player } = event;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "bond", resume: () => redeemBond(event) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
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
  const bank = player.getBank(pluginApi.core.Bank.getTabForItem(player, COINS));
  if (carried + bank.getAmount(COINS) < amount) {
    return false;
  }
  inventory.deleteNumber(COINS, carried);
  bank.deleteNumber(COINS, amount - carried);
  inventory.refreshItems();
  bank.refreshItems();
  return true;
}

/** Pays 10% of the GE value per bond, then turns the untradeable bonds in these inventory slots tradeable. */
function convertSlots(player, slots) {
  const inventory = player.getInventory();
  const fee = convertFee() * slots.length;
  const plural = slots.length === 1 ? "" : "s";
  if (!spendCoins(player, fee)) {
    player.sendMessage(
      `You need ${fee.toLocaleString("en-US")} coins to convert ${plural ? "these bonds" : "this bond"} into ${
        plural ? "tradeable bonds" : "a tradeable bond"
      }.`
    );
    return;
  }
  for (const slot of slots) {
    inventory.setItem(slot, new pluginApi.core.Item(TRADEABLE_BOND));
  }
  inventory.refreshItems();
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "bond-conversion" });
  player.sendMessage(
    `You convert ${plural ? `${slots.length} bonds` : "the bond"} into ${plural ? "tradeable bonds" : "a tradeable bond"} for ${fee.toLocaleString("en-US")} coins.`
  );
  sendPouch(player);
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
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "bond", resume: () => convertBond(event) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
  convertSlots(player, [slot]);
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
      container.setItem(slot, new pluginApi.core.Item(UNTRADEABLE_BOND, amount));
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
    player.sendMessage(`${target.getDisplayName()} does not have enough inventory space.`);
    return;
  }
  player.getInventory().deleteNumber(TRADEABLE_BOND, 1).refreshItems();
  target.getInventory().adds(UNTRADEABLE_BOND, 1);
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "bond-transfer" });
  pluginApi.emitCustomEvent("persistence:save", { player: target, reason: "bond-transfer" });
  player.sendMessage(`You give ${target.getDisplayName()} a bond.`);
  target.sendMessage(`${player.getDisplayName()} gives you a bond.`);
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

const MOVE_BUTTON_IDS = [...MOVE_BUTTONS.keys()];
const QUANTITY_BUTTON_IDS = [...QUANTITY_BUTTONS.keys()];

function bankAmount(player, id) {
  return player.getBank(pluginApi.core.Bank.getTabForItem(player, id)).getAmount(id);
}

/** Sends the totals, fee and pouch contents the cache scripts read to draw the pouch interfaces. */
function sendPouch(player) {
  const inventory = player.getInventory();
  const total = (id) => inventory.getAmount(id) + pouchAmount(player, id) + bankAmount(player, id);
  player
    .getPacketSender()
    .sendConfig(TRADEABLE_TOTAL_VARP, total(TRADEABLE_BOND))
    .sendConfig(UNTRADEABLE_TOTAL_VARP, total(UNTRADEABLE_BOND))
    .sendConfig(CONVERT_FEE_VARP, convertFee())
    .sendConfig(BANK_COINS_VARP, Math.min(MAX_INT, bankAmount(player, COINS)))
    .sendInventory(
      POUCH_INVENTORY,
      2,
      [TRADEABLE_BOND, UNTRADEABLE_BOND].map((id) => (pouchAmount(player, id) > 0 ? { id, amount: pouchAmount(player, id) } : null))
    );
}

function openBondMain({ player }) {
  player.getPacketSender().sendInterface(BOND_MAIN_INTERFACE);
  sendPouch(player);
  return true;
}

function openPouch({ player }) {
  player.getPacketSender().sendInterface(BOND_MANAGEMENT_INTERFACE);
  player.getPacketSender().sendVarbit(QUANTITY_VARBIT, Number(player.getAttribute(POUCH_QUANTITY_ATTRIBUTE)) || 0);
  sendPouch(player);
  return true;
}

function selectQuantity({ player, buttonId }) {
  const quantity = QUANTITY_BUTTONS.get(buttonId);
  player.setAttribute(POUCH_QUANTITY_ATTRIBUTE, quantity);
  player.getPacketSender().sendVarbit(QUANTITY_VARBIT, quantity);
  return true;
}

/** Moves up to `wanted` bonds between the inventory and the pouch, keeping the pouch at its cap. */
function moveBonds(player, id, toPouch, wanted) {
  const inventory = player.getInventory();
  let amount;
  if (toPouch) {
    amount = Math.min(wanted, inventory.getAmount(id), POUCH_CAPACITY - pouchTotal(player));
    if (amount <= 0) {
      if (inventory.getAmount(id) > 0) player.sendMessage(POUCH_FULL_MESSAGE);
      return;
    }
    inventory.deleteNumber(id, amount);
    player.setAttribute(POUCH_ATTRIBUTES[id], pouchAmount(player, id) + amount);
  } else {
    amount = Math.min(wanted, pouchAmount(player, id), inventory.getAddableAmount(new pluginApi.core.Item(id, MAX_INT)));
    if (amount <= 0) {
      if (pouchAmount(player, id) > 0) player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.setAttribute(POUCH_ATTRIBUTES[id], pouchAmount(player, id) - amount);
    inventory.adds(id, amount);
  }
  inventory.refreshItems();
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "bond-pouch" });
  sendPouch(player);
}

function movePouchBonds({ player, buttonId }) {
  const { id, toPouch } = MOVE_BUTTONS.get(buttonId);
  const quantity = Number(player.getAttribute(POUCH_QUANTITY_ATTRIBUTE)) || 0;
  if (quantity === QUANTITY_X) {
    player.setEnteredAmountAction({
      execute: (amount) => {
        if (player.getInterfaceId?.() !== BOND_MANAGEMENT_INTERFACE) return;
        moveBonds(player, id, toPouch, amount);
      },
    });
    player.getPacketSender().sendEnterAmountPrompt(toPouch ? "Move how many bonds to your pouch?" : "Move how many bonds to your inventory?");
    return true;
  }
  moveBonds(player, id, toPouch, QUANTITY_AMOUNTS[quantity]);
  return true;
}

/** The bond's "Deposit" item option: the stack goes into the pouch. */
function depositBond({ player, item }) {
  moveBonds(player, item.getId(), true, item.getAmount());
}

function convertPouchBonds(player, count) {
  const slots = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (slots.length < count && item?.getId?.() === UNTRADEABLE_BOND) slots.push(slot);
  });
  if (slots.length === 0) {
    player.sendMessage("You don't have any untradeable bonds in your inventory.");
    return;
  }
  convertSlots(player, slots);
}

/** "Convert" in the pouch opens the count dialog (862); its Accept sends the count back as an amount. */
function openConvertDialog(event) {
  const { player } = event;
  const pin = { player, feature: "bond", resume: () => openConvertDialog(event) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  sendPouch(player);
  player.getPacketSender().sendSubInterface(CONVERT_DIALOG_TARGET, BOND_CONVERT_INTERFACE, 0);
  player.setEnteredAmountAction({
    acceptsZero: true, // Cancel
    execute: (amount) => {
      // A stale action (the pouch was left without answering) must not turn a later amount entry into a conversion.
      if (player.getInterfaceId?.() !== BOND_MANAGEMENT_INTERFACE) return;
      player.getPacketSender().closeInterface(BOND_CONVERT_INTERFACE);
      if (amount > 0) convertPouchBonds(player, amount);
    },
  });
  return true;
}

module.exports = {
  name: "Bonds",
  register(api) {
    pluginApi = api;
    api.persistAttribute(MEMBERSHIP_ATTRIBUTE);
    api.persistAttribute(POUCH_ATTRIBUTES[TRADEABLE_BOND], 0);
    api.persistAttribute(POUCH_ATTRIBUTES[UNTRADEABLE_BOND], 0);
    api.onItemAction("Old school bond", { Redeem: redeemBond, Deposit: depositBond });
    api.onItemAction("Old school bond (untradeable)", { Redeem: redeemBond, Convert: convertBond, Deposit: depositBond });
    api.onInterfaceActionButton([BOND_POUCH_BUTTON, BACK_BUTTON], openBondMain);
    api.onInterfaceActionButton(VIEW_BONDS_BUTTON, openPouch);
    api.onInterfaceActionButton(MOVE_BUTTON_IDS, movePouchBonds);
    api.onInterfaceActionButton(QUANTITY_BUTTON_IDS, selectQuantity);
    api.onInterfaceActionButton(CONVERT_BUTTON, openConvertDialog);
    api.onItemDropPolicy(protectBondDrop);
    api.onShouldKeepItemOnDeath(keepBondOnDeath);
    api.onItemOnPlayer(donateBond);
    api.onTradeCompleted(convertTradedBonds);
    api.onCustomEvent(GE_OFFER_CONFIRMED, vetoUntradeableSale);
    api.onCustomEvent(GE_OFFER_COLLECTED, convertCollectedBond);
  },
};
