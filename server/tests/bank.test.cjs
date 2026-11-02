// Run after `yarn build`: node --test tests/bank.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { World } = require("../dist/game/World");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

const TRIDENT = 11907;
const LAVA_BATTLESTAFF = 3053;
const MYSTIC_LAVA_STAFF = 3054;
// In the cache this note belongs to 3053, not to 3054 (its id minus one).
const LAVA_BATTLESTAFF_NOTE = 3055;
const LAVA_BATTLESTAFF_PLACEHOLDER = 90053;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  995: { name: "Coins", stackable: true },
  13204: { name: "Platinum token", stackable: true },
  [TRIDENT]: { name: "Trident of the seas", examine: "This trident has a charge." },
  [LAVA_BATTLESTAFF]: { name: "Lava battlestaff", placeholder: LAVA_BATTLESTAFF_PLACEHOLDER },
  [MYSTIC_LAVA_STAFF]: { name: "Mystic lava staff" },
  [LAVA_BATTLESTAFF_NOTE]: { name: "Lava battlestaff", stackable: true, noteOf: LAVA_BATTLESTAFF },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null" };
  return {
    getId: () => id,
    getName: () => def.name,
    getExamine: () => def.examine ?? "",
    isStackable: () => def.stackable === true,
    isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id,
    getNoteId: () => -1,
    getPlaceholderId: () => def.placeholder ?? -1,
    isTradeable: () => true,
    isSellable: () => true,
    getValue: () => 100,
    getGrandExchangeValue: () => 500,
  };
};

function createPlayer() {
  // Every packet-sender call is a chainable no-op; sendVarbit and sendEnterAmountPrompt also record.
  const varbits = [];
  const prompts = [];
  const sender = new Proxy({}, {
    get: (_target, prop) =>
      prop === "sendVarbit"
        ? (id, value) => { varbits.push([id, value]); return sender; }
        : prop === "sendEnterAmountPrompt"
          ? (title) => { prompts.push(title); return sender; }
          : () => sender,
  });
  let currentTab = 0;
  const messages = [];
  const player = {
    varbits,
    prompts,
    messages,
    custom: 0,
    mode: 0,
    amountAction: null,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    isSearchingBank: () => false,
    getPacketSender: () => sender,
    getStatus: () => (player.closed ? PlayerStatus.NONE : PlayerStatus.BANKING),
    insertModeReturn: () => player.insertMode === true,
    getInterfaceId: () => Bank.MAIN_INTERFACE_ID,
    getCurrentBankTab: () => currentTab,
    setCurrentBankTab: (tab) => { currentTab = tab; },
    withdrawAsNote: () => false,
    isPlaceholders: () => player.placeholders === true,
    isPlayerBot: () => false,
    getBankCustomQuantity: () => player.custom,
    setBankCustomQuantity: (amount) => { player.custom = amount; },
    getBankQuantityMode: () => player.mode,
    setBankQuantityMode: (mode) => { player.mode = mode; },
    setEnteredAmountAction: (action) => { player.amountAction = action; },
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(player).resetItems());
  player.getInventory = () => player.inventory;
  player.getBank = (tab = 0) => player.banks[tab];
  player.setBank = (tab, bank) => { player.banks[tab] = bank; };
  return player;
}

test("depositing a note banks the item it notes, not the item before it", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 2), false);

  player.getInventory().switchItem(player.getBank(), new Item(LAVA_BATTLESTAFF_NOTE, 2), false, 0, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 2);
  assert.equal(player.getBank().getAmount(MYSTIC_LAVA_STAFF), 0);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

test("depositing everything banks notes as the item they note", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 3), false);
  const item = player.getInventory().getValidItems()[0];

  // What Deposit inventory does for each inventory item.
  player.getInventory().switchItems(player.getBank(), item.clone(), false, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 3);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
  assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

function metas(container) {
  return container.getValidItems().map((item) => [item.getAmount(), item.getMeta()]);
}

test("depositing items keeps each one's metadata", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.deposit(player, TRIDENT, 1, 2, true);

  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }], [1, { charges: 5 }]]);
  assert.equal(player.getInventory().getValidItems().length, 0);
});

test("inventory bank options count matching unnoted items across slots", () => {
  for (const [buttonNum, option, custom, mode, expected] of [
    [8, "Deposit-All", 0, 0, 4],
    [6, "Deposit-3", 3, 0, 3],
    [6, undefined, 3, 0, 3],
    [4, "Deposit-5", 0, 0, 4],
    [5, "Deposit-10", 0, 0, 4],
    [2, undefined, 3, 3, 3],
    [2, undefined, 0, 4, 4],
    [1, "Deposit-1", 0, 0, 1],
  ]) {
    const player = createPlayer();
    player.custom = custom;
    player.mode = mode;
    for (const charges of [5, 20, 100, 1200]) {
      player.getInventory().add(new Item(TRIDENT, 1, { charges }), false);
    }
    player.getInventory().add(new Item(LAVA_BATTLESTAFF, 1), false);

    Bank.handleWidgetAction(player, {
      groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_ITEMS_CHILD,
      buttonNum, option, slot: 3, itemId: TRIDENT,
    });

    assert.equal(player.getBank().getAmount(TRIDENT), expected);
    assert.equal(player.getInventory().getAmount(TRIDENT), 4 - expected);
    assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF), 1);
    assert.deepEqual(player.getBank().getValidItems()[0].getMeta(), { charges: 1200 });
  }
});

