// Run after `yarn build`: node --test tests/bank-space.test.cjs
//
// Bank space against the OSRS Wiki (Bank) and the rsprox capture in
// plugins/interface/data/bank-space.json: one capacity across every tab, a full bank that still
// stacks what it holds, and the BankSpace plugin's capacity, tooltip and Banker purchase.
const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { DialogueManager } = require("../dist/game/model/dialogues/DialogueManager");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");

const COINS = 995;
const SWORD = 1277;
const SWORD_NOTE = 1278;
const DEFINITIONS = {
  [COINS]: { name: "Coins", stackable: true },
  [SWORD]: { name: "Bronze sword" },
  [SWORD_NOTE]: { name: "Bronze sword", stackable: true, noteOf: SWORD },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: `Item ${id}` };
  return {
    getId: () => id, getName: () => def.name, getExamine: () => "",
    isStackable: () => def.stackable === true, isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id, getNoteId: () => -1, getPlaceholderId: () => -1,
    isTradeable: () => true, isSellable: () => true, getValue: () => 1, getGrandExchangeValue: () => 1,
  };
};

const originalEmit = PluginManager.emitCustomEvent;
const handlers = new Map();
PluginManager.emitCustomEvent = (name, event) => handlers.get(name)?.(event);
afterEach(() => handlers.clear());

function createPlayer() {
  const varbits = [];
  const strings = [];
  const scripts = [];
  const sounds = [];
  const sender = new Proxy({}, {
    get: (_target, prop) => (...args) => {
      if (prop === "sendVarbit") varbits.push(args);
      if (prop === "sendString") strings.push(args);
      if (prop === "sendClientScript") scripts.push(args);
      if (prop === "sendSound") sounds.push(args);
      return sender;
    },
  });
  const messages = [];
  const attributes = {};
  const player = {
    varbits, strings, scripts, sounds, messages, attributes, interfaceId: -1,
    getUsername: () => "alice", getDisplayName: () => "alice",
    sendMessage: (message) => messages.push(message),
    isSearchingBank: () => false,
    getPacketSender: () => sender,
    getStatus: () => PlayerStatus.BANKING,
    insertModeReturn: () => false,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: (id) => { player.interfaceId = id; },
    getCurrentBankTab: () => 0,
    setCurrentBankTab: () => {},
    withdrawAsNote: () => false,
    isPlaceholders: () => false,
    isPlayerBot: () => false,
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(player).resetItems());
  player.getInventory = () => player.inventory;
  player.getBank = (tab = 0) => player.banks[tab];
  player.getBanks = () => player.banks;
  player.setBank = (tab, bank) => { player.banks[tab] = bank; };
  player.dialogues = new DialogueManager(player);
  player.getDialogueManager = () => player.dialogues;
  return player;
}

function capacity(slots) {
  handlers.set("bank:capacity", (event) => { event.capacity = slots; });
}

test("one capacity covers every tab, placeholders included", () => {
  capacity(4);
  const player = createPlayer();
  player.getBank(0).add(new Item(2000, 1), false);
  player.getBank(1).add(new Item(2001, 1), false);
  player.getBank(2).setItem(0, new Item(2002, 0));
  assert.equal(Bank.usedSlots(player), 3);
  assert.equal(player.getBank(1).getFreeSlots(), 1);

  player.inventory.add(new Item(SWORD, 1), false);
  player.inventory.switchItem(player.getBank(1), new Item(SWORD, 1), false, 0, false);
  assert.equal(Bank.usedSlots(player), 4);

  player.inventory.add(new Item(3000, 1), false);
  player.inventory.switchItem(player.getBank(0), new Item(3000, 1), false, 0, false);
  assert.ok(player.messages.includes("Not enough space in bank."));
  assert.equal(player.inventory.getAmount(3000), 1, "the refused item stays in the inventory");
});

