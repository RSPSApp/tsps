const { ItemContainer } = require("../../src/main/typescript/elvarg/game/model/container/ItemContainer");
const { StackType } = require("../../src/main/typescript/elvarg/game/model/container/StackType");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { PlayerStatus } = require("../../src/main/typescript/elvarg/game/model/PlayerStatus");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");

// OpenRune cache names: interface.ge_pricechecker and interface.ge_pricechecker_side.
const PRICE_CHECKER_INTERFACE_ID = 464;
const PRICE_CHECKER_SIDE_INTERFACE_ID = 238;
const SIDE_MODAL = (161 << 16) | 74; // toplevel_osrs_stretch:sidemodal, as the GE and bank use
const PRICE_CHECKER_CONTAINER_ID = (PRICE_CHECKER_INTERFACE_ID << 16) | 2;
const PRICE_CHECKER_INVENTORY_CONTAINER_ID = (PRICE_CHECKER_SIDE_INTERFACE_ID << 16) | 0;
const OPEN_PRICE_CHECKER_BUTTON = (387 << 16) | 3; // component.wornitems:pricechecker
const PRICE_CHECKER_DEPOSIT_ALL_BUTTON = (PRICE_CHECKER_INTERFACE_ID << 16) | 10; // component.ge_pricechecker:all
const PRICE_CHECKER_OUTPUT = (PRICE_CHECKER_INTERFACE_ID << 16) | 12; // component.ge_pricechecker:output
const PRICE_CHECKER_SLOTS = 28;
const PRICE_CHECKER_INVENTORY_ID = 90; // cache ge_pricechecker inventory
const PRICE_CHECKER_ITEM_FLAGS = 1086; // Op1-5 and Op10, as interface.ge_pricechecker configures.

class PriceCheckerContainer extends ItemContainer {
  constructor(player) {
    super(player, PRICE_CHECKER_SLOTS);
  }

  capacity() {
    return PRICE_CHECKER_SLOTS;
  }

  stackType() {
    return StackType.DEFAULT;
  }

  open() {
    const opening =
      this.player.getStatus?.() !== PlayerStatus.PRICE_CHECKING ||
      this.player.getInterfaceId?.() !== PRICE_CHECKER_INTERFACE_ID;
    this.player.setStatus(PlayerStatus.PRICE_CHECKING);
    this.player.getMovementQueue().reset();
    this.player
      .getPacketSender()
      .sendInterface(PRICE_CHECKER_INTERFACE_ID)
      .sendSubInterface(SIDE_MODAL, PRICE_CHECKER_SIDE_INTERFACE_ID, 3)
      .sendInterfaceScript(149, [PRICE_CHECKER_INVENTORY_CONTAINER_ID, 93, 4, 7, 1, -1,
        "Add", "Add-5", "Add-10", "Add-All", "Add-X"]);
    this.refreshItems();
    if (opening) {
      Sounds.sendSound(this.player, Sound.CONTAINER_OPEN);
    }
    return this;
  }

  refreshItems() {
    const prices = [];
    let total = 0;
    for (const item of this.getItems()) {
      if (!item?.isValid?.()) {
        prices.push(0n);
        continue;
      }
      const value = Math.max(0, Math.min(0x7fffffff, Number(item.getDefinition().getGrandExchangeValue()) || 0));
      prices.push(BigInt(value) * BigInt(item.getAmount()));
      total += value * item.getAmount();
    }
    this.player
      .getPacketSender()
      .sendInterfaceFlagsRange(PRICE_CHECKER_CONTAINER_ID, 0, PRICE_CHECKER_SLOTS - 1, PRICE_CHECKER_ITEM_FLAGS)
      .sendInterfaceFlagsRange(PRICE_CHECKER_INVENTORY_CONTAINER_ID, 0, PRICE_CHECKER_SLOTS - 1, PRICE_CHECKER_ITEM_FLAGS)
      .sendInventory(PRICE_CHECKER_INVENTORY_ID, PRICE_CHECKER_SLOTS,
        this.getItems().map((item) => ({ id: item.getId(), amount: item.getAmount() })))
      .sendInterfaceScript(785, prices)
      .sendString(
        `Total guide price:<br><col=ffffff>${Math.min(total, Number.MAX_SAFE_INTEGER).toLocaleString("en-US")}</col>`,
        PRICE_CHECKER_OUTPUT
      );
    this.player
      .getPacketSender()
      .sendItemContainer(
        this.player.getInventory(),
        PRICE_CHECKER_INVENTORY_CONTAINER_ID
      );
    return this;
  }