/** The player's answer to the open "Enter amount:" prompt, as resume_p_countdialog delivers it. */
function enterAmount(player, amount) {
  const action = player.amountAction;
  assert.ok(action, "an amount prompt is open");
  player.amountAction = null;
  action.execute(amount);
}

const withdrawOp = (player, buttonNum, option, slot = 0, itemId = 995) => Bank.handleWidgetAction(player, {
  groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD, buttonNum, option, slot, itemId,
});
const depositOp = (player, buttonNum, option, slot = 0, itemId = 995) => Bank.handleWidgetAction(player, {
  groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_ITEMS_CHILD, buttonNum, option, slot, itemId,
});

test("Deposit-X still moves a partial noted stack", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 7), false);
  depositOp(player, 7, "Deposit-X", 0, LAVA_BATTLESTAFF_NOTE);
  enterAmount(player, 3);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 3);
  assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF_NOTE), 4);
});

test("as captured: Withdraw-X asks for the amount, remembers it and withdraws it", () => {
  for (const option of ["Withdraw-X", undefined]) {
    const player = createPlayer();
    player.custom = 500;
    player.getBank().add(new Item(995, 5000), false);

    withdrawOp(player, 6, option);
    assert.deepEqual(player.prompts, ["Enter amount:"]);
    assert.equal(player.getInventory().getAmount(995), 0, "nothing moves until the amount is entered");

    enterAmount(player, 200);
    assert.equal(player.custom, 200);
    assert.deepEqual(player.varbits.filter(([id]) => id === Bank.REQUESTED_QUANTITY_VARBIT), [[Bank.REQUESTED_QUANTITY_VARBIT, 200]]);
    assert.equal(player.getInventory().getAmount(995), 200);
    assert.equal(player.getBank().getAmount(995), 4800);
  }
});

test("as captured: Deposit-X asks for the amount, remembers it and deposits it", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(995, 1000), false);

  depositOp(player, 7, "Deposit-X");
  assert.deepEqual(player.prompts, ["Enter amount:"]);
  enterAmount(player, 10);

  assert.equal(player.custom, 10);
  assert.equal(player.getBank().getAmount(995), 10);
  assert.equal(player.getInventory().getAmount(995), 990);
});

test("as captured: Withdraw/Deposit-<last X> and the X-mode click use the remembered amount without asking", () => {
  const player = createPlayer();
  player.custom = 200;
  player.getBank().add(new Item(995, 5000), false);

  withdrawOp(player, 5, "Withdraw-200");
  assert.equal(player.getInventory().getAmount(995), 200);
  depositOp(player, 6, "Deposit-200");
  assert.equal(player.getInventory().getAmount(995), 0);

  player.mode = Bank.QUANTITY_X_MODE;
  withdrawOp(player, 1, undefined);
  assert.equal(player.getInventory().getAmount(995), 200);
  depositOp(player, 2, undefined);
  assert.equal(player.getInventory().getAmount(995), 0);
  assert.deepEqual(player.prompts, []);
});

test("the X-mode click asks for the amount while none is remembered", () => {
  const player = createPlayer();
  player.mode = Bank.QUANTITY_X_MODE;
  player.getBank().add(new Item(995, 5000), false);

  withdrawOp(player, 1, undefined);
  assert.deepEqual(player.prompts, ["Enter amount:"]);
  enterAmount(player, 30);
  assert.equal(player.getInventory().getAmount(995), 30);
});

test("as captured: Set custom quantity remembers the amount without moving anything", () => {
  const player = createPlayer();
  player.mode = Bank.QUANTITY_X_MODE;
  player.getBank().add(new Item(995, 5000), false);

  Bank.handleWidgetAction(player, { groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.QUANTITY_CHILDREN[3], buttonNum: 2 });
  assert.deepEqual(player.prompts, ["Enter amount:"]);
  enterAmount(player, 100);

  assert.equal(player.custom, 100);
  assert.equal(player.mode, Bank.QUANTITY_X_MODE);
  assert.equal(player.getInventory().getAmount(995), 0);
  withdrawOp(player, 1, undefined);
  assert.equal(player.getInventory().getAmount(995), 100);
});

test("an amount entered after the item left its bank slot, or after the bank closed, moves nothing", () => {
  const player = createPlayer();
  player.getBank().add(new Item(995, 5000), false);
  withdrawOp(player, 6, "Withdraw-X");
  player.getBank().resetItems();
  player.getBank().add(new Item(TRIDENT, 1), false);
  enterAmount(player, 1);
  assert.equal(player.getInventory().getValidItems().length, 0);

  const closed = createPlayer();
  closed.getBank().add(new Item(995, 5000), false);
  withdrawOp(closed, 6, "Withdraw-X");
  closed.closed = true;
  enterAmount(closed, 100);
  assert.equal(closed.getInventory().getAmount(995), 0);
  assert.equal(closed.custom, 0);
});