test("a full bank still takes more of what it holds, and notes of it", () => {
  capacity(1);
  const player = createPlayer();
  player.getBank(0).add(new Item(SWORD, 1), false);
  player.inventory.add(new Item(SWORD, 1), false);
  player.inventory.add(new Item(SWORD_NOTE, 3), false);
  player.inventory.switchItem(player.getBank(0), new Item(SWORD, 1), false, 0, false);
  player.inventory.switchItem(player.getBank(0), new Item(SWORD_NOTE, 3), false, 1, false);
  assert.equal(player.getBank(0).getAmount(SWORD), 5);
  assert.equal(player.inventory.getAmount(SWORD), 0, "the moved sword leaves the inventory");
  assert.equal(player.inventory.getAmount(SWORD_NOTE), 0, "the moved notes leave the inventory");
  assert.deepEqual(player.messages, []);
});

test("a full bank deposit of an unnoted item it holds moves it, never copies it", () => {
  capacity(1);
  const player = createPlayer();
  player.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  player.getBank(0).add(new Item(SWORD, 1), false);
  player.inventory.add(new Item(SWORD, 1), false);
  for (let i = 0; i < 3; i++) {
    Bank.deposits(player, SWORD, player.inventory.getSlotForItemId(SWORD), 1);
  }
  assert.equal(player.getBank(0).getAmount(SWORD), 2);
  assert.equal(player.inventory.getAmount(SWORD), 0);
});

test("bank:full sets the message", () => {
  capacity(0);
  handlers.set("bank:full", (event) => { event.message = "Set a Bank PIN to unlock more bank space."; });
  const player = createPlayer();
  player.inventory.add(new Item(SWORD, 1), false);
  player.inventory.switchItem(player.getBank(0), new Item(SWORD, 1), false, 0, false);
  assert.deepEqual(player.messages, ["Set a Bank PIN to unlock more bank space."]);
});

test("a tab grows past its first 352 slots, up to the 1410 the client holds", () => {
  const player = createPlayer();
  for (let id = 0; id < Bank.MAX_SLOTS; id++) player.getBank(0).add(new Item(5000 + id, 1), false);
  assert.equal(player.getBank(0).getValidItems().length, Bank.MAX_SLOTS);
  assert.equal(player.getBank(0).getEmptySlot(), -1);
});

test("items move between tabs, and a save loads, past the capacity", () => {
  capacity(2);
  const player = createPlayer();
  Bank.withoutLimit(player, () => player.getBank(1).addItems([new Item(2000, 1), new Item(2001, 1), new Item(2002, 1)], false));
  assert.equal(Bank.usedSlots(player), 3, "an over-full save loads whole");
  Bank.collapseTab(player, 1);
  assert.equal(player.getBank(0).getValidItems().length, 3);
  assert.equal(player.getBank(1).getValidItems().length, 0);
  assert.equal(player.getBank(0).getEmptySlot(), -1, "the limit applies again afterwards");
});

// --- BankSpace plugin ---

const DATA = require("../plugins/interface/data/bank-space.json");
const BankSpace = require("../plugins/interface/BankSpace.plugin");

function plugin({ members = true, pin = false, ultimate = false } = {}) {
  const custom = new Map();
  const hooks = {};
  const core = PluginManager.getCoreApi();
  const api = {
    core: {
      ...core,
      WorldDefinition: { isMembersWorld: () => members },
      GameConstants: { PLAYER_PERSISTENCE: { requestSave() {} } },
    },
    persistAttribute() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, event) => {
      if (name === "bank-pin:status") event.set = pin;
      else if (name === "ironman:mode") event.mode = ultimate ? "ultimate" : "none";
      else custom.get(name)?.(event);
    },
    onPlayerLogin: (handler) => { hooks.login = handler; },
    onNpcDialogueCondition: (handler) => { hooks.condition = handler; },
    onInterfaceActionClick: (handler) => { hooks.click = handler; },
  };
  BankSpace.register(api);
  for (const name of ["bank:capacity", "bank:full", "bank:opened"]) handlers.set(name, custom.get(name));
  return { custom, hooks };
}

