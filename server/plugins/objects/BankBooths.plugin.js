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
const BANK_OPEN_DEBOUNCE_TICKS = 1;
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
  const { Bank, PlayerStatus, World } = api.core;
  if (!player) {
    return false;
  }
  const now = World.getProcessCycle();
  const lastOpenAt = lastBankOpenAt.get(player) ?? -Infinity;
  if (now - lastOpenAt < BANK_OPEN_DEBOUNCE_TICKS) {
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
  if ((event.definition ?? event.target?.getDefinition?.())?.getName?.() !== "Banker") return;
  const { COINS, PLATINUM_TOKEN } = api.core.ItemIdentifiers;
  if (event.itemId === COINS || event.itemId === PLATINUM_TOKEN) {
    confirmExchange(api, event, event.slot);
    return;
  }
  // rsprox_transcripts/226/01645.txt (tick 4882, a Mort myre pear): any other unnoted item gets the banker's line.
  event.handled = true;
  const { DialogueChainBuilder, NpcDialogue } = api.core;
  const npcId = event.npcId ?? event.target?.getId?.();
  event.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, npcId, "Hand me a banknote, and I'll try to convert it to an item.", "Banker")));
}

/** How many of the notes in `slot` the inventory can take unnoted: the free slots, and the note's own once it empties. */
function unnoteCount(inventory, slot) {
  const held = inventory.forSlot(slot)?.getAmount() ?? 0;
  const free = inventory.getFreeSlots();
  return held <= free + 1 ? held : free;
}

/**
 * A banknote used on a banker (rsprox_transcripts/226/01645.txt): "Un-note the banknotes?" Yes/No, then as many as
 * the inventory can take come back unnoted with "The bank exchanges your banknotes for items." ("your banknote for
 * an item." for one). With no room, the banker says "You don't have any inventory space." and asks nothing.
 */
function unnoteOnBanker(api, event) {
  const { player, itemId } = event;
  if ((event.definition ?? event.target?.getDefinition?.())?.getName?.() !== "Banker") return;
  const { ItemDefinition, CacheDefinitions, DialogueChainBuilder, NpcDialogue, ItemStatementDialogue } = api.core;
  const definition = ItemDefinition.forId(itemId);
  const slot = event.slot;
  const inventory = player.getInventory();
  if (!definition?.isNoted?.() || !Number.isInteger(slot) || inventory.forSlot(slot)?.getId() !== itemId) return;
  event.handled = true;
  const unnoted = definition.unNote();
  const npcId = event.npcId ?? event.target?.getId?.() ?? CacheDefinitions.getNpcId("banker1_new");
  if (unnoteCount(inventory, slot) <= 0) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new NpcDialogue(0, npcId, "You don't have any inventory space.", "Banker")));
    return;
  }
  api.sendMultiChatboxPrompt(player, "Un-note the banknotes?", "Yes", () => {
    if (inventory.forSlot(slot)?.getId() !== itemId) return;
    const count = unnoteCount(inventory, slot);
    if (count <= 0) return;
    inventory.deleteNumber(itemId, count);
    inventory.adds(unnoted, count);
    inventory.refreshItems();
    const text = count === 1 ? "The bank exchanges your banknote for an item." : "The bank exchanges your banknotes for items.";
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, unnoted, text)));
  }, "No", () => {});
}

function useCurrencyOnBankObject(api, event) {
  if (BANK_OBJECT_NAMES.has(event.object?.getDefinition?.()?.getName?.())) confirmExchange(api, event, event.itemSlot);
}

module.exports = {
  name: "BankBooths",
  description: "Opens the bank from bank booths, bank chests and Banker NPCs, and handles the bank tab and settings buttons.",
  handleBankButton,
  handleBankInterfaceAction,
  register(api) {
    api.onObjectInteraction("Bank booth", { Bank: openBankFromInteraction.bind(null, api), Use: openBankFromInteraction.bind(null, api) });
    api.onObjectInteraction("Bank chest", { Use: openBankFromInteraction.bind(null, api) });
    api.onObjectInteraction("Bank Chest", { Use: openBankFromInteraction.bind(null, api) });
    api.onNpcInteraction("Banker", { "Talk-to": talkToBanker.bind(null, api), Bank: openBankFromInteraction.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", bankerDialogueAction.bind(null, api));
    api.onItemOnNpc(useCurrencyOnBanker.bind(null, api), { noted: false });
    api.onItemOnNpc(unnoteOnBanker.bind(null, api), { noted: true });
    api.onItemOnObject(useCurrencyOnBankObject.bind(null, api), { noted: false });
    api.onButtonClick(bankButton.bind(null, api));
    api.onInterfaceActionClick(bankInterfaceAction.bind(null, api));
  },
};