test("withdrawing an item keeps its metadata", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 1200 }]]);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 0);
});

test("a full bank tab refuses the item instead of throwing", () => {
  const player = createPlayer();
  const bank = player.getBank(0);
  for (let slot = 0; slot < Bank.MAX_SLOTS; slot++) bank.add(new Item(20000 + slot, 1), false);
  player.getInventory().add(new Item(TRIDENT, 1), false);

  assert.doesNotThrow(() => player.getInventory().switchItem(bank, new Item(TRIDENT, 1), false, 0, false));

  assert.ok(player.messages.includes("Not enough space in bank."));
  assert.equal(player.getInventory().getAmount(TRIDENT), 1);
});

function bankTwoTridents(player) {
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 1200 }), false);
}

test("withdrawing takes the stack that was clicked, not the first with that item", () => {
  const player = createPlayer();
  bankTwoTridents(player);

  Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum: 1, option: "Withdraw-1", slot: 1, itemId: TRIDENT,
  });

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 1200 }]]);
  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 5 }]]);
});

test("withdrawing never takes more than the clicked stack holds", () => {
  const player = createPlayer();
  bankTwoTridents(player);

  Bank.withdraw(player, TRIDENT, 0, 2, 0);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 5 }]]);
  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }]]);
});

test("search withdrawals cannot clone one metadata stack using the aggregate item count", () => {
  const player = createPlayer();
  bankTwoTridents(player);
  player.isSearchingBank = () => true;
  player.getBank(Bank.BANK_SEARCH_TAB_INDEX).add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getBank(Bank.BANK_SEARCH_TAB_INDEX).add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.withdraw(player, TRIDENT, 0, -1, Bank.BANK_SEARCH_TAB_INDEX);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 5 }]]);
  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }]]);
});

test("as captured: withdrawing into a full inventory says there is no space", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 3), false);
  for (let i = 0; i < 28; i++) player.getInventory().add(new Item(LAVA_BATTLESTAFF, 1), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(player.messages, ["You don't have enough inventory space."]);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 3);
});

test("as captured: withdrawing more than the free slots takes what fits and says so", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 5), false);
  for (let i = 0; i < 26; i++) player.getInventory().add(new Item(LAVA_BATTLESTAFF, 1), false);

  Bank.withdraw(player, TRIDENT, 0, 5, 0);

  assert.deepEqual(player.messages, ["You don't have enough inventory space to withdraw that many."]);
  assert.equal(player.getInventory().getAmount(TRIDENT), 2);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 3);
});

test("withdrawing what fits sends no message", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 2), false);

  Bank.withdraw(player, TRIDENT, 0, 2, 0);

  assert.deepEqual(player.messages, []);
});

test("the client layout lists tabs 1-9 before the main tab", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 1), false);
  player.getBank(2).add(new Item(TRIDENT, 1), false);
  player.getBank(1).add(new Item(MYSTIC_LAVA_STAFF, 1), false);

  assert.deepEqual(
    Bank.layout(player).map(({ tab, item }) => [tab, item.getId()]),
    [[1, MYSTIC_LAVA_STAFF], [2, TRIDENT], [0, LAVA_BATTLESTAFF]],
  );
  assert.equal(Bank.resolveDisplaySlot(player, 2).item.getId(), LAVA_BATTLESTAFF);
});

test("withdrawing everything leaves the item's faded cache placeholder", () => {
  const player = createPlayer();
  player.placeholders = true;
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 1), false);

  Bank.withdraw(player, LAVA_BATTLESTAFF, 0, 1, 0);

  const [entry] = Bank.layout(player);
  assert.equal(entry.item.getAmount(), 0);
  assert.equal(Bank.displayItemId(entry.item), LAVA_BATTLESTAFF_PLACEHOLDER);
});

test("an item without a cache placeholder leaves none", () => {
  const player = createPlayer();
  player.placeholders = true;
  player.getBank(0).add(new Item(TRIDENT, 1), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(Bank.layout(player), []);
});

test("clicking Release on a placeholder removes it; other options leave it", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 0), false);
  const click = (option, buttonNum) => Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum, option, slot: 0, itemId: LAVA_BATTLESTAFF_PLACEHOLDER,
  });

  click("Withdraw-1", 1);
  assert.equal(Bank.layout(player).length, 1);

  click("Release", 8);
  assert.deepEqual(Bank.layout(player), []);
});

test("a bank item's op 11 examines it without withdrawing", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 1), false);

  Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum: Bank.EXAMINE_OP, slot: 0, itemId: TRIDENT,
  });

  assert.deepEqual(player.messages, ["This trident has a charge."]);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 1);
  assert.equal(player.getInventory().getAmount(TRIDENT), 0);
});

function clickTab(player, tab, buttonNum, option) {
  Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.TABS_CHILD, buttonNum, option, slot: Bank.TAB_BUTTON_SLOT_OFFSET + tab,
  });
}

function tabsOf(player) {
  return Bank.layout(player).map(({ tab, item }) => [tab, item.getId(), item.getAmount()]);
}

