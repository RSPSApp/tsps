const { ItemContainer } = require("../../src/main/typescript/elvarg/game/model/container/ItemContainer");
const { StackType } = require("../../src/main/typescript/elvarg/game/model/container/StackType");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { PlayerStatus } = require("../../src/main/typescript/elvarg/game/model/PlayerStatus");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

// OpenRune cache names: interface.ge_pricechecker and interface.ge_pricechecker_side.
const PRICE_CHECKER_INTERFACE_ID = 464;
const PRICE_CHECKER_SIDE_INTERFACE_ID = 238;
const PRICE_CHECKER_CONTAINER_ID = (PRICE_CHECKER_INTERFACE_ID << 16) | 2;
const PRICE_CHECKER_INVENTORY_CONTAINER_ID = (PRICE_CHECKER_SIDE_INTERFACE_ID << 16) | 0;
const OPEN_PRICE_CHECKER_BUTTON = (387 << 16) | 3; // component.wornitems:pricechecker
const PRICE_CHECKER_DEPOSIT_ALL_BUTTON = (PRICE_CHECKER_INTERFACE_ID << 16) | 10; // component.ge_pricechecker:all
const PRICE_CHECKER_OUTPUT = (PRICE_CHECKER_INTERFACE_ID << 16) | 12; // component.ge_pricechecker:output
const PRICE_CHECKER_SLOTS = 28;
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
        prices.push(0);
        continue;
      }
      const value = Math.max(0, Math.min(0x7fffffff, Number(item.getDefinition().getValue()) || 0));
      prices.push(value);
      total += value * item.getAmount();
    }
    this.player
      .getPacketSender()
      .sendInterfaceSet(PRICE_CHECKER_INTERFACE_ID, PRICE_CHECKER_SIDE_INTERFACE_ID)
      .sendInterfaceFlagsRange(PRICE_CHECKER_CONTAINER_ID, 0, PRICE_CHECKER_SLOTS - 1, PRICE_CHECKER_ITEM_FLAGS)
      .sendInterfaceFlagsRange(PRICE_CHECKER_INVENTORY_CONTAINER_ID, 0, PRICE_CHECKER_SLOTS - 1, PRICE_CHECKER_ITEM_FLAGS)
      .sendInterfaceScript(785, prices)
      .sendString(
        `Total guide price:<br><col=ffffff>${Misc.insertCommasToNumber(Math.min(total, Number.MAX_SAFE_INTEGER))}</col>`,
        PRICE_CHECKER_OUTPUT
      );
    this.player
      .getPacketSender()
      .sendItemContainer(this, PRICE_CHECKER_CONTAINER_ID);
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
        if (!item.isSellable() || definition.getValue() <= 0) {
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
        const item = this.player.getInventory().getItems()[slot].clone().setAmount(amount);
        if (!item.isSellable()) {
          this.player.sendMessage("That item cannot be pricechecked because it isn't sellable.");
          return true;
        }
        if (item.getDefinition().getValue() == 0) {
          this.player.sendMessage("There's no point pricechecking that item. It has no value.");
          return true;
        }

        if (item.getAmount() == 1) {
          this.player
            .getInventory()
            .switchItem(this, item, false, slot, true);
        } else {
          this.switchItems(this, item, false, true);
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

  const amount = Math.min(fixedAmount, item.getAmount());
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

  const amount = Math.min(fixedAmount, item.getAmount());
  if (amount > 0) {
    priceChecker.withdraw(itemId, amount, slot);
  }
  return true;
}

module.exports = {
  name: "PriceChecker",
  register(api) {
    api.onInterfaceActionButton(
      [OPEN_PRICE_CHECKER_BUTTON, PRICE_CHECKER_DEPOSIT_ALL_BUTTON],
      ({ player, buttonId }) => handlePriceCheckerButton(player, buttonId)
    );

    // Clicking an item in the price checker's own inventory-mirror panel
    // (widget PRICE_CHECKER_INVENTORY_CONTAINER_ID) always matches the
    // player's real inventory slot-for-slot, so the live widget_action
    // dispatch (NetworkBuilder.ts) routes it through the same inventory
    // item-click path as any other inventory click.
    api.onItemAction((event) => {
      if (event.interfaceId !== PRICE_CHECKER_INVENTORY_CONTAINER_ID) {
        return;
      }
      if (handlePriceCheckerDeposit(event.player, event.itemId, event.slot, event.clickType)) {
        event.handled = true;
      }
    });

    // The price checker's own container never matches a real inventory slot,
    // so those clicks fall through to the generic interface-action path instead.
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