  full() {
    this.player.sendMessage("The pricechecker cannot hold any more items.");
    return this;
  }

  depositAll() {
    if (
      this.player.getStatus() == PlayerStatus.PRICE_CHECKING &&
      this.player.getInterfaceId() == PRICE_CHECKER_INTERFACE_ID
    ) {
      let movedAny = false;
      for (const item of this.player.getInventory().getValidItems()) {
        const definition = item.getDefinition();
        if (!item.isSellable() || definition.getGrandExchangeValue() <= 0) {
          continue;
        }
        this.player
          .getInventory()
          .switchItems(this, item.clone(), false, false);
        movedAny = true;
      }
      this.refreshItems();
      this.player.getInventory().refreshItems();
      if (movedAny) {
        Sounds.sendSound(this.player, Sound.DROP_ITEM);
      }
    }
  }

  deposit(id, amount, slot) {
    if (
      this.player.getStatus() == PlayerStatus.PRICE_CHECKING &&
      this.player.getInterfaceId() == PRICE_CHECKER_INTERFACE_ID
    ) {
      if (this.player.getInventory().getItems()[slot].getId() == id) {
        const source = this.player.getInventory().getItems()[slot];
        const item = source.clone().setAmount(Math.min(amount, this.player.getInventory().getAmount(id)));
        if (!item.isSellable()) {
          this.player.sendMessage("That item cannot be pricechecked because it isn't sellable.");
          return true;
        }
        if (item.getDefinition().getGrandExchangeValue() == 0) {
          this.player.sendMessage("There's no point pricechecking that item. It has no value.");
          return true;
        }

        if (item.getAmount() == 1) {
          this.player
            .getInventory()
            .switchItem(this, item, false, slot, true);
        } else {
          this.player.getInventory().switchItems(this, item, false, true);
        }
        Sounds.sendSound(this.player, Sound.DROP_ITEM);
      }
      return true;
    }
    return false;
  }

  withdraw(id, amount, slot) {
    if (
      this.player.getStatus() == PlayerStatus.PRICE_CHECKING &&
      this.player.getInterfaceId() == PRICE_CHECKER_INTERFACE_ID
    ) {
      if (this.items[slot].getId() == id) {
        const item = new Item(id, amount);
        if (item.getAmount() == 1) {
          this.switchItem(this.player.getInventory(), item, false, slot, true);
        } else {
          this.switchItems(this.player.getInventory(), item, false, true);
        }
        Sounds.sendSound(this.player, Sound.PICK_UP_ITEM);
      }
      return true;
    }
    return false;
  }
}

// Closing the price checker (or logging out) hands everything back, like OSRS.
function returnItems({ player, interfaceId }) {
  const priceChecker = player?.__priceCheckerContainer;
  if (interfaceId !== PRICE_CHECKER_INTERFACE_ID || !priceChecker) {
    return;
  }
  for (const item of priceChecker.getValidItems()) {
    priceChecker.switchItems(player.getInventory(), item.clone(), false, false);
  }
  player.getInventory().refreshItems();
}

function getPriceChecker(player) {
  if (!player) {
    return null;
  }
  if (!player.__priceCheckerContainer) {
    player.__priceCheckerContainer = new PriceCheckerContainer(player);
  }
  return player.__priceCheckerContainer;
}