test("clicking a tab views it; clicking the empty slot after the last tab explains how to make one", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);

  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);

  clickTab(player, 2, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.ok(player.messages.includes("To create a new tab, drag items from your bank onto this tab."));
});

test("collapsing a tab moves its items and placeholders into the main tab and shifts later tabs down", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1, { charges: 1200 }), false);
  player.getBank(1).add(new Item(LAVA_BATTLESTAFF, 0), false);
  player.getBank(2).add(new Item(MYSTIC_LAVA_STAFF, 3), false);

  clickTab(player, 1, 6, "Collapse tab");

  assert.deepEqual(tabsOf(player), [[1, MYSTIC_LAVA_STAFF, 3], [0, TRIDENT, 1], [0, LAVA_BATTLESTAFF, 0]]);
  assert.deepEqual(player.getBank(0).getValidItems()[0].getMeta(), { charges: 1200 });
});

test("removing placeholders from a tab leaves other tabs' placeholders", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(LAVA_BATTLESTAFF, 0), false);
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  player.getBank(0).add(new Item(MYSTIC_LAVA_STAFF, 0), false);

  clickTab(player, 1, 7, "Remove placeholders");

  assert.deepEqual(tabsOf(player), [[1, TRIDENT, 1], [0, MYSTIC_LAVA_STAFF, 0]]);
});

const BANK_ITEMS = (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD;
const BANK_TABS = (Bank.MAIN_INTERFACE_ID << 16) | Bank.TABS_CHILD;
const SIDE_ITEMS = (Bank.SIDE_INTERFACE_ID << 16) | Bank.SIDE_ITEMS_CHILD;
const A = MYSTIC_LAVA_STAFF, B = LAVA_BATTLESTAFF, C = TRIDENT;

function drag(player, sourceWidgetId, sourceSlot, sourceItemId, targetWidgetId, targetSlot) {
  return Bank.handleDrag(player, { sourceWidgetId, sourceSlot, sourceItemId, targetWidgetId, targetSlot });
}

function bankOf(player, ...tabs) {
  tabs.forEach((ids, tab) => ids.forEach((id) => player.getBank(tab).add(new Item(id, 1), false)));
}

test("dragging a bank item onto another swaps them, or inserts in insert mode", () => {
  const swapping = createPlayer();
  bankOf(swapping, [A, B, C]);
  drag(swapping, BANK_ITEMS, 0, A, BANK_ITEMS, 2);
  assert.deepEqual(tabsOf(swapping).map(([, id]) => id), [C, B, A]);

  const inserting = createPlayer();
  inserting.insertMode = true;
  bankOf(inserting, [A, B, C]);
  drag(inserting, BANK_ITEMS, 0, A, BANK_ITEMS, 2);
  assert.deepEqual(tabsOf(inserting).map(([, id]) => id), [B, C, A]);
});

test("dragging a bank item onto a tab button moves it there, creating at most one new tab", () => {
  const player = createPlayer();
  bankOf(player, [A, B]);

  drag(player, BANK_ITEMS, 0, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 5);
  assert.deepEqual(tabsOf(player), [[1, A, 1], [0, B, 1]]);

  drag(player, BANK_ITEMS, 0, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET);
  assert.deepEqual(tabsOf(player), [[0, B, 1], [0, A, 1]]);
});

test("dragging a bank item onto another tab's item joins that tab", () => {
  const player = createPlayer();
  player.insertMode = true;
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, 0);

  assert.deepEqual(tabsOf(player), [[1, C, 1], [1, A, 1], [1, B, 1]]);
});

test("dragging an inventory item onto a tab deposits it there, or onto its existing stack", () => {
  const player = createPlayer();
  bankOf(player, [A]);
  player.getInventory().add(new Item(B, 1), false);
  player.getInventory().add(new Item(A, 1), false);

  drag(player, SIDE_ITEMS, 0, B, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 1);
  drag(player, SIDE_ITEMS, 1, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 1);

  assert.deepEqual(tabsOf(player), [[1, B, 1], [0, A, 2]]);
  assert.equal(player.getInventory().getValidItems().length, 0);
});

test("dragging within the bank's inventory panel swaps inventory slots", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(A, 1), false);
  player.getInventory().add(new Item(B, 1), false);

  drag(player, SIDE_ITEMS, 0, A, SIDE_ITEMS, 1);

  assert.deepEqual(player.getInventory().getValidItems().map((item) => item.getId()), [B, A]);
});

test("bank drags are ignored while the bank is closed", () => {
  const player = createPlayer();
  bankOf(player, [A, B]);
  player.closed = true;

  assert.equal(drag(player, BANK_ITEMS, 0, A, BANK_ITEMS, 1), false);
  assert.deepEqual(tabsOf(player).map(([, id]) => id), [A, B]);
});

test("depositing keeps the tab being viewed", () => {
  const player = createPlayer();
  bankOf(player, [A], [B]);
  player.getInventory().add(new Item(B, 1), false);

  Bank.deposit(player, B, 0, 1, true);

  assert.equal(player.getCurrentBankTab(), 0);
  assert.equal(player.getBank(1).getAmount(B), 2);
});

