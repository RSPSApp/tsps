const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { PlayerStatus } = require("../../src/main/typescript/elvarg/game/model/PlayerStatus");

const BANK_SETTINGS_BUTTON_IDS = new Set([32503, 32512, 32513]);
const BANK_MAIN_BUTTON_IDS = new Set([
  50013,
  5386,
  5387,
  8130,
  8131,
  50004,
  50007,
  5384,
  50001,
  50010,
]);
const BANK_TAB_SELECT_START = 50070;
const REGULAR_BANK_INTERFACE_ID = Bank.MAIN_INTERFACE_ID;
const BANK_SETTINGS_INTERFACE_ID = 32500;
const BANK_OPEN_DEBOUNCE_MS = 250;
const lastBankOpenAt = new WeakMap();

function isBankTabSelectButton(buttonId) {
  if (!Number.isInteger(buttonId) || buttonId < BANK_TAB_SELECT_START) {
    return false;
  }
  const offset = buttonId - BANK_TAB_SELECT_START;
  if (offset % 4 !== 0) {
    return false;
  }
  const bankTab = offset / 4;
  return bankTab >= 0 && bankTab < Bank.TOTAL_BANK_TABS;
}

function isBankButtonForInterface(interfaceId, buttonId) {
  if (interfaceId === BANK_SETTINGS_INTERFACE_ID) {
    return BANK_SETTINGS_BUTTON_IDS.has(buttonId);
  }
  if (interfaceId === REGULAR_BANK_INTERFACE_ID) {
    return (
      BANK_MAIN_BUTTON_IDS.has(buttonId) || isBankTabSelectButton(buttonId)
    );
  }
  return false;
}

function openBank(player) {
  if (!player) {
    return false;
  }
  const now = Date.now();
  const lastOpenAt = lastBankOpenAt.get(player) ?? 0;
  if (now - lastOpenAt < BANK_OPEN_DEBOUNCE_MS) {
    return true;
  }
  lastBankOpenAt.set(player, now);

  if (
    Bank.isOpen(player)
  ) {
    return true;
  }

  if (player.isPlayerBot?.() === true) {
    // Bots do not need full interface/container refresh work just to use bank
    // operations. They only need banking state + interface marker.
    player.setStatus?.(PlayerStatus.BANKING);
    player.setEnteredSyntaxAction?.(null);
    player.setInterfaceId?.(REGULAR_BANK_INTERFACE_ID);
    return true;
  }

  player.getBank(player.getCurrentBankTab()).open();
  return true;
}

function handleBankButton(player, buttonId) {
  if (!player) {
    return false;
  }
  if (!Number.isInteger(buttonId)) {
    return false;
  }
  const interfaceId = player.getInterfaceId?.();
  if (!isBankButtonForInterface(interfaceId, buttonId)) {
    return false;
  }
  return Bank.handleButton(player, buttonId, 0) === true;
}

function handleBankInterfaceAction(player, buttonId, action) {
  if (!player) {
    return false;
  }
  if (!Number.isInteger(buttonId) || !Number.isInteger(action)) {
    return false;
  }
  const interfaceId = player.getInterfaceId?.();
  if (!isBankButtonForInterface(interfaceId, buttonId)) {
    return false;
  }
  return Bank.handleButton(player, buttonId, action) === true;
}

function openBankFromNpc({ player }) {
  return openBank(player);
}

module.exports = {
  name: "BankBooths",
  handleBankButton,
  handleBankInterfaceAction,
  register(api) {
    api.onObjectInteraction("Bank booth", {
      "Bank": ({ player }) => openBank(player),
      // Some booths (e.g. Tutorial Island 10083) only offer "Use".
      "Use": ({ player }) => openBank(player),
    });
    api.onObjectInteraction("Bank chest", {
      "Use": ({ player }) => openBank(player),
    });

    api.onNpcInteraction("Banker", {
      "Talk-to": openBankFromNpc,
      "Bank": openBankFromNpc,
    });

    api.onButtonClick((event) => {
      if (handleBankButton(event.player, event.buttonId)) {
        event.handled = true;
      }
    });

    api.onInterfaceActionClick((event) => {
      if (handleBankInterfaceAction(event.player, event.buttonId, event.action)) {
        event.handled = true;
      }
    });
  },
};
