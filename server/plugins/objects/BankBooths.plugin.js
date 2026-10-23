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
const BANK_SETTINGS_INTERFACE_ID = 32500;
const BANK_OPEN_DEBOUNCE_MS = 250;
const lastBankOpenAt = new WeakMap();

function isBankTabSelectButton(api, buttonId) {
  if (!Number.isInteger(buttonId) || buttonId < BANK_TAB_SELECT_START) {
    return false;
  }
  const offset = buttonId - BANK_TAB_SELECT_START;
  if (offset % 4 !== 0) {
    return false;
  }
  const bankTab = offset / 4;
  return bankTab >= 0 && bankTab < api.core.Bank.TOTAL_BANK_TABS;
}

function isBankButtonForInterface(api, interfaceId, buttonId) {
  if (interfaceId === BANK_SETTINGS_INTERFACE_ID) {
    return BANK_SETTINGS_BUTTON_IDS.has(buttonId);
  }
  if (interfaceId === api.core.Bank.MAIN_INTERFACE_ID) {
    return (
      BANK_MAIN_BUTTON_IDS.has(buttonId) || isBankTabSelectButton(api, buttonId)
    );
  }
  return false;
}

function openBank(api, player) {
  const { Bank, PlayerStatus } = api.core;
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
    player.setInterfaceId?.(Bank.MAIN_INTERFACE_ID);
    return true;
  }

  player.getBank(player.getCurrentBankTab()).open();
  return true;
}

function handleBankButton(api, player, buttonId) {
  if (!player) {
    return false;
  }
  if (!Number.isInteger(buttonId)) {
    return false;
  }
  const interfaceId = player.getInterfaceId?.();
  if (!isBankButtonForInterface(api, interfaceId, buttonId)) {
    return false;
  }
  return api.core.Bank.handleButton(player, buttonId, 0) === true;
}

function handleBankInterfaceAction(api, player, buttonId, action) {
  if (!player) {
    return false;
  }
  if (!Number.isInteger(buttonId) || !Number.isInteger(action)) {
    return false;
  }
  const interfaceId = player.getInterfaceId?.();
  if (!isBankButtonForInterface(api, interfaceId, buttonId)) {
    return false;
  }
  return api.core.Bank.handleButton(player, buttonId, action) === true;
}

function openBankFromInteraction(api, { player }) {
  return openBank(api, player);
}