test("in swap mode, dragging onto another tab's item trades their places and tabs", () => {
  const player = createPlayer();
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, 0);

  assert.deepEqual(tabsOf(player), [[1, C, 1], [1, B, 1], [0, A, 1]]);
});

test("dragging onto the empty space after a tab's items moves the item to the end of that tab", () => {
  const player = createPlayer();
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, Bank.TAB_DROP_SLOT_OFFSET + 1);

  assert.deepEqual(tabsOf(player), [[1, A, 1], [1, B, 1], [1, C, 1]]);
});

/** A player whose packet sender records client scripts. */
function recordingPlayer() {
  const player = createPlayer();
  const scripts = [];
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      if (name === "sendClientScript") scripts.push(args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.scripts = scripts;
  return player;
}

test("as captured: picking a tab, on the tab bar or a tab heading, ends the bank search", () => {
  const player = recordingPlayer();
  for (const tab of [1, 2, 3]) player.getBank(tab).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.deepEqual(player.scripts, [[101, 11]], "meslayer_close for the bank search input");
  // The all-items view's tab headings are bankmain:items slots 1419-1427 (tabs 1-9).
  player.scripts.length = 0;
  Bank.handleWidgetAction(player, { groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum: 1, slot: 1421 });
  assert.equal(player.getCurrentBankTab(), 3);
  assert.deepEqual(player.scripts, [[101, 11]]);
});

test("as captured: Search switches to the main tab", () => {
  const player = recordingPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  Bank.handleWidgetAction(player, { groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.SEARCH_CHILD, buttonNum: 1 });
  assert.equal(player.getCurrentBankTab(), 0);
});

test("as captured: closing the bank by any route ends a bank search; closing anything else does not", () => {
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  // sendInterfaceRemoval: the bank's own close; closeInterruptibleInterfaces: the X (IF_CLOSE)
  // and walking away.
  for (const route of ["sendInterfaceRemoval", "closeInterruptibleInterfaces"]) {
    const close = (interfaceId) => {
      const player = recordingPlayer();
      PacketSender.prototype[route].call({
        player,
        resetInterfaceState: () => interfaceId,
        closeTrackedInterfaces: () => true,
        sendSubInterface: () => {},
        endBankSearch: PacketSender.prototype.endBankSearch,
        emitInterfaceClosed: () => {},
      });
      return player.scripts;
    };
    assert.deepEqual(close(Bank.MAIN_INTERFACE_ID), [[101, 11]], route);
    assert.deepEqual(close(300), [], route);
  }
});

test("as captured: closing the bank under an unanswered Enter amount prompt aborts the prompt first", () => {
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  // ServerPacketId is a const enum, inlined at build time.
  const ServerPacketId = { WIDGET_CLOSE_SUB: 104, TRIGGER_ONDIALOGABORT: 123 };
  for (const route of ["sendInterfaceRemoval", "closeInterruptibleInterfaces"]) {
    const sent = (answered) => {
      const opcodes = [];
      const player = createPlayer();
      player.getSession = () => ({ sendClientPacket: (packet) => opcodes.push(packet[0]), write: () => {} });
      player.getEnteredAmountAction = () => player.amountAction;
      player.setEnteredSyntaxAction = () => {};
      // Real interface reset; the bank's if_closesub stands in for the tracked-interface close.
      const sender = Object.assign(Object.create(PacketSender.prototype), {
        player,
        closeTrackedInterfaces: () => opcodes.push(ServerPacketId.WIDGET_CLOSE_SUB) > 0,
        sendConfig() { return this; },
        sendVarbit() { return this; },
        sendSubInterface: () => {},
        endBankSearch: () => {},
        emitInterfaceClosed: () => {},
      });
      Bank.promptAmount(player);
      if (answered) player.amountAction.execute(5), player.setEnteredAmountAction(null);
      opcodes.length = 0;
      sender[route]();
      assert.equal(player.amountAction, null, route);
      return opcodes;
    };
    const aborted = sent(false);
    assert.equal(aborted.filter((op) => op === ServerPacketId.TRIGGER_ONDIALOGABORT).length, 1, route);
    assert.ok(aborted.indexOf(ServerPacketId.TRIGGER_ONDIALOGABORT) < aborted.indexOf(ServerPacketId.WIDGET_CLOSE_SUB), route);
    assert.ok(!sent(true).includes(ServerPacketId.TRIGGER_ONDIALOGABORT), `${route}: no prompt left to abort`);
  }
});

const bankTabsSent = (player) => player.varbits.filter(([id]) => id === 4150);

// These exercise the registered gameplay handlers with real inventory/dialogue classes.
function bankerHarness() {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
  const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const transcript = require('../data/definitions/npc-dialogues.json').Banker;
  const player = createPlayer();
  const manager = new DialogueManager(player);
  player.getDialogueManager = () => manager;
  player.getAppearance = () => ({ isMale: () => true });
  const scripts = [];
  let chatbox = -1;
  const sender = new Proxy({}, { get: (_target, method) => (...args) => {
    if (method === 'sendInterfaceRemoval') { manager.reset(); chatbox = -1; }
    if (method === 'sendChatboxInterface') chatbox = args[0];
    if (method === 'isChatboxInterface') return chatbox === args[0];
    if (method === 'sendClientScript') scripts.push(args);
    return sender;
  } });
  player.getPacketSender = () => sender;
  const custom = new Map();
  const npc = new Map();
  const object = new Map();
  let useNpc;
  const useObjects = [];
  const api = {
    core: { Bank, PlayerStatus, Item, ItemIdentifiers, DialogueChainBuilder, OptionDialogue, World },
    onNpcInteraction: (name, handlers) => npc.set(name, handlers),
    onObjectInteraction: (name, handlers) => object.set(name, handlers),
    onItemOnNpc: (handler) => { useNpc = handler; },
    onItemOnObject: (...args) => useObjects.push(args),
    onButtonClick() {}, onInterfaceActionClick() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    sendMultiChatboxPrompt: (p, title, ...pairs) => MultiChatboxPrompt.showPrompt('bank-test', p, title, pairs),
    emitCustomEvent: (name, event) => {
      if (name === 'npc-dialogue:start') {
        startDialogue(api, { ...event, definition: { getId: () => event.npcId, getName: () => 'Banker' } },
          transcript.variants[event.variant], transcript.branches);
        event.handled = true;
      } else custom.get(name)?.(event);
    },
  };
  require('../plugins/objects/BankBooths.plugin').register(api);
  const use = (id, route = 'Banker', slot = player.inventory.getItems().findIndex(item => item.getId() === id)) => {
    const definition = { getName: () => route };
    const event = { player, itemId: id, item: player.inventory.forSlot(slot), slot, itemSlot: slot,
      npcId: 1633, target: { getDefinition: () => definition },
      object: { getDefinition: () => definition }, handled: false };
    if (route === 'Banker' || route === 'Man') useNpc?.(event);
    else for (const args of useObjects) {
      if (typeof args[0] === 'function') args[0](event);
      else if (args[0] === DEFINITIONS[id]?.name && args[1] === route) args[2](event);
    }
    return event;
  };
  return { player, manager, scripts, npc, object, use };
}

test('banker Talk-to plays the canonical conversation and its account choice opens banking', () => {
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  const original = NpcDefinition.forId;
  NpcDefinition.forId = id => ({ getId: () => id, getName: () => 'Banker' });
  try {
  const h = bankerHarness();
  let opens = 0;
  h.player.getBank = () => ({ open: () => opens++ });
  h.player.getInterfaceId = () => -1;
  h.player.getStatus = () => PlayerStatus.NONE;
  const event = { player: h.player, npcId: 1633 };
  h.npc.get('Banker')['Talk-to'](event);
  assert.equal(opens, 0);
  assert.ok(h.manager.isActive());
  h.manager.advance();
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  assert.match(MultiChatboxPrompt.getPending(h.player).options[0], /access my bank account/);
  MultiChatboxPrompt.handleInterfaceActionClick({ player: h.player, buttonId: (219 << 16) | 1, slot: 1 });
  assert.equal(opens, 1);
  } finally { NpcDefinition.forId = original; }
});

test('banker Bank keeps its direct bank shortcut', () => {
  const h = bankerHarness();
  let opens = 0;
  h.player.getBank = () => ({ open: () => opens++ });
  h.player.getInterfaceId = () => -1;
  h.player.getStatus = () => PlayerStatus.NONE;
  h.npc.get('Banker').Bank({ player: h.player });
  assert.equal(opens, 1);
  assert.equal(h.manager.isActive(), false);
});

test('native currency confirmation replaces a pending Talk menu without executing its stale choice', () => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const h = bankerHarness();
  h.player.inventory.add(new Item(995, 2000), false);
  let staleChoices = 0;
  MultiChatboxPrompt.showPrompt('bank-test', h.player, 'Old talk menu', ['Bank', () => staleChoices++, 'Cancel', () => {}]);
  h.use(995);
  const packet = { player: h.player, buttonId: (219 << 16) | 1, action: 1, handled: false };
  if (!PluginManager.emitInterfaceActionClick(packet)) h.manager.handleResume(packet.buttonId, packet.action);
  assert.equal(staleChoices, 0);
  assert.equal(h.player.inventory.getAmount(995), 0);
  assert.equal(h.player.inventory.getAmount(13204), 2);
  assert.equal(MultiChatboxPrompt.getPending(h.player), null);
});