const BANKER = { getName: () => "Banker" };
const NPC_ID = 6528;

/** The transcript reaching "(Bank space purchase interface opens.)". */
function openPurchase(p, player) {
  const action = { player, npcId: NPC_ID, definition: BANKER, action: "open_interface", target: "Bank space purchase", handled: false };
  p.custom.get("npc-dialogue:action")(action);
  assert.equal(action.handled, true);
  return player.scripts.at(-1);
}

function pick(p, player, index) {
  const event = { player, groupId: 947, childId: 9, action: index, handled: false };
  p.hooks.click(event);
  assert.equal(event.handled, true);
}

const shown = (player) => player.dialogues.getCurrent()?.getText?.();
function next(player) {
  player.dialogues.advance();
  return shown(player);
}

test("as captured: 900 for members, +100 bought, no PIN, +40 Jagex Account: 1040, and its tooltip", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 2);
  assert.equal(Bank.getCapacity(player), 1040);
  p.custom.get("bank:opened")({ player });
  assert.deepEqual(player.strings.at(-1), ["1040", (12 << 16) | 8]);
  assert.deepEqual(player.scripts.at(-1), [1495,
    "Members' capacity: 900<br>+100 that you've purchased.<br>A banker can sell you up to 350 more.<br>Set a PIN for 20 more.<br>+40 as a Jagex Account.",
    (12 << 16) | 7, (12 << 16) | 111]);
});

test("a PIN adds 20; free-to-play starts at 400; every block bought makes 1410", () => {
  const player = createPlayer();
  plugin({ pin: true });
  assert.equal(Bank.getCapacity(player), 960);
  plugin({ members: false });
  assert.equal(Bank.getCapacity(player), 440);
  plugin({ pin: true });
  player.setAttribute("bank-space:blocks", 9);
  assert.equal(Bank.getCapacity(player), Bank.MAX_SLOTS);
});

test("as captured: a full bank without a PIN points at one", () => {
  plugin();
  const event = { player: createPlayer(), message: "Not enough space in bank." };
  handlers.get("bank:full")(event);
  assert.equal(event.message, "Set a Bank PIN to unlock more bank space.");
  plugin({ pin: true });
  const withPin = { player: createPlayer(), message: "Not enough space in bank." };
  handlers.get("bank:full")(withPin);
  assert.equal(withPin.message, "Not enough space in bank.");
});

test("as captured: the Banker's offer and the purchase list at the running cost", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 2);
  for (const sets of [40, 50]) {
    const line = { player, definition: BANKER, text: `I can sell you up to [number] additional bank slots in sets of ${sets}. How many are you interested in buying?` };
    p.custom.get("npc-dialogue:line")(line);
    assert.equal(line.text, "I can sell you up to 350 additional bank slots in sets of 50. How many are you interested in buying?");
  }
  assert.deepEqual(openPurchase(p, player), [9142, "How many do you wish to purchase?",
    "50 slots (5,000,000 coins)|100 slots (15,000,000 coins)|150 slots (35,000,000 coins)|200 slots (85,000,000 coins)|250 slots (185,000,000 coins)|300 slots (385,000,000 coins)|350 slots (885,000,000 coins)||Do I have any other options for extra bank space?|(Cancel)",
    0, -1, 0, 0]);
  assert.equal(player.getInterfaceId(), 947);
});

test("as captured: coins in the bank don't pay; the player backs out", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 2);
  player.getBank(0).add(new Item(COINS, 10_000_000), false);
  openPurchase(p, player);
  pick(p, player, 0);
  assert.equal(shown(player), "50 slots please.");
  assert.equal(next(player), "Buying 50 additional bank slots will cost 5,000,000 coins. Be warned, this purchase is not reversible. Are you happy to proceed?");
  player.dialogues.advance();
  assert.equal(shown(player), "Oh... I don't seem to have enough money for that. Never mind.");
  assert.equal(player.getAttribute("bank-space:blocks"), 2);
});