function talkToBanker(api, event) {
  const request = { ...event, variant: "standard-dialogue", handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function bankerDialogueAction(api, event) {
  if (event.definition?.getName?.() !== "Banker" || event.action !== "open_interface" || event.target !== "Bank") return;
  event.handled = true;
  // Changing the current dialogue also tells transcript playback not to close the bank.
  event.player.getDialogueManager().reset();
  openBank(api, event.player);
}

function bankButton(api, event) {
  if (handleBankButton(api, event.player, event.buttonId)) event.handled = true;
}

function bankInterfaceAction(api, event) {
  if (handleBankInterfaceAction(api, event.player, event.buttonId, event.action)) event.handled = true;
}

// OSRS Wiki Platinum_token and the official Boss Room Counters & Platinum Tokens
// update: use currency on a banker, booth or chest; exchange as much as fits.
const COINS_PER_TOKEN = 1000;
const MAX_STACK = 0x7fffffff;
const BANK_OBJECT_NAMES = new Set(["Bank booth", "Bank chest", "Bank Chest"]);

function inventorySignature(items) {
  return JSON.stringify(items.map(item => [item.getId(), item.getAmount(), item.getMeta()]));
}

function exchangeItems(api, inventory, itemId, slot) {
  const { COINS, PLATINUM_TOKEN } = api.core.ItemIdentifiers;
  if (itemId !== COINS && itemId !== PLATINUM_TOKEN) return null;
  const items = inventory.getCopiedItems();
  const source = items[slot];
  if (!source || source.getId() !== itemId || source.getMeta() != null) return null;
  const held = source.getAmount();
  if (!Number.isSafeInteger(held) || held <= 0 || held > MAX_STACK) return null;
  const toTokens = itemId === COINS;
  const targetId = toTokens ? PLATINUM_TOKEN : COINS;
  const targetSlot = items.findIndex(item => item.getId() === targetId && item.getMeta() == null);
  const targetAmount = targetSlot < 0 ? 0 : items[targetSlot].getAmount();
  if (!Number.isSafeInteger(targetAmount) || targetAmount < 0 || targetAmount > MAX_STACK) return null;
  const count = Math.min(toTokens ? Math.floor(held / COINS_PER_TOKEN) : held,
    Math.floor((MAX_STACK - targetAmount) / (toTokens ? 1 : COINS_PER_TOKEN)));
  if (count <= 0) return null;
  const remaining = held - count * (toTokens ? COINS_PER_TOKEN : 1);
  const emptySlot = items.findIndex(item => item.getId() <= 0 || item.getAmount() <= 0);
  const destination = targetSlot >= 0 ? targetSlot : remaining === 0 ? slot : emptySlot;
  if (destination < 0) return null;
  items[slot] = remaining ? source.setAmount(remaining) : new api.core.Item(-1, 0);
  items[destination] = new api.core.Item(targetId, targetAmount + count * (toTokens ? 1 : COINS_PER_TOKEN));
  return items;
}

function confirmExchange(api, event, slot) {
  const { player, itemId } = event;
  const inventory = player.getInventory();
  const { COINS, PLATINUM_TOKEN } = api.core.ItemIdentifiers;
  if (itemId !== COINS && itemId !== PLATINUM_TOKEN || !Number.isInteger(slot)
    || inventory.forSlot(slot)?.getId() !== itemId) return;
  event.handled = true;
  const replacement = exchangeItems(api, inventory, itemId, slot);
  if (!replacement) {
    player.sendMessage(itemId === COINS && inventory.getAmount(COINS) < COINS_PER_TOKEN
      ? "You need at least 1,000 coins to exchange for a platinum token."
      : "You don't have room to exchange that currency.");
    return;
  }
  const signature = inventorySignature(inventory.getItems());
  const manager = player.getDialogueManager();
  let consumed = false;
  const dialogue = new api.core.OptionDialogue(0, { executeOption: option => {
    if (consumed || manager.getCurrent() !== dialogue) return;
    if (option !== 1 && option !== 2) return;
    consumed = true;
    player.getPacketSender().sendInterfaceRemoval();
    if (option !== 1 || inventorySignature(inventory.getItems()) !== signature) return;
    // Publish the fully validated inventory in one mutation. Container.add clamps
    // overflowing stacks, so delete/add would silently destroy currency here.
    inventory.setItems(replacement);
    inventory.refreshItems();
  } }, "Yes", "No").setTitle(itemId === COINS
    ? "Exchange your coins for platinum tokens?" : "Exchange your platinum tokens for coins?");
  manager.startDialogues(new api.core.DialogueChainBuilder().add(dialogue));
}

function useCurrencyOnBanker(api, event) {
  if (event.target?.getDefinition?.()?.getName?.() === "Banker") confirmExchange(api, event, event.slot);
}

function useCurrencyOnBankObject(api, event) {
  if (BANK_OBJECT_NAMES.has(event.object?.getDefinition?.()?.getName?.())) confirmExchange(api, event, event.itemSlot);
}

module.exports = {
  name: "BankBooths",
  handleBankButton,
  handleBankInterfaceAction,
  register(api) {
    api.onObjectInteraction("Bank booth", { Bank: openBankFromInteraction.bind(null, api), Use: openBankFromInteraction.bind(null, api) });
    api.onObjectInteraction("Bank chest", { Use: openBankFromInteraction.bind(null, api) });
    api.onObjectInteraction("Bank Chest", { Use: openBankFromInteraction.bind(null, api) });
    api.onNpcInteraction("Banker", { "Talk-to": talkToBanker.bind(null, api), Bank: openBankFromInteraction.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", bankerDialogueAction.bind(null, api));
    api.onItemOnNpc(useCurrencyOnBanker.bind(null, api), { noted: false });
    api.onItemOnObject(useCurrencyOnBankObject.bind(null, api), { noted: false });
    api.onButtonClick(bankButton.bind(null, api));
    api.onInterfaceActionClick(bankInterfaceAction.bind(null, api));
  },
};