test('closed multi prompts cannot consume a later resume or reappear on reopening chatbox', () => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const h = bankerHarness();
  let selected = 0;
  MultiChatboxPrompt.showPrompt('bank-test', h.player, 'Old menu', ['Yes', () => selected++, 'No', () => {}]);
  h.player.getPacketSender().sendInterfaceRemoval();
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: h.player, buttonId: (219 << 16) | 1, action: 1 }), false);
  h.player.getPacketSender().sendChatboxInterface(219);
  assert.equal(MultiChatboxPrompt.getPending(h.player), null);
  assert.equal(selected, 0);
});

test('a multi prompt shown by an active dialogue takes ownership and remains selectable', () => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const h = bankerHarness();
  h.player.inventory.add(new Item(995, 2000), false);
  h.use(995);
  assert.equal(h.manager.isActive(), true);
  let selected = 0;
  MultiChatboxPrompt.showPrompt('bank-test', h.player, 'New prompt', ['Yes', () => selected++, 'No', () => {}]);
  assert.equal(h.manager.isActive(), false);
  assert.equal(MultiChatboxPrompt.getPending(h.player).title, 'New prompt');
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: h.player, buttonId: (219 << 16) | 1, action: 1 }), true);
  assert.equal(selected, 1);
  assert.equal(h.player.inventory.getAmount(995), 2000);
});