test("as captured: paying from the inventory adds the block", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 2);
  player.inventory.add(new Item(COINS, 5_000_000), false);
  openPurchase(p, player);
  pick(p, player, 0);
  next(player);
  player.dialogues.advance();
  const confirm = player.dialogues.getCurrent();
  assert.ok(confirm instanceof OptionDialogue);
  assert.equal(confirm.getTitle(), "Buy 50 bank slots for 5,000,000 coins?");
  assert.deepEqual(confirm.getOptions(), ["Yes.", "No."]);
  player.dialogues.handleOption(1);
  assert.equal(shown(player), "Yes, I'm happy with that.");
  assert.equal(player.inventory.getAmount(COINS), 5_000_000, "paid on continuing");
  assert.equal(next(player), "Your additional bank slots have been added.");
  assert.equal(player.inventory.getAmount(COINS), 0);
  assert.equal(player.getAttribute("bank-space:blocks"), 3);
  assert.deepEqual(player.varbits.at(-1), [13119, 3]);
  assert.equal(player.sounds.at(-1)[0], 2114);
  assert.equal(Bank.getCapacity(player), 1090);
});

test("other options: the PIN hint, then the offer and the list again; all blocks bought leaves just those", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 9);
  const [, , options] = openPurchase(p, player);
  assert.equal(options, "Do I have any other options for extra bank space?|(Cancel)");
  pick(p, player, 0);
  assert.equal(shown(player), "Do I have any other options for extra bank space?");
  assert.equal(next(player), DATA.dialogue.pinHint);
  assert.equal(next(player), "I can sell you up to 0 additional bank slots in sets of 50. How many are you interested in buying?");
  player.dialogues.advance();
  assert.ok(player.dialogues.getCurrent() instanceof ActionDialogue);
  assert.equal(player.getInterfaceId(), 947);
});

test("picks number the lines the client shows, skipping the spacer: 6 is other options, 7 is Cancel", () => {
  // Second capture: with 3 blocks bought, live answered 6 with "(Cancel)" and 7 with "other options",
  // as its numbering counts the spacer; script 9143 only numbers lines with text.
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 3);
  const [, , options] = openPurchase(p, player);
  assert.equal(options.split("|").length, 9);
  pick(p, player, 6);
  assert.equal(shown(player), "Do I have any other options for extra bank space?");
  openPurchase(p, player);
  pick(p, player, 7);
  assert.equal(shown(player), "Actually, I've changed my mind.");
  assert.equal(player.dialogues.getCurrent().expression, 575);
});

test("the Ultimate Ironman condition is answered from the player's mode", () => {
  const player = createPlayer();
  const condition = { player, definition: BANKER, text: "If the player is an Ultimate Ironman:" };
  assert.equal(plugin({ ultimate: true }).hooks.condition(condition), true);
  assert.equal(plugin().hooks.condition(condition), false);
  assert.equal(plugin().hooks.condition({ ...condition, text: "If the player has 5 coins:" }), null);
});

test("the seller's name heads its lines", () => {
  const p = plugin();
  const player = createPlayer();
  const action = { player, npcId: 2400, definition: { getName: () => "Jade" }, action: "open_interface", target: "Bank space purchase" };
  p.custom.get("npc-dialogue:action")(action);
  pick(p, player, 0);
  player.dialogues.advance();
  const strings = player.strings.map(([text]) => text);
  assert.ok(strings.includes("Jade"));
});

test("login sends the blocks bought", () => {
  const p = plugin();
  const player = createPlayer();
  player.setAttribute("bank-space:blocks", 4);
  p.hooks.login({ player });
  assert.deepEqual(player.varbits.at(-1), [13119, 4]);
});

process.on("exit", () => { PluginManager.emitCustomEvent = originalEmit; });