function handlePriceCheckerButton(player, buttonId) {
  switch (buttonId) {
    case OPEN_PRICE_CHECKER_BUTTON:
      if (player.busy?.()) {
        player.getPacketSender().sendInterfaceRemoval();
      }
      getPriceChecker(player)?.open();
      return true;
    case PRICE_CHECKER_DEPOSIT_ALL_BUTTON:
      getPriceChecker(player)?.depositAll();
      return true;
    default:
      return false;
  }
}

// Deposit quantity per right-click option, matching OSRS's Deposit-1/5/10/All/X
// convention. clickType 5 (X) prompts for a custom amount instead of a fixed one.
// This is the same clickType numbering ItemActionPacketListener.handleAction and
// InterfaceActionClickOpcode.handle both use for "which of the 5 right-click
// options was chosen" - see BankDepositBooth.plugin.js for the identical pattern.
const AMOUNT_BY_CLICK_TYPE = { 1: 1, 2: 5, 3: 10, 4: Number.MAX_SAFE_INTEGER };

function handlePriceCheckerDeposit(player, itemId, slot, clickType) {
  if (player?.getInterfaceId?.() !== PRICE_CHECKER_INTERFACE_ID) {
    return false;
  }
  const item = player.getInventory()?.getItems?.()[slot];
  if (!item || item.getId() !== itemId) {
    return false;
  }

  const fixedAmount = AMOUNT_BY_CLICK_TYPE[clickType];
  if (fixedAmount === undefined) {
    player.setEnteredAmountAction({
      execute: (entered) => {
        if (Number.isInteger(entered) && entered > 0) {
          getPriceChecker(player)?.deposit(itemId, entered, slot);
        }
      },
    });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to deposit?");
    return true;
  }

  const amount = Math.min(fixedAmount, player.getInventory().getAmount(itemId));
  if (amount > 0) {
    getPriceChecker(player)?.deposit(itemId, amount, slot);
  }
  return true;
}

function handlePriceCheckerWithdraw(player, itemId, slot, clickType) {
  if (player?.getInterfaceId?.() !== PRICE_CHECKER_INTERFACE_ID) {
    return false;
  }
  const priceChecker = getPriceChecker(player);
  const item = priceChecker?.getItems?.()[slot];
  if (!item || item.getId() !== itemId) {
    return false;
  }

  const fixedAmount = AMOUNT_BY_CLICK_TYPE[clickType];
  if (fixedAmount === undefined) {
    player.setEnteredAmountAction({
      execute: (entered) => {
        if (Number.isInteger(entered) && entered > 0) {
          getPriceChecker(player)?.withdraw(itemId, entered, slot);
        }
      },
    });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to withdraw?");
    return true;
  }

  const amount = Math.min(fixedAmount, priceChecker.getAmount(itemId));
  if (amount > 0) {
    priceChecker.withdraw(itemId, amount, slot);
  }
  return true;
}

module.exports = {
  name: "PriceChecker",
  register(api) {
    api.onCustomEvent("interface:closed", returnItems);
    api.onInterfaceActionButton(
      [OPEN_PRICE_CHECKER_BUTTON, PRICE_CHECKER_DEPOSIT_ALL_BUTTON],
      ({ player, buttonId }) => handlePriceCheckerButton(player, buttonId)
    );

    // Both item panels (238:0 mirrors the inventory slot-for-slot) arrive through
    // the generic interface-action path, not the main inventory's item actions.
    api.onInterfaceActionButton(
      PRICE_CHECKER_INVENTORY_CONTAINER_ID,
      ({ player, action, itemId, slot }) => {
        if (itemId == null || slot == null) {
          return false;
        }
        return handlePriceCheckerDeposit(player, itemId, slot, action);
      }
    );
    api.onInterfaceActionButton(
      PRICE_CHECKER_CONTAINER_ID,
      ({ player, action, itemId, slot }) => {
        if (itemId == null || slot == null) {
          return false;
        }
        return handlePriceCheckerWithdraw(player, itemId, slot, action);
      }
    );
  },
};