for (const route of ['Banker', 'Bank booth', 'Bank chest', 'Bank Chest']) {
  test(`coins used on ${route} exchange whole thousands only after confirmation`, () => {
    const h = bankerHarness();
    h.player.inventory.add(new Item(995, 2501), false);
    assert.equal(h.use(995, route).handled, true);
    assert.equal(h.player.inventory.getAmount(995), 2501);
    assert.equal(h.manager.getCurrent().getTitle(), 'Exchange your coins for platinum tokens?');
    h.manager.handleOption(1);
    assert.equal(h.player.inventory.getAmount(995), 501);
    assert.equal(h.player.inventory.getAmount(13204), 2);
  });
}

for (const [coins, tokens, used, wantCoins, wantTokens] of [
  [1000, 0, 995, 0, 1],
  [999, 0, 995, 999, 0],
  [0, 2, 13204, 2000, 0],
  [2147483000, 10, 13204, 2147483000, 10],
  [2147482000, 10, 13204, 2147483000, 9],
  [2000, 2147483646, 995, 1000, 2147483647],
  [2000, 2147483647, 995, 2000, 2147483647],
  [0, 2147483647, 13204, 2147483000, 2145336164],
]) {
  test(`platinum exchange safely caps inventory ${coins} coins/${tokens} tokens using ${used}`, () => {
    const h = bankerHarness();
    if (coins) h.player.inventory.add(new Item(995, coins), false);
    if (tokens) h.player.inventory.add(new Item(13204, tokens), false);
    h.use(used);
    if (h.manager.isActive()) h.manager.handleOption(1);
    assert.equal(h.player.inventory.getAmount(995), wantCoins);
    assert.equal(h.player.inventory.getAmount(13204), wantTokens);
  });
}

for (const [coins, wantCoins, wantTokens] of [[2000, 0, 2], [2001, 2001, 0]]) {
  test(`full inventory exchange handles ${coins} coins without losing its remainder`, () => {
    const h = bankerHarness();
    h.player.inventory.add(new Item(995, coins), false);
    for (let n = 0; n < 27; n++) h.player.inventory.add(new Item(TRIDENT, 1, { charges: n }), false);
    h.use(995);
    if (h.manager.isActive()) h.manager.handleOption(1);
    assert.equal(h.player.inventory.getAmount(995), wantCoins);
    assert.equal(h.player.inventory.getAmount(13204), wantTokens);
    assert.equal(h.player.inventory.getAmount(TRIDENT), 27);
  });
}

test('exchange cancellation, closure, duplicate and replaced confirmation cannot spend again', () => {
  for (const mode of ['cancel', 'closed', 'duplicate', 'replaced', 'inventory-changed']) {
    const h = bankerHarness();
    h.player.inventory.add(new Item(995, 2000), false);
    h.use(995);
    const old = h.manager.getCurrent();
    assert.ok(old);
    if (mode === 'cancel') old.execute(2);
    if (mode === 'closed') h.manager.reset();
    if (mode === 'duplicate') old.execute(1);
    if (mode === 'replaced') h.use(995);
    if (mode === 'inventory-changed') h.player.inventory.add(new Item(995, 1000), false);
    old.execute(1);
    assert.equal(h.player.inventory.getAmount(13204), mode === 'duplicate' ? 2 : 0, mode);
    assert.equal(h.player.inventory.getAmount(995), mode === 'duplicate' ? 0 : mode === 'inventory-changed' ? 3000 : 2000, mode);
  }
});

test('currency exchange ignores unrelated NPCs, objects, items and stale item slots', () => {
  const h = bankerHarness();
  h.player.inventory.add(new Item(995, 2000), false);
  h.player.inventory.add(new Item(TRIDENT, 1), false);
  for (const args of [[995, 'Man'], [995, 'Tree'], [TRIDENT, 'Banker'], [995, 'Banker', 1]]) {
    assert.equal(h.use(...args).handled, false);
    assert.equal(h.manager.isActive(), false);
  }
});

test("moving items does not re-send the viewed tab, so the client's own tab stays", () => {
  const player = createPlayer();
  bankOf(player, [TRIDENT], [LAVA_BATTLESTAFF]);
  // The bank's tab buttons are handled by the client (it sets BANK_CURRENTTAB
  // itself), so the server's current tab can be stale while the player views
  // another tab. A refresh must not drag them back to it.
  Bank.withdraw(player, LAVA_BATTLESTAFF, 0, 1, 1);

  assert.equal(player.getBank(1).getAmount(LAVA_BATTLESTAFF), 0);
  assert.deepEqual(bankTabsSent(player), []);
});

test("viewing a tab for the client sends BANK_CURRENTTAB", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);

  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.deepEqual(bankTabsSent(player), [[4150, 1]]);
});

test("collapsing the viewed tab sends the main tab", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  player.varbits.length = 0;

  clickTab(player, 1, 6, "Collapse tab");
  assert.equal(player.getCurrentBankTab(), 0);
  assert.deepEqual(bankTabsSent(player), [[4150, 0]]);
});

test("bank item slots get the captured events: ops 1-10, depth 2, drag target, target, and no pause button", () => {
  const flags = Bank.ITEM_SLOT_FLAGS;
  assert.equal(flags & 1, 0, "no pause button: an empty slot must not offer Continue");
  for (let op = 1; op <= 10; op++) assert.ok(flags & (1 << op), `op${op}`);
  assert.equal((flags >> 17) & 7, 2, "depth 2");
  assert.ok(flags & (1 << 20), "drag target");
  assert.ok(flags & (1 << 21), "target");
  assert.equal(flags, 3409918);
});


test("price checking quantities and closing returns every item", () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Sounds } = require('../dist/game/Sounds');
  const originalSound = Sounds.sendSound;
  const originalEmit = PluginManager.emitCustomEvent;
  Sounds.sendSound = () => {};
  const buttons = new Map();
  const custom = new Map();
  require('../plugins/interface/PriceChecker.plugin').register({
    onCustomEvent: (name, handler) => custom.set(name, handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) buttons.set(id, handler);
    },
  });
  const player = createPlayer();
  let status = PlayerStatus.NONE;
  player.interfaceId = -1;
  player.getInterfaceId = () => player.interfaceId;
  player.setInterfaceId = Player.prototype.setInterfaceId;
  player.getStatus = () => status;
  player.setStatus = (value) => { status = value; };
  player.getMovementQueue = () => ({ reset() {} });
  player.busy = () => false;
  const snapshots = [];
  const scripts = [];
  const sender = new Proxy({}, { get: (_target, method) => (...args) => {
    if (method === 'sendInterface') player.setInterfaceId(args[0]);
    if (method === 'sendInventory') snapshots.push(args);
    if (method === 'sendInterfaceScript') scripts.push(args);
    return sender;
  } });
  player.getPacketSender = () => sender;
  PluginManager.emitCustomEvent = (name, event) => custom.get(name)?.(event);
  try {
    player.inventory.add(new Item(LAVA_BATTLESTAFF_NOTE, 12), false);
    player.inventory.add(new Item(TRIDENT, 3), false);
    buttons.get((387 << 16) | 3)({ player, buttonId: (387 << 16) | 3 });
    buttons.get(238 << 16)({ player, itemId: LAVA_BATTLESTAFF_NOTE, slot: 0, action: 2 });
    assert.equal(player.inventory.getAmount(LAVA_BATTLESTAFF_NOTE), 7);
    assert.equal(player.__priceCheckerContainer.getAmount(LAVA_BATTLESTAFF_NOTE), 5);
    assert.equal(snapshots.at(-1)[0], 90);
    assert.equal(snapshots.at(-1)[2][0].amount, 5);
    assert.equal(scripts.at(-1)[1][0], 2500n, 'market price times quantity');
    assert.ok(scripts.some(([id, args]) => id === 149 && args[0] === (238 << 16) && args[1] === 93), 'build the inventory side panel');
    buttons.get(238 << 16)({ player, itemId: TRIDENT, slot: 1, action: 3 });
    assert.equal(player.__priceCheckerContainer.getAmount(TRIDENT), 3, 'quantity operations include separate unstackable slots');
    buttons.get((464 << 16) | 10)({ player, buttonId: (464 << 16) | 10 });
    assert.equal(player.inventory.getValidItems().length, 0);
    player.setInterfaceId(465);
    assert.equal(player.inventory.getAmount(LAVA_BATTLESTAFF_NOTE), 12);
    assert.equal(player.inventory.getAmount(TRIDENT), 3);
    assert.equal(player.__priceCheckerContainer.getValidItems().length, 0);
  } finally {
    Sounds.sendSound = originalSound;
    PluginManager.emitCustomEvent = originalEmit;
  }
});

test("the worn items view banks the one worn item clicked", () => {
  const player = createPlayer();
  // A plain container stands in for the worn equipment; the view's slot is the item's place in
  // the list, so the click's item names it.
  const worn = new Inventory(player);
  worn.resetItems();
  worn.add(new Item(TRIDENT, 1), false);
  worn.add(new Item(LAVA_BATTLESTAFF, 1), false);
  player.getEquipment = () => worn;
  const click = (buttonNum, itemId) => Bank.handleWidgetAction(player, {
    groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_WORN_CHILD, buttonNum, slot: 1, itemId,
  });

  assert.equal(click(1, LAVA_BATTLESTAFF), true);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 1);
  assert.equal(worn.getAmount(LAVA_BATTLESTAFF), 0);
  assert.equal(worn.getAmount(TRIDENT), 1, "only the clicked item");
  // Its other ops aren't banking.
  assert.notEqual(click(10, TRIDENT), true);
  assert.equal(worn.getAmount(TRIDENT), 1);
});
